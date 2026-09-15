import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { assertLiveRow, fromDbShape, nowIso, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { clampDayToMonth, isISODate, isMonthDay, isMonthKey, monthOf, todayISO, yearOf, type ISODate, type MonthKey } from "../../domain/dates";
import { isSupportedCurrency } from "../../domain/fx-provider";
import { generateSchedule, isValidInstallmentCount } from "../../domain/installments";
import { assertSupportedMinorAmount, splitIntoInstallments, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { isValidCardCycle, statementForDueDate, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import { convertToTryMinor } from "../../domain/fx";
import { CreditCardCycleRequiredError, FxRateUnavailableError, InstallmentHistoryConflictError, InstallmentRefundNothingLeftError, InstallmentRefundTooLargeError } from "./errors";
import { assertLiveTransactionPerson, assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

// Installment plans
// ---------------------------------------------------------------------------

export interface NewPlan {
  title: string;
  kind: "card_installment" | "loan";
  totalAmountMinor: Minor | null;
  monthlyAmountMinor: Minor | null;
  installmentCount: number;
  currency: string;
  fxRate: string | null;
  startMonth: MonthKey;
  dueDay: number | null;
  paymentSourceId: string | null;
  personId: string;
  personIsSelf: boolean;
  categoryId: string | null;
  note: string | null;
  /** TRY conversion factor applied to each share (1 for TRY). */
  tryFactor: number;
}

/**
 * Write the plan row plus one deterministic transaction per scheduled month.
 * Installment transactions are a pure function of (plan params, start month):
 * their id is deterministic and their realized/pending status is derived from
 * the date, so regenerating on edit reproduces the same paid/unpaid split.
 */
/** Build (but don't write) the plan row + one deterministic transaction per
 *  scheduled month. Extracted so a bulk import can batch many plans into ONE
 *  write instead of a DB transaction per plan (that was minutes for ~100 plans).
 *  The per-installment ids are hashed in parallel. */
export async function buildPlanRows(planId: string, input: NewPlan, today: ISODate): Promise<{ rows: RowWrite[]; keepNos: Set<number> }> {
  assertInputWithinLimit(input.title, "text");
  assertInputWithinLimit(input.note, "note");
  if (!["card_installment", "loan"].includes(input.kind)) throw new Error("Invalid installment plan kind");
  if (!isSupportedCurrency(input.currency)) throw new Error("Invalid installment currency");
  if (!isMonthKey(input.startMonth)) throw new Error("Invalid installment start month");
  if (!isValidInstallmentCount(input.installmentCount)) throw new Error("Invalid installment count");
  if (input.dueDay != null && !isMonthDay(input.dueDay)) throw new Error("Invalid installment due day");
  if (!Number.isFinite(input.tryFactor) || input.tryFactor <= 0) throw new Error("Invalid installment FX factor");
  if (input.totalAmountMinor != null) {
    assertSupportedMinorAmount(input.totalAmountMinor, false);
    if (input.totalAmountMinor < 0) throw new Error("Installment amount must be positive");
  }
  if (input.monthlyAmountMinor != null) {
    assertSupportedMinorAmount(input.monthlyAmountMinor, false);
    if (input.monthlyAmountMinor < 0) throw new Error("Installment amount must be positive");
  }
  const schedule = generateSchedule(
    {
      id: planId,
      kind: input.kind,
      startMonth: input.startMonth,
      installmentCount: input.installmentCount,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      currency: input.currency,
      dueDay: input.dueDay,
      personIsSelf: input.personIsSelf,
    },
    today,
  );
  const planRow: RowWrite = {
    table: "installment_plans",
    row: {
      id: planId,
      title: input.title,
      kind: input.kind,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      installmentCount: input.installmentCount,
      currency: input.currency,
      startMonth: input.startMonth,
      dueDay: input.dueDay,
      paymentSourceId: input.paymentSourceId,
      personId: input.personId,
      categoryId: input.categoryId,
      note: input.note,
      deletedAt: null,
    },
  };
  const txRows: RowWrite[] = await Promise.all(
    schedule.map(async (item) => ({
      table: "transactions" as const,
      row: {
        id: await deterministicId(naturalKeys.installmentTx(planId, item.installmentNo)),
        type: "expense",
        amountMinor: item.amountMinor,
        currency: input.currency,
        fxRate: input.fxRate,
        amountTryMinor: assertSupportedMinorAmount(Math.round(item.amountMinor * input.tryFactor), false),
        entryDate: today,
        purchaseDate: null,
        effectiveDate: item.effectiveDate,
        status: item.status,
        categoryId: input.categoryId,
        paymentSourceId: input.paymentSourceId,
        personId: input.personId,
        installmentPlanId: planId,
        installmentNo: item.installmentNo,
        cardStatementId: null,
        subscriptionId: null,
        isAggregate: false,
        note: null,
        deletedAt: null,
      },
    })),
  );
  return { rows: [planRow, ...txRows], keepNos: new Set(schedule.map((s) => s.installmentNo)) };
}

export async function linkDueRowsToCardStatements(
  userId: string,
  paymentSourceId: string,
  cycle: CardCycle,
  rows: RowWrite[],
): Promise<RowWrite[]> {
  const periods = new Map<string, CardStatementPeriod>();
  for (const write of rows) {
    if (write.table !== "transactions") continue;
    const period = statementForDueDate(String(write.row.effectiveDate), cycle);
    periods.set(period.periodMonth, period);
  }
  const statementWrites = await Promise.all(
    [...periods.values()].map((period) => cardStatementWrite(userId, paymentSourceId, period)),
  );
  const idByPeriod = new Map(
    statementWrites.map((write) => [String(write.row.periodMonth), String(write.row.id)]),
  );
  return [
    ...statementWrites,
    ...rows.map((write) => {
      if (write.table !== "transactions") return write;
      const period = statementForDueDate(String(write.row.effectiveDate), cycle);
      return { ...write, row: { ...write.row, cardStatementId: idByPeriod.get(period.periodMonth) ?? null } };
    }),
  ];
}

/**
 * Carry what a person or an import wrote on a stored instalment into the row
 * that replaces it. Every edit regenerates the unpaid months, and a moved
 * schedule regenerates all of them: date, status and amount are the schedule's
 * to restate; the note, and where the row came from, are not. Before this, a
 * note typed on a coming instalment vanished on any edit of its plan.
 */
function carryStoredDetails(writes: RowWrite[], stored: Record<string, unknown>[]): RowWrite[] {
  const byId = new Map(stored.map((row) => [String(row.id), row]));
  return writes.map((write) => {
    const row = write.table === "transactions" ? byId.get(String(write.row.id)) : undefined;
    if (!row) return write;
    return { ...write, row: { ...write.row, note: row.note ?? null, origin: row.origin ?? null, importKey: row.import_key ?? null } };
  });
}

/**
 * The unpaid instalments of a whole-purchase plan whose paid ones are kept.
 *
 * Paid rows are history and keep the figures they were written with — under an
 * older split rule, or before the total was corrected — so a fresh split of the
 * total beside them leaves the schedule a few kuruş off the purchase. What is
 * left of the total is divided over what is left to pay instead. A total
 * corrected below what was already paid leaves nothing to divide, and the
 * schedule's own figures stand.
 */
function divideWhatIsLeft(writes: RowWrite[], input: NewPlan, kept: Record<string, unknown>[]): RowWrite[] {
  if (input.totalAmountMinor == null) return writes;
  const keptIds = new Set(kept.map((row) => String(row.id)));
  const unpaid = writes
    .filter((write) => write.table === "transactions" && !keptIds.has(String(write.row.id)))
    .sort((a, b) => Number(a.row.installmentNo) - Number(b.row.installmentNo));
  const leftMinor = input.totalAmountMinor - kept.reduce((sum, row) => sum + Number(row.amount_minor), 0);
  if (unpaid.length === 0 || leftMinor < unpaid.length) return writes;
  const shares = splitIntoInstallments(leftMinor, unpaid.length);
  const shareById = new Map(unpaid.map((write, index) => [String(write.row.id), shares[index]!]));
  return writes.map((write) => {
    const share = shareById.get(String(write.row.id));
    if (share == null) return write;
    return {
      ...write,
      row: {
        ...write.row,
        amountMinor: share,
        amountTryMinor: assertSupportedMinorAmount(Math.round(share * input.tryFactor), false),
      },
    };
  });
}

async function writePlanWithSchedule(
  userId: string,
  planId: string,
  input: NewPlan,
  preserveRealized = false,
  reschedule = false,
): Promise<Set<number>> {
  await assertLiveTransactionPerson(userId, input.personId);
  await assertTransactionCategory(userId, "expense", input.categoryId, false);
  const sqlite = await getSqliteAsync();
  const existingPlanTransactions = preserveRealized
    ? await sqlite.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM transactions WHERE user_id = ? AND installment_plan_id = ?
         AND deleted_at IS NULL`,
        [userId, planId],
      )
    : [];
  // A moved schedule restates history on purpose: the owner is correcting how
  // many instalments were paid, which is a statement about which months those
  // were. Kept rows would hold their old dates beside regenerated ones, and a
  // "paid" instalment the owner says was not would stay paid.
  const realized = reschedule ? [] : existingPlanTransactions.filter((transaction) => transaction.status === "realized");
  if (realized.some((transaction) => Number(transaction.installment_no) > input.installmentCount)) {
    throw new InstallmentHistoryConflictError();
  }
  let resolvedInput = input;
  let cardCycle: CardCycle | null = null;
  if (input.kind === "card_installment") {
    const source = await livePaymentSource(userId, input.paymentSourceId);
    const candidate = { statementDay: source?.statement_day, dueDay: source?.due_day };
    if (!source || source.type !== "credit_card" || !isValidCardCycle(candidate)) {
      throw new CreditCardCycleRequiredError();
    }
    cardCycle = candidate;
    resolvedInput = { ...input, dueDay: candidate.dueDay };
  } else if (input.paymentSourceId && !(await livePaymentSource(userId, input.paymentSourceId))) {
    throw new Error("Installment payment source does not exist");
  }
  const { rows, keepNos } = await buildPlanRows(planId, resolvedInput, todayISO());
  let writes = cardCycle && resolvedInput.paymentSourceId
    ? await linkDueRowsToCardStatements(userId, resolvedInput.paymentSourceId, cardCycle, rows)
    : rows;
  if (realized.length > 0) {
    const realizedById = new Map(realized.map((transaction) => [String(transaction.id), transaction]));
    writes = writes.map((write) => {
      if (write.table !== "transactions") return write;
      const historical = realizedById.get(String(write.row.id));
      return historical ? { table: "transactions" as const, row: fromDbShape("transactions", historical) } : write;
    });
    const referencedStatementIds = new Set(
      writes
        .filter((write) => write.table === "transactions")
        .map((write) => write.row.cardStatementId)
        .filter((id): id is string => typeof id === "string"),
    );
    writes = writes.filter(
      (write) => write.table !== "credit_card_statements" || referencedStatementIds.has(String(write.row.id)),
    );
    writes = divideWhatIsLeft(writes, resolvedInput, realized);
  }
  writes = carryStoredDetails(writes, existingPlanTransactions);
  if (preserveRealized) {
    writes.push(
      ...existingPlanTransactions
        .filter(
          (transaction) =>
            (reschedule || transaction.status === "pending") &&
            transaction.installment_no != null &&
            !keepNos.has(Number(transaction.installment_no)),
        )
        .map((transaction) => ({
          table: "transactions" as const,
          row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() },
        })),
    );
  }
  if (preserveRealized) {
    await writeRowsValidated(userId, writes, (sqlite) => assertLiveRow(sqlite, "installment_plans", userId, planId));
  } else {
    await writeRows(userId, writes);
  }
  return keepNos;
}

/**
 * The TRY rate stored for `currency` on `date` or the last day before it that
 * has one (spec §2.5) — never a later day's. Null when nothing usable is
 * stored, so a caller keeps the figure it already holds instead of inventing
 * one. The bounds are the rate cache's own.
 */
export async function storedRateOnOrBefore(userId: string, currency: string, date: ISODate): Promise<number | null> {
  if (currency === "TRY") return 1;
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ rate_try: string }>(
    `SELECT rate_try FROM fx_rates
     WHERE user_id = ? AND currency = ? AND rate_date <= ? AND deleted_at IS NULL
     ORDER BY rate_date DESC LIMIT 1`,
    [userId, currency, date],
  );
  const rate = Number(row?.rate_try);
  return Number.isFinite(rate) && rate > 0 && rate <= 1_000_000 ? rate : null;
}

/** Live installment transactions belonging to a plan — for a warn-before-delete
 *  count (deleting a plan tombstones all of them; the action has no undo). */
export async function countInstallmentsForPlan(userId: string, planId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND installment_plan_id = ? AND deleted_at IS NULL`,
    [userId, planId],
  );
  return row?.n ?? 0;
}

/** Create the plan and materialize one transaction per month (deterministic ids). */
export async function createInstallmentPlan(userId: string, input: NewPlan): Promise<string> {
  const planId = newId();
  await writePlanWithSchedule(userId, planId, input);
  return planId;
}

/**
 * Edit an existing plan in place: rewrite the plan row, regenerate the
 * schedule (deterministic ids un-delete/update matching months), and tombstone
 * any previously-generated installments that fall outside the new schedule
 * (e.g. when the installment count is reduced).
 *
 * Paid instalments are history and survive an ordinary edit untouched.
 * `reschedule` is the one exception, for an edit that MOVES the schedule — the
 * owner correcting how many were paid, or which month it started: then every
 * instalment is placed again, paid or not, keeping only its note and origin.
 */
export async function updateInstallmentPlan(
  userId: string,
  planId: string,
  input: NewPlan,
  options: { reschedule?: boolean } = {},
): Promise<void> {
  await writePlanWithSchedule(userId, planId, input, true, options.reschedule === true);
}

export interface InstallmentRefund {
  /** What the statement credits in total, positive, in the plan's own currency. */
  amountMinor: Minor;
  /**
   * How the bank reflects it: `remaining` spreads it over the instalments not
   * yet paid, one credit on each of those statements; `once` puts it on one.
   */
  spread: "remaining" | "once";
  /** The statement month a one-off credit lands on. Ignored for `remaining`. */
  month: MonthKey;
  note: string | null;
}

/**
 * Record a refund against an instalment purchase.
 *
 * A refund is a negative expense linked to the plan, never a change to the
 * plan: the bank still bills every instalment and credits the refund beside
 * them, and the statement shows both. Its rows carry no instalment number, so
 * the schedule, its progress and a later edit of the plan leave them alone,
 * while everything that adds up the plan's rows nets them out.
 *
 * It may not exceed what is left of the purchase — the instalments minus the
 * refunds already recorded — because a credit larger than the purchase is a
 * typo, and it would read as income.
 *
 * A foreign-currency purchase is refunded in its own currency and each credit
 * takes the rate of its own day, exactly like the instalments beside it: the
 * stored rate on or before that day, or today's last known one for a coming
 * statement, which maintenance restates as rates arrive.
 */
export async function addInstallmentRefund(userId: string, planId: string, input: InstallmentRefund): Promise<void> {
  assertSupportedMinorAmount(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error("Refund amount must be positive");
  if (input.spread === "once" && !isMonthKey(input.month)) throw new Error("Invalid refund month");
  assertInputWithinLimit(input.note, "note");
  const sqlite = await getSqliteAsync();
  const plan = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [planId, userId],
  );
  if (!plan) throw new Error("Installment plan does not exist");
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE user_id = ? AND installment_plan_id = ? AND deleted_at IS NULL`,
    [userId, planId],
  );
  // A closed loan's payoff is billed beside its instalments but is no part of
  // the purchase, so it cannot make room for a larger refund.
  const leftMinor = rows
    .filter((row) => row.installment_no != null || Number(row.amount_minor) < 0)
    .reduce((sum, row) => sum + Number(row.amount_minor), 0);
  if (input.amountMinor > leftMinor) throw new InstallmentRefundTooLargeError(Math.max(leftMinor, 0));
  const today = todayISO();
  const currency = typeof plan.currency === "string" ? plan.currency : "TRY";
  const dates = refundDates(plan, rows, input);
  if (dates.length === 0) throw new InstallmentRefundNothingLeftError();
  const shares = splitIntoInstallments(input.amountMinor, dates.length);
  const rates = await refundRates(userId, currency, dates, today);
  let writes: RowWrite[] = dates.map((effectiveDate, index) => ({
    table: "transactions" as const,
    row: {
      id: newId(),
      type: "expense",
      amountMinor: -shares[index]!,
      currency,
      fxRate: currency === "TRY" ? null : String(rates[index]),
      amountTryMinor: assertSupportedMinorAmount(convertToTryMinor(-shares[index]!, rates[index]!), false),
      entryDate: today,
      purchaseDate: null,
      effectiveDate,
      status: effectiveDate <= today ? "realized" : "pending",
      categoryId: plan.category_id ?? null,
      paymentSourceId: plan.payment_source_id ?? null,
      personId: plan.person_id,
      installmentPlanId: planId,
      installmentNo: null,
      cardStatementId: null,
      subscriptionId: null,
      isAggregate: false,
      note: input.note,
      origin: "manual",
      deletedAt: null,
    },
  }));
  const source = plan.kind === "card_installment"
    ? await livePaymentSource(userId, (plan.payment_source_id as string | null) ?? null)
    : null;
  const cycle = { statementDay: source?.statement_day, dueDay: source?.due_day };
  if (source && isValidCardCycle(cycle)) writes = await linkDueRowsToCardStatements(userId, source.id, cycle, writes);
  await writeRowsValidated(userId, writes, (db) => assertLiveRow(db, "installment_plans", userId, planId));
}

/**
 * The days a refund of a plan is credited on: each instalment still to pay
 * when the bank spreads it, or the plan's due day in the chosen month.
 */
function refundDates(plan: Record<string, unknown>, rows: Record<string, unknown>[], input: InstallmentRefund): string[] {
  if (input.spread === "remaining") {
    return rows
      .filter((row) => row.installment_no != null && row.status === "pending")
      .map((row) => String(row.effective_date))
      .sort();
  }
  const dueDay = isMonthDay(Number(plan.due_day)) ? Number(plan.due_day) : 1;
  return [clampDayToMonth(yearOf(input.month), monthOf(input.month), dueDay)];
}

/** The stored rate for each credit's own day, or today's for one still to come. */
async function refundRates(userId: string, currency: string, dates: readonly string[], today: ISODate): Promise<number[]> {
  const rates: number[] = [];
  for (const effectiveDate of dates) {
    const rate = await storedRateOnOrBefore(userId, currency, effectiveDate <= today ? (effectiveDate as ISODate) : today);
    if (rate == null) throw new FxRateUnavailableError(currency);
    rates.push(rate);
  }
  return rates;
}

export interface PlanClosure {
  /** The day the loan was paid off. */
  closedOn: ISODate;
  /** What paying it off cost, in the plan's currency. */
  payoffMinor: Minor;
  note: string | null;
}

/**
 * Pay a loan off early (owner decision, 2026-09-13).
 *
 * The plan keeps the instalments due on or before the payoff day, loses the
 * ones after it, and — when closing it cost anything more — gains one payoff
 * row on that day. The count it had is kept on the plan so the closure can be undone —
 * a closure is one tap away from a loan, and a mistaken one must not be the
 * end of its schedule.
 *
 * A loan with no instalment due yet has nothing to shorten to and is deleted
 * instead, which is why it is refused here.
 */
export async function closeInstallmentPlan(userId: string, planId: string, input: PlanClosure): Promise<void> {
  if (!isISODate(input.closedOn) || input.closedOn > todayISO()) throw new Error("Invalid plan closure date");
  assertSupportedMinorAmount(input.payoffMinor);
  if (input.payoffMinor < 0) throw new Error("Plan payoff must not be negative");
  assertInputWithinLimit(input.note, "note");
  const sqlite = await getSqliteAsync();
  const plan = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [planId, userId],
  );
  if (!plan || plan.kind !== "loan") throw new Error("Only a running loan can be closed");
  if (plan.closed_on != null) throw new Error("Loan is already closed");
  const instalments = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions
     WHERE user_id = ? AND installment_plan_id = ? AND installment_no IS NOT NULL AND deleted_at IS NULL`,
    [userId, planId],
  );
  // Kept by day, not by count. An imported loan's numbers can skip the months
  // its workbook kept in another column, so "the first N" of them dropped
  // instalments already paid; the plan's count becomes the last number kept.
  const kept = instalments.filter((row) => String(row.effective_date) <= input.closedOn);
  if (kept.length === 0) throw new Error("A loan closed before its first instalment is deleted, not closed");
  // One moment for every row this closure removes, which is how undoing it
  // finds exactly those.
  const deletedAt = nowIso();
  const writes: RowWrite[] = [
    {
      table: "installment_plans",
      row: {
        ...fromDbShape("installment_plans", plan),
        installmentCount: Math.max(...kept.map((row) => Number(row.installment_no))),
        originalInstallmentCount: plan.installment_count,
        closedOn: input.closedOn,
      },
    },
    ...instalments
      .filter((row) => String(row.effective_date) > input.closedOn)
      .map((row) => ({ table: "transactions" as const, row: { ...fromDbShape("transactions", row), deletedAt } })),
  ];
  // A loan its last regular instalment closed costs nothing more and writes no payoff.
  if (input.payoffMinor > 0) {
    const currency = typeof plan.currency === "string" ? plan.currency : "TRY";
    const rate = await storedRateOnOrBefore(userId, currency, input.closedOn);
    if (rate == null) throw new FxRateUnavailableError(currency);
    writes.push({
      table: "transactions",
      row: {
        id: await deterministicId(naturalKeys.planPayoff(planId)),
        type: "expense",
        amountMinor: input.payoffMinor,
        currency,
        fxRate: currency === "TRY" ? null : String(rate),
        amountTryMinor: assertSupportedMinorAmount(convertToTryMinor(input.payoffMinor, rate), false),
        entryDate: todayISO(),
        purchaseDate: null,
        effectiveDate: input.closedOn,
        status: "realized",
        categoryId: plan.category_id ?? null,
        paymentSourceId: plan.payment_source_id ?? null,
        personId: plan.person_id,
        installmentPlanId: planId,
        installmentNo: null,
        cardStatementId: null,
        subscriptionId: null,
        isAggregate: false,
        note: input.note,
        origin: "manual",
        deletedAt: null,
      },
    });
  }
  await writeRowsValidated(userId, writes, (db) => assertLiveRow(db, "installment_plans", userId, planId));
}

/**
 * Undo an early closure: the count it had comes back, the payoff goes, and the
 * instalments the closure removed return exactly as they were.
 *
 * Restored, not regenerated. A schedule rebuilt from the plan brought back the
 * months an import deliberately left out — money already inside another
 * column — and replaced each row's own figure with the plan's. The closure
 * tombstoned its rows in one write, so they share its moment; an instalment
 * deleted by hand before it carries an earlier one and stays deleted.
 */
export async function reopenInstallmentPlan(userId: string, planId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const plan = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [planId, userId],
  );
  if (!plan || plan.closed_on == null || plan.original_installment_count == null) throw new Error("Loan is not closed");
  const removed = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions
     WHERE user_id = ? AND installment_plan_id = ? AND installment_no IS NOT NULL
       AND deleted_at IS NOT NULL AND effective_date > ?`,
    [userId, planId, String(plan.closed_on)],
  );
  const closedAt = removed.reduce((latest, row) => (String(row.deleted_at) > latest ? String(row.deleted_at) : latest), "");
  const payoff = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [await deterministicId(naturalKeys.planPayoff(planId)), userId],
  );
  const writes: RowWrite[] = [
    {
      table: "installment_plans",
      row: {
        ...fromDbShape("installment_plans", plan),
        installmentCount: Number(plan.original_installment_count),
        closedOn: null,
        originalInstallmentCount: null,
      },
    },
    ...removed
      .filter((row) => String(row.deleted_at) === closedAt)
      .map((row) => ({ table: "transactions" as const, row: { ...fromDbShape("transactions", row), deletedAt: null } })),
    ...(payoff ? [{ table: "transactions" as const, row: { ...fromDbShape("transactions", payoff), deletedAt: nowIso() } }] : []),
  ];
  await writeRowsValidated(userId, writes, (db) => assertLiveRow(db, "installment_plans", userId, planId));
}

/** Tombstone a plan together with its generated transactions. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const [plan, transactions] = await Promise.all([
    sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [planId, userId],
    ),
    sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE installment_plan_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [planId, userId],
    ),
  ]);
  if (!plan) return;
  const deletedAt = nowIso();
  await writeRows(userId, [
    { table: "installment_plans", row: { ...fromDbShape("installment_plans", plan), deletedAt } },
    ...transactions.map((transaction) => ({
      table: "transactions" as const,
      row: { ...fromDbShape("transactions", transaction), deletedAt },
    })),
  ]);
}
