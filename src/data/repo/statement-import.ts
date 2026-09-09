/**
 * Committing the statement rows a person accepted (spec §3.1b).
 *
 * Everything here happens AFTER a review: this module never decides what to
 * import, only how to write what was already approved. Two properties carry
 * the whole thing:
 *
 * - **Deterministic identity.** Each row's id is derived from the statement
 *   line it came from (`naturalKeys.statementTx`), so importing the same
 *   statement twice converges on the same rows instead of adding a second copy
 *   — even across devices, and even if the first import's outbox never synced.
 * - **All or nothing.** One batch, one transaction. A statement that fails
 *   half way through must leave the ledger exactly as it was, because a
 *   half-imported statement is indistinguishable from a complete one.
 */

import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { writeRowsValidated, type RowWrite } from "../../db/mutations";
import { dayOf, isMonthKey, lastDayOf, todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { isValidCardCycle, statementPeriod, type CardCycle, type CardStatementPeriod } from "../../domain/card-statements";
import type { StatementPlanSpec } from "../../domain/statement-import";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import { buildPlanRows, linkDueRowsToCardStatements } from "./installments";
import { assertLiveTransactionPerson, assertTransactionCategory, cardStatementWrite } from "./transactions";

/** One approved row, as the review hands it over. */
export interface AcceptedStatementRow {
  importKey: string;
  /** The date the bank PRINTED, kept as provenance. Not when this is paid. */
  date: ISODate;
  description: string;
  amountMinor: Minor;
  isRefund: boolean;
  /**
   * The owner's column, or null when nothing matched.
   *
   * Null is written as an uncategorised row rather than refused. Requiring a
   * column meant the review had to invent one for every line it could not
   * place, and it did: the first expense column, silently, for the whole
   * statement.
   */
  categoryId: string | null;
  /**
   * Set when the line is one payment of an instalment plan.
   *
   * Such a line does not become a charge at all: it becomes the plan, with the
   * schedule that plan implies. `domain/statement-import.ts` derives it.
   */
  plan: StatementPlanSpec | null;
}

export interface StatementCommitInput {
  personId: string;
  /**
   * The period this statement bills, and the ONLY month the import may reach.
   *
   * Every accepted line used to be dated by the day printed beside it, so one
   * July statement scattered charges across every month its purchases were
   * made in — including months the owner had already reconciled. A statement
   * is one bill, settled on one day; the printed dates survive as
   * `purchaseDate` and decide nothing.
   */
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

/** SQLite binds far more than this. The ids are asked for in groups anyway, so
 *  the statement text stays the same size whatever the import's length. */
const ID_LOOKUP_CHUNK = 200;

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
 * Write the accepted rows in one atomic batch.
 *
 * Rows whose deterministic id is already present are SKIPPED rather than
 * overwritten. Overwriting would silently discard an edit the owner made to
 * that transaction after the first import, which is exactly the kind of loss
 * an importer must never cause. An instalment line is skipped the same way
 * when the plan it implies already exists.
 */
/**
 * When the period is settled, and which statement row the lines hang off.
 *
 * The card decides the one thing this import cannot read off the paper. With a
 * cycle, the day is the card's own due date for the period; without one — a
 * statement imported before its card exists — the last day of the period is
 * the honest stand-in. Either way the whole import stays inside the month the
 * owner named.
 */
async function resolveStatementBilling(
  userId: string,
  paymentSourceId: string | null,
  period: MonthKey,
): Promise<{ cycle: CardCycle | null; chargeDate: ISODate; statementRow: RowWrite | null }> {
  if (paymentSourceId == null) return { cycle: null, chargeDate: lastDayOf(period), statementRow: null };
  const sqlite = await getSqliteAsync();
  const card = await sqlite.getFirstAsync<{ id: string; statement_day: number | null; due_day: number | null }>(
    `SELECT id, statement_day, due_day FROM payment_sources
     WHERE id = ? AND user_id = ? AND type = 'credit_card' AND deleted_at IS NULL`,
    [paymentSourceId, userId],
  );
  if (!card) throw new Error("Statement payment source does not exist");
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

/**
 * The instalment plan one accepted line becomes, or null when it already exists.
 *
 * A plan's identity is the SAME one the workbook importer uses, and that is
 * the whole of the matching the review cannot do on its own: two statements of
 * one plan derive the same title, instalment amount, count and start month, so
 * they derive the same id and the second converges on the first instead of
 * creating a rival plan. A workbook that already brought the plan in is met
 * the same way.
 */
async function planWritesForRow(
  userId: string,
  row: AcceptedStatementRow,
  context: {
    personId: string;
    paymentSourceId: string | null;
    cycle: CardCycle | null;
    chargeDate: ISODate;
    today: ISODate;
  },
): Promise<RowWrite[] | null> {
  const spec = row.plan!;
  const sqlite = await getSqliteAsync();
  const planId = await deterministicId(
    naturalKeys.importInstallmentPlan(userId, row.description, row.amountMinor, spec.installmentCount, spec.startMonth),
  );
  const existing = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM installment_plans WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [planId, userId],
  );
  if (existing) return null;
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
  return context.paymentSourceId && context.cycle
    ? linkDueRowsToCardStatements(userId, context.paymentSourceId, context.cycle, built.rows)
    : built.rows;
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
  },
): RowWrite {
  // A refund is an expense with a negative amount, in the same category — the
  // canonical form the rest of the ledger already uses, so a refund reduces
  // its category rather than appearing as unrelated income.
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
      subscriptionId: null,
      isAggregate: false,
      note: row.description,
      origin: "statement",
      importKey: row.importKey,
      deletedAt: null,
    },
  };
}

export async function commitStatementRows(
  userId: string,
  input: StatementCommitInput,
): Promise<StatementCommitResult> {
  const { personId, period, paymentSourceId, rows } = input;
  if (rows.length === 0) return { writtenIds: [], skipped: 0, plansWritten: 0 };
  if (!isMonthKey(period)) throw new Error("Invalid statement period");
  const sqlite = await getSqliteAsync();
  const today = todayISO();

  await assertLiveTransactionPerson(userId, personId);
  for (const categoryId of new Set(rows.map((row) => row.categoryId))) {
    await assertTransactionCategory(userId, "expense", categoryId, false);
  }
  for (const row of rows) assertAcceptedRow(row);

  const { cycle, chargeDate, statementRow } = await resolveStatementBilling(userId, paymentSourceId, period);

  const writes: RowWrite[] = [];
  const writtenIds: string[] = [];
  let skipped = 0;
  let plansWritten = 0;

  const singles = rows.filter((row) => row.plan == null);

  // The ids first, then ONE existence read for all of them. Per-row point
  // reads are what a statement import spent its time on, and on web each is a
  // round trip to the SQLite worker.
  const idByRow = new Map<string, string>();
  for (const row of singles) {
    idByRow.set(row.importKey, await deterministicId(naturalKeys.statementTx(userId, row.importKey)));
  }
  const present = await existingTransactionIds(sqlite, userId, [...idByRow.values()]);

  for (const row of singles) {
    const id = idByRow.get(row.importKey)!;
    if (present.has(id)) {
      skipped += 1;
      continue;
    }
    writes.push(singleChargeWrite(id, row, {
      personId,
      paymentSourceId,
      chargeDate,
      today,
      cardStatementId: statementRow == null ? null : String(statementRow.row.id),
    }));
    writtenIds.push(id);
  }

  for (const row of rows.filter((candidate) => candidate.plan != null)) {
    const planRows = await planWritesForRow(userId, row, { personId, paymentSourceId, cycle, chargeDate, today });
    if (planRows == null) {
      skipped += 1;
      continue;
    }
    writes.push(...planRows);
    plansWritten += 1;
  }

  if (writes.length > 0) {
    if (statementRow && writtenIds.length > 0) writes.unshift(statementRow);
    // One call, one database transaction: a failure anywhere rolls the whole
    // statement back rather than leaving a partial import nobody can identify.
    await writeRowsValidated(userId, writes, () => Promise.resolve());
  }
  return { writtenIds, skipped, plansWritten };
}
