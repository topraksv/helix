/**
 * Committing the statement rows a person accepted (spec §3.9). This runs AFTER a review and only
 * writes what was approved. Two properties carry it:
 *
 * - Deterministic identity: a row's id derives from its statement line (`naturalKeys.statementTx`),
 *   so importing a statement twice converges on the same rows, even across devices.
 * - All or nothing: one batch, one transaction, since a half-imported statement looks complete.
 */

import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { writeRows, type RowWrite } from "../../db/mutations";
import { dayOf, isMonthKey, lastDayOf, monthDiff, todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { isValidCardCycle, statementPeriod, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import { planForSighting } from "../../domain/installments";
import { statementSighting, type ExistingPlan, type StatementPlanSpec } from "../../domain/statement-import";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { settledExpectedWrites, subscriptionPayment } from "./expected";
import { buildPlanRows, linkDueRowsToCardStatements } from "./installments";
import { assertLiveTransactionPerson, assertTransactionCategory, cardStatementWrite, livePaymentSource } from "./transactions";

/** One approved row, as the review hands it over. */
export interface AcceptedStatementRow {
  importKey: string;
  /** The date the bank PRINTED, kept as provenance. Not when this is paid. */
  date: ISODate;
  description: string;
  amountMinor: Minor;
  isRefund: boolean;
  /** The owner's column, or null when nothing matched; null is written uncategorised, not refused. */
  categoryId: string | null;
  /** Set when the line is one payment of an instalment plan: it becomes the plan and its schedule, not a charge. */
  plan: StatementPlanSpec | null;
  /** The subscription payment this line settles, when review found one. */
  expectedId: string | null;
}

interface StatementCommitInput {
  personId: string;
  /** The period this statement bills, and the ONLY month the import may reach; printed dates survive as `purchaseDate` and decide nothing. */
  period: MonthKey;
  /** The card the statement belongs to, when the owner named one. */
  paymentSourceId: string | null;
  rows: readonly AcceptedStatementRow[];
}

export interface StatementCommitResult {
  writtenIds: string[];
  /** Rows whose id already existed: the same line, imported before. */
  skipped: number;
  /** Instalment plans this import brought into existence. */
  plansWritten: number;
}

/** Ids are looked up in groups so the statement text stays the same size whatever the import's length. */
const ID_LOOKUP_CHUNK = 400;

/** Which of `ids` this account already holds a transaction for. */
async function existingTransactionIds(
  sqlite: Awaited<ReturnType<typeof getSqliteAsync>>,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += ID_LOOKUP_CHUNK) {
    const chunk = ids.slice(offset, offset + ID_LOOKUP_CHUNK);
    const rows = await sqlite.getAllAsync<{ id: string }>(
      `SELECT id FROM transactions WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
      [userId, ...chunk],
    );
    for (const row of rows) present.add(row.id);
  }
  return present;
}

/**
 * When the period is settled, and which statement row the lines hang off. With a card cycle the
 * day is the card's due date for the period; without one the period's last day stands in. Either
 * way the import stays inside the month the owner named.
 */
async function resolveStatementBilling(
  userId: string,
  paymentSourceId: string | null,
  period: MonthKey,
): Promise<{ cycle: CardCycle | null; chargeDate: ISODate; statementRow: RowWrite | null }> {
  if (paymentSourceId == null) return { cycle: null, chargeDate: lastDayOf(period), statementRow: null };
  const card = await livePaymentSource(userId, paymentSourceId);
  if (card?.type !== "credit_card") throw new Error("Statement payment source does not exist");
  if (!isValidCardCycle({ statementDay: card.statement_day, dueDay: card.due_day })) {
    return { cycle: null, chargeDate: lastDayOf(period), statementRow: null };
  }
  const cycle: CardCycle = { statementDay: card.statement_day!, dueDay: card.due_day! };
  const billing: CardStatementPeriod = statementPeriod(period, cycle);
  return {
    cycle,
    chargeDate: billing.dueDate,
    statementRow: await cardStatementWrite(userId, card.id, billing),
  };
}

/** The checks every accepted line passes, whichever shape it turns into. */
function assertAcceptedRow(row: AcceptedStatementRow): void {
  assertInputWithinLimit(row.description, "text");
  assertSupportedMinorAmount(row.amountMinor, false);
  if (row.amountMinor <= 0) throw new Error("Statement row amount must be positive");
}

/** Every live plan, as the schedule match reads it for `period`. */
async function livePlans(userId: string, period: MonthKey): Promise<ExistingPlan[]> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{
    id: string;
    title: string;
    start_month: MonthKey;
    installment_count: number;
    total_amount_minor: number | null;
    monthly_amount_minor: number | null;
    currency: string;
    payment_source_id: string | null;
  }>(
    `SELECT id, title, start_month, installment_count, total_amount_minor, monthly_amount_minor, currency, payment_source_id
     FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const lira = new Map((await sqlite.getAllAsync<{ installment_plan_id: string; installment_no: number; amount_try_minor: number }>(
    `SELECT installment_plan_id, installment_no, amount_try_minor FROM transactions
     WHERE user_id = ? AND installment_no IS NOT NULL AND currency <> 'TRY' AND deleted_at IS NULL`,
    [userId],
  )).map((row) => [`${row.installment_plan_id}:${row.installment_no}`, row.amount_try_minor]));
  return rows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    startMonth: plan.start_month,
    installmentCount: plan.installment_count,
    totalAmountMinor: plan.total_amount_minor,
    monthlyAmountMinor: plan.monthly_amount_minor,
    currency: plan.currency,
    paymentSourceId: plan.payment_source_id,
    billedTryMinor: lira.get(`${plan.id}:${monthDiff(plan.start_month, period) + 1}`) ?? null,
  }));
}

/**
 * The instalment plan one accepted line becomes, or null when it already exists. Existence is the
 * plan's schedule, the review's own match, so a plan met under any name cannot be opened twice;
 * `claimed` keeps two identical lines of one statement from settling on one plan.
 */
async function planWritesForRow(
  userId: string,
  row: AcceptedStatementRow,
  context: {
    personId: string;
    paymentSourceId: string | null;
    period: MonthKey;
    cycle: CardCycle | null;
    chargeDate: ISODate;
    today: ISODate;
    plans: readonly ExistingPlan[];
    claimed: Set<string>;
  },
): Promise<RowWrite[] | null> {
  const spec = row.plan!;
  const match = planForSighting(
    statementSighting(spec, row.amountMinor, context.period, context.paymentSourceId),
    context.plans,
    context.claimed,
  );
  if (match) {
    context.claimed.add(match.plan.id);
    return null;
  }
  // A repeat of an identical line (`#2` on its key) is a second purchase, and
  // its plan takes the same suffix; the first keeps the identity it always had.
  const repeat = /#\d+$/.exec(row.importKey)?.[0] ?? "";
  const planId = await deterministicId(
    naturalKeys.importInstallmentPlan(userId, row.description + repeat, row.amountMinor, spec.installmentCount, spec.startMonth),
  );
  if (context.plans.some((plan) => plan.id === planId)) return null;
  const built = await buildPlanRows(planId, {
    title: row.description,
    kind: "card_installment",
    totalAmountMinor: null,
    monthlyAmountMinor: row.amountMinor,
    installmentCount: spec.installmentCount,
    currency: "TRY",
    fxRate: null,
    startMonth: spec.startMonth,
    dueDay: context.cycle?.dueDay ?? dayOf(context.chargeDate),
    paymentSourceId: context.paymentSourceId,
    personId: context.personId,
    personIsSelf: true,
    categoryId: row.categoryId,
    note: null,
    tryFactor: 1,
  }, context.today);
  // A statement reaches one month: instalments before this one were billed on statements already past.
  const rows = built.rows.filter((write) => write.table !== "transactions" || Number(write.row.installmentNo) >= (spec.installmentNo ?? 1));
  return context.paymentSourceId && context.cycle ? linkDueRowsToCardStatements(userId, context.paymentSourceId, context.cycle, rows) : rows;
}

/** One accepted line as the single charge it is, settled on the statement's day. */
function singleChargeWrite(
  id: string,
  row: AcceptedStatementRow,
  context: {
    personId: string;
    paymentSourceId: string | null;
    chargeDate: ISODate;
    today: ISODate;
    cardStatementId: string | null;
    subscriptionId: string | null;
  },
): RowWrite {
  // A refund is a negative expense in the same category, so it reduces that category instead of reading as income.
  const signed = row.isRefund ? -row.amountMinor : row.amountMinor;
  return {
    table: "transactions",
    row: {
      id,
      type: "expense",
      amountMinor: signed,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: signed,
      entryDate: context.today,
      purchaseDate: row.date,
      effectiveDate: context.chargeDate,
      status: context.chargeDate <= context.today ? "realized" : "pending",
      categoryId: row.categoryId,
      paymentSourceId: context.paymentSourceId,
      personId: context.personId,
      installmentPlanId: null,
      installmentNo: null,
      cardStatementId: context.cardStatementId,
      subscriptionId: context.subscriptionId,
      isAggregate: false,
      note: row.description,
      origin: "statement",
      importKey: row.importKey,
      deletedAt: null,
    },
  };
}

/**
 * The single charges among the accepted rows, as writes. A line whose deterministic id is already
 * present, or whose payment was confirmed since the review, is SKIPPED, never overwritten: that
 * would discard an edit made after the first import. An instalment line is skipped the same way
 * when its plan already exists.
 */
async function singleChargeWrites(
  userId: string,
  rows: readonly AcceptedStatementRow[],
  context: Omit<Parameters<typeof singleChargeWrite>[2], "subscriptionId">,
): Promise<{ writes: RowWrite[]; writtenIds: string[]; skipped: number }> {
  // The ids first, then ONE existence read: per-row reads are a round trip each on web.
  const ids = await Promise.all(rows.map((row) => deterministicId(naturalKeys.statementTx(userId, row.importKey))));
  const present = await existingTransactionIds(await getSqliteAsync(), userId, ids);
  const writes: RowWrite[] = [];
  const writtenIds: string[] = [];
  for (const [index, row] of rows.entries()) {
    const id = ids[index]!;
    const payment = row.expectedId ? await subscriptionPayment(userId, row.expectedId) : null;
    if (present.has(id) || payment?.row.status === "paid") continue;
    const settles = payment?.row.status === "pending" || payment?.row.status === "late" ? payment : null;
    writes.push(singleChargeWrite(id, row, { ...context, subscriptionId: settles?.row.ref_id ?? null }));
    if (settles) writes.push(...settledExpectedWrites(settles.row, settles.subscription, { transactionId: id, amountMinor: row.amountMinor, auto: false }));
    writtenIds.push(id);
  }
  return { writes, writtenIds, skipped: rows.length - writtenIds.length };
}

export async function commitStatementRows(
  userId: string,
  input: StatementCommitInput,
): Promise<StatementCommitResult> {
  const { personId, period, paymentSourceId, rows } = input;
  if (rows.length === 0) return { writtenIds: [], skipped: 0, plansWritten: 0 };
  if (!isMonthKey(period)) throw new Error("Invalid statement period");
  const today = todayISO();

  await assertLiveTransactionPerson(userId, personId);
  for (const categoryId of new Set(rows.map((row) => row.categoryId))) {
    await assertTransactionCategory(userId, "expense", categoryId, false);
  }
  for (const row of rows) assertAcceptedRow(row);

  const { cycle, chargeDate, statementRow } = await resolveStatementBilling(userId, paymentSourceId, period);
  const cardStatementId = statementRow == null ? null : String(statementRow.row.id);
  const singles = await singleChargeWrites(userId, rows.filter((row) => row.plan == null), { personId, paymentSourceId, chargeDate, today, cardStatementId });
  const writes = [...singles.writes];
  let skipped = singles.skipped;
  let plansWritten = 0;

  const planContext = { personId, paymentSourceId, period, cycle, chargeDate, today, plans: await livePlans(userId, period), claimed: new Set<string>() };
  for (const row of rows.filter((candidate) => candidate.plan != null)) {
    const planRows = await planWritesForRow(userId, row, planContext);
    if (planRows == null) {
      skipped += 1;
      continue;
    }
    writes.push(...planRows);
    plansWritten += 1;
  }

  if (writes.length > 0) {
    if (statementRow && singles.writtenIds.length > 0) writes.unshift(statementRow);
    await writeRows(userId, writes);
  }
  return { writtenIds: singles.writtenIds, skipped, plansWritten };
}
