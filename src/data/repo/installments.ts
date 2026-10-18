import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { assertLiveRow, fromDbShape, nowIso, restoreRows, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { clampDayToMonth, isISODate, isMonthDay, isMonthKey, monthOf, todayISO, yearOf, type ISODate, type MonthKey } from "../../domain/dates";
import { isSupportedCurrency } from "../../domain/fx-provider";
import { generateSchedule, isValidInstallmentCount } from "../../domain/installments";
import { assertSupportedMinorAmount, splitIntoInstallments, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { isValidCardCycle, statementForDueDate, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import { convertToTryMinor } from "../../domain/fx";
import { CreditCardCycleRequiredError, FxRateUnavailableError, InstallmentHistoryConflictError, InstallmentRefundNothingLeftError, InstallmentRefundTooLargeError, InstallmentTotalTooSmallError } from "./errors";
import { assertLiveTransactionPerson, assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

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
 * Build (but don't write) the plan row plus one deterministic transaction per scheduled month, so
 * a bulk import can batch many plans into ONE write. The rows are a pure function of (plan params,
 * start month): ids are deterministic and status derives from the date, so regenerating on edit
 * reproduces the same paid/unpaid split.
 */
/** One expense row of a plan: an instalment (numbered), or a refund or payoff beside them (not). `origin` is omitted for scheduled rows. */
function planTransactionWrite(row: {
  id: string;
  planId: string;
  installmentNo: number | null;
  amountMinor: Minor;
  amountTryMinor: Minor;
  currency: string;
  fxRate: string | null;
  entryDate: ISODate;
  effectiveDate: string;
  status: string;
  categoryId: unknown;
  paymentSourceId: unknown;
  personId: unknown;
  note: string | null;
  origin?: "manual";
}): RowWrite {
  return {
    table: "transactions",
    row: {
      id: row.id,
      type: "expense",
      amountMinor: row.amountMinor,
      currency: row.currency,
      fxRate: row.fxRate,
      amountTryMinor: row.amountTryMinor,
      entryDate: row.entryDate,
      purchaseDate: null,
      effectiveDate: row.effectiveDate,
      status: row.status,
      categoryId: row.categoryId,
      paymentSourceId: row.paymentSourceId,
      personId: row.personId,
      installmentPlanId: row.planId,
      installmentNo: row.installmentNo,
      cardStatementId: null,
      subscriptionId: null,
      isAggregate: false,
      note: row.note,
      ...(row.origin ? { origin: row.origin } : {}),
      deletedAt: null,
    },
  };
}

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
    schedule.map(async (item) => planTransactionWrite({
      id: await deterministicId(naturalKeys.installmentTx(planId, item.installmentNo)),
      planId,
      installmentNo: item.installmentNo,
      amountMinor: item.amountMinor,
      amountTryMinor: assertSupportedMinorAmount(Math.round(item.amountMinor * input.tryFactor), false),
      currency: input.currency,
      fxRate: input.fxRate,
      entryDate: today,
      effectiveDate: item.effectiveDate,
      status: item.status,
      categoryId: input.categoryId,
      paymentSourceId: input.paymentSourceId,
      personId: input.personId,
      note: null,
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
  const periodOf = rows.map((write) =>
    write.table === "transactions" ? statementForDueDate(String(write.row.effectiveDate), cycle) : null);
  const periods = new Map<string, CardStatementPeriod>();
  for (const period of periodOf) if (period) periods.set(period.periodMonth, period);
  const statementWrites = await Promise.all(
    [...periods.values()].map((period) => cardStatementWrite(userId, paymentSourceId, period)),
  );
  const idByPeriod = new Map(
    statementWrites.map((write) => [String(write.row.periodMonth), String(write.row.id)]),
  );
  return [
    ...statementWrites,
    ...rows.map((write, index) => {
      const period = periodOf[index];
      return period ? { ...write, row: { ...write.row, cardStatementId: idByPeriod.get(period.periodMonth) ?? null } } : write;
    }),
  ];
}

/**
 * Carry what a person or an import wrote on a stored instalment into the row that replaces it:
 * date, status and amount are the schedule's to restate; the note and where the row came from are not.
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
 * The unpaid instalments of a whole-purchase plan whose paid ones are kept. Paid rows keep the
 * figures they were written with, so a fresh split beside them would leave the schedule a few
 * kuruş off the purchase: what is left of the total is divided over what is left to pay. A total
 * leaving some unpaid month under a kuruş is refused, since the count is what is wrong.
 */
function divideWhatIsLeft(writes: RowWrite[], input: NewPlan, kept: Map<string, Record<string, unknown>>, leftOut: number): RowWrite[] {
  if (input.totalAmountMinor == null) return writes;
  // In schedule order: the first month carries the split's rounding.
  const unpaid = writes.filter((write) => write.table === "transactions" && !kept.has(String(write.row.id)));
  // Instalments only: a refund or payoff is billed beside the purchase, not part of it.
  const paidMinor = [...kept.values()]
    .filter((row) => row.installment_no != null)
    .reduce((sum, row) => sum + Number(row.amount_minor), 0);
  const leftMinor = input.totalAmountMinor - paidMinor;
  if (unpaid.length === 0) return writes;
  // Months an import left out were paid before this app saw the plan: they keep their shares, unwritten.
  if (leftMinor < unpaid.length + leftOut) throw new InstallmentTotalTooSmallError();
  const shares = splitIntoInstallments(leftMinor, unpaid.length + leftOut).slice(leftOut);
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

/**
 * Each foreign-currency instalment is billed at the rate stored on or before its own day (spec
 * §3.1; the last known one for a coming row), but a plan is built with the screen's single rate.
 * Maintenance fixes a row only as it TURNS realized, so a row born realized is billed here or
 * never. Kept history is not restated.
 */
async function billAtEachDaysRate(
  userId: string,
  writes: RowWrite[],
  currency: string,
  kept: Map<string, Record<string, unknown>>,
): Promise<RowWrite[]> {
  const billed: RowWrite[] = [];
  for (const write of writes) {
    const own = write.table === "transactions" && !kept.has(String(write.row.id))
      ? await billedInTry(userId, currency, Number(write.row.amountMinor), String(write.row.effectiveDate) as ISODate)
      : null;
    billed.push(own ? { ...write, row: { ...write.row, ...own } } : write);
  }
  return billed;
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
  // A moved schedule restates history on purpose: kept rows would hold old dates beside regenerated
  // ones, and an instalment the owner says was not paid would stay paid.
  const realized = reschedule ? [] : existingPlanTransactions.filter((transaction) => transaction.status === "realized");
  if (realized.some((transaction) => Number(transaction.installment_no) > input.installmentCount)) {
    throw new InstallmentHistoryConflictError();
  }
  let resolvedInput = input;
  let cardCycle: CardCycle | null = null;
  if (input.kind === "card_installment") {
    // An instalment purchase paid by hand ("elden") sits on a cash or bank
    // source and keeps its own payment day. It still names a source: a plan of
    // this kind without one is refused by every client's sync and backup check.
    const source = await livePaymentSource(userId, input.paymentSourceId);
    const candidate = { statementDay: source?.statement_day, dueDay: source?.due_day };
    if (!source) throw new CreditCardCycleRequiredError();
    if (source.type === "credit_card") {
      if (!isValidCardCycle(candidate)) throw new CreditCardCycleRequiredError();
      cardCycle = candidate;
      resolvedInput = { ...input, dueDay: candidate.dueDay };
    }
  } else if (input.paymentSourceId && !(await livePaymentSource(userId, input.paymentSourceId))) {
    throw new Error("Installment payment source does not exist");
  }
  const { rows: scheduled, keepNos } = await buildPlanRows(planId, resolvedInput, todayISO());
  // SPEC §3.1: an edit that keeps the schedule rewrites only the unpaid months. A past instalment
  // with no stored row was deliberately left out by an import, so it must not be invented as realized spend.
  const storedNos = new Set(
    existingPlanTransactions.filter((transaction) => transaction.installment_no != null).map((transaction) => Number(transaction.installment_no)),
  );
  const rows = preserveRealized && !reschedule && storedNos.size > 0
    ? scheduled.filter(
        (write) =>
          write.table !== "transactions" ||
          write.row.status !== "realized" ||
          storedNos.has(Number(write.row.installmentNo)),
      )
    : scheduled;
  const leftOut = scheduled.length - rows.length;
  let writes = cardCycle && resolvedInput.paymentSourceId
    ? await linkDueRowsToCardStatements(userId, resolvedInput.paymentSourceId, cardCycle, rows)
    : rows;
  const realizedById = new Map(realized.map((transaction) => [String(transaction.id), transaction]));
  if (realized.length > 0 || leftOut > 0) {
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
    writes = divideWhatIsLeft(writes, resolvedInput, realizedById, leftOut);
  }
  writes = await billAtEachDaysRate(userId, writes, resolvedInput.currency, realizedById);
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
 * The TRY rate stored for `currency` on `date` or the last earlier day that has one (spec §2.4),
 * never a later day's. Null when nothing usable is stored, so a caller keeps the figure it holds.
 */
async function storedRateOnOrBefore(userId: string, currency: string, date: ISODate): Promise<number | null> {
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

/**
 * What a foreign-currency amount bills in lira at the rate stored for `rateDate` or before, or null
 * for nothing to change: a lira amount, no usable rate, or a figure too small to survive conversion.
 */
export async function billedInTry(
  userId: string,
  currency: string,
  amountMinor: Minor,
  rateDate: ISODate,
): Promise<{ amountTryMinor: Minor; fxRate: string } | null> {
  if (currency === "TRY") return null;
  const rate = await storedRateOnOrBefore(userId, currency, rateDate);
  if (rate == null) return null;
  const amountTryMinor = convertToTryMinor(amountMinor, rate);
  return amountTryMinor === 0 ? null : { amountTryMinor, fxRate: String(rate) };
}

/** Live installment transactions of a plan, for the warn-before-delete count. */
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
 * Edit a plan in place: rewrite the plan row, regenerate the schedule (deterministic ids update
 * matching months) and tombstone instalments outside the new schedule. Paid instalments survive an
 * ordinary edit; `reschedule` (an edit that MOVES the schedule) places every instalment again,
 * keeping only its note and origin.
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
 * Record a refund against an instalment purchase: a negative expense linked to the plan, never a
 * change to it. Its rows carry no instalment number, so the schedule and later plan edits leave
 * them alone. It may not exceed what is left of the purchase (a larger credit is a typo that would
 * read as income). A foreign-currency refund is in the plan's currency, each credit at the rate of
 * its own day like the instalments beside it.
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
  // A closed loan's payoff is no part of the purchase, so it cannot make room for a larger refund.
  const leftMinor = rows
    .filter((row) => row.installment_no != null || Number(row.amount_minor) < 0)
    .reduce((sum, row) => sum + Number(row.amount_minor), 0);
  if (input.amountMinor > leftMinor) throw new InstallmentRefundTooLargeError(Math.max(leftMinor, 0));
  const today = todayISO();
  const currency = String(plan.currency);
  const dates = refundDates(plan, rows, input);
  if (dates.length === 0) throw new InstallmentRefundNothingLeftError();
  const shares = splitIntoInstallments(input.amountMinor, dates.length);
  const rates = await refundRates(userId, currency, dates, today);
  let writes: RowWrite[] = dates.map((effectiveDate, index) => planTransactionWrite({
    id: newId(),
    planId,
    installmentNo: null,
    amountMinor: -shares[index]!,
    amountTryMinor: assertSupportedMinorAmount(convertToTryMinor(-shares[index]!, rates[index]!), false),
    currency,
    fxRate: currency === "TRY" ? null : String(rates[index]),
    entryDate: today,
    effectiveDate,
    status: effectiveDate <= today ? "realized" : "pending",
    categoryId: plan.category_id ?? null,
    paymentSourceId: plan.payment_source_id ?? null,
    personId: plan.person_id,
    note: input.note,
    origin: "manual",
  }));
  const source = plan.kind === "card_installment"
    ? await livePaymentSource(userId, (plan.payment_source_id as string | null) ?? null)
    : null;
  const cycle = { statementDay: source?.statement_day, dueDay: source?.due_day };
  if (source && isValidCardCycle(cycle)) writes = await linkDueRowsToCardStatements(userId, source.id, cycle, writes);
  await writeRowsValidated(userId, writes, (db) => assertLiveRow(db, "installment_plans", userId, planId));
}

/** The days a refund is credited on: each instalment still to pay when spread, or the plan's due day in the chosen month. */
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

interface PlanClosure {
  /** The day the loan was paid off. */
  closedOn: ISODate;
  /** What paying it off cost, in the plan's currency. */
  payoffMinor: Minor;
  note: string | null;
}

/**
 * Pay a loan off early: the plan keeps the instalments due on or before the payoff day, loses the
 * later ones and, when closing cost anything more, gains one payoff row. Its original count is kept
 * so the closure can be undone. A loan with no instalment due yet is deleted instead, so it is refused.
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
  // Kept by day, not by count: an imported loan's numbers can skip months, so "the first N" would drop paid instalments.
  const kept = instalments.filter((row) => String(row.effective_date) <= input.closedOn);
  if (kept.length === 0) throw new Error("A loan closed before its first instalment is deleted, not closed");
  // One moment for every row this closure removes, which is how undoing it finds them.
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
    const currency = String(plan.currency);
    const rate = await storedRateOnOrBefore(userId, currency, input.closedOn);
    if (rate == null) throw new FxRateUnavailableError(currency);
    writes.push(planTransactionWrite({
      id: await deterministicId(naturalKeys.planPayoff(planId)),
      planId,
      installmentNo: null,
      amountMinor: input.payoffMinor,
      amountTryMinor: assertSupportedMinorAmount(convertToTryMinor(input.payoffMinor, rate), false),
      currency,
      fxRate: currency === "TRY" ? null : String(rate),
      entryDate: todayISO(),
      effectiveDate: input.closedOn,
      status: "realized",
      categoryId: plan.category_id ?? null,
      paymentSourceId: plan.payment_source_id ?? null,
      personId: plan.person_id,
      note: input.note,
      origin: "manual",
    }));
  }
  await writeRowsValidated(userId, writes, (db) => assertLiveRow(db, "installment_plans", userId, planId));
}

/**
 * Undo an early closure: the count comes back, the payoff goes, and the removed instalments return
 * as they were. Restored, not regenerated: a rebuilt schedule would bring back months an import left
 * out and replace each row's own figure. The closure's rows share its timestamp; one deleted by
 * hand earlier carries an earlier one and stays deleted.
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

/** Tombstones the plan and its live instalments, and returns them for the undo bar; null when there was no live plan. */
export async function deletePlan(userId: string, planId: string): Promise<RowWrite[] | null> {
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
  if (!plan) return null;
  const deletedAt = nowIso();
  const writes: RowWrite[] = [
    { table: "installment_plans", row: { ...fromDbShape("installment_plans", plan), deletedAt } },
    ...transactions.map((transaction) => ({
      table: "transactions" as const,
      row: { ...fromDbShape("transactions", transaction), deletedAt },
    })),
  ];
  await writeRows(userId, writes);
  return writes;
}

/** Undoes `deletePlan`: exactly the rows it tombstoned, live again. */
export function restorePlan(userId: string, deleted: readonly RowWrite[]): Promise<void> {
  return restoreRows(userId, deleted.map((write) => ({ table: write.table, row: { ...write.row, deletedAt: null } })));
}
