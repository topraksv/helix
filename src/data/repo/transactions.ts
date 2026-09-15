import { getSqliteAsync } from "../../db/client";
import { transactions } from "../../db/schema";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import {
  assertLiveRow,
  assertRestorableRows,
  fromDbShape,
  nowIso,
  restoreRow,
  softDelete,
  writeRows,
  writeRowsValidated,
  type RowWrite,
} from "../../db/mutations";
import { addMonthsToKey, firstDayOf, isCurrentOrFutureMonth, isISODate, isMonthKey, lastDayOf, monthKeyOf, todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, isSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import type { TransactionOrigin, PaymentSourceType, TransactionType } from "../../domain/types";
import { reconciliationDelta } from "../../domain/balance";
import { isSupportedCurrency } from "../../domain/fx-provider";
import { categoryAcceptsTransaction } from "../../domain/transactions";
import { isValidCardCycle, statementForPurchase, statementPeriod, type CardStatementPeriod } from "../../domain/card-statements";
import { CreditCardCycleRequiredError, RefundExceedsExpenseError, StatementPaymentTooLargeError } from "./errors";
import { assertInvestmentWrites } from "./investment-validation";

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface NewTransaction {
  type: TransactionType;
  amountMinor: Minor;
  currency: string;
  fxRate: string | null;
  amountTryMinor: Minor;
  /** Occurrence date supplied by the caller. For a card expense this becomes
   *  purchaseDate and the ledger effectiveDate is resolved from its statement. */
  effectiveDate: ISODate;
  categoryId: string;
  paymentSourceId: string | null;
  personId: string;
  note: string | null;
  isAggregate?: boolean;
  subscriptionId?: string | null;
  /**
   * Where this row came from. Defaults to `manual`, because this is the entry
   * point the forms use; every automated writer states its own origin.
   */
  origin?: TransactionOrigin;
  /** The source line this row was created from, for a repeatable import. */
  importKey?: string | null;
  /** The expense this row refunds, when it is a refund linked to one. */
  refundOfTransactionId?: string | null;
}

export interface LivePaymentSource {
  id: string;
  type: PaymentSourceType;
  statement_day: number | null;
  due_day: number | null;
}

export async function livePaymentSource(userId: string, sourceId: string | null): Promise<LivePaymentSource | null> {
  if (!sourceId) return null;
  const sqlite = await getSqliteAsync();
  return sqlite.getFirstAsync<LivePaymentSource>(
    `SELECT id, type, statement_day, due_day FROM payment_sources
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId],
  );
}

export async function assertLiveTransactionPerson(userId: string, personId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [personId, userId],
  );
  if (!person) throw new Error("Transaction person does not exist");
}

export async function cardStatementWrite(
  userId: string,
  paymentSourceId: string,
  period: CardStatementPeriod,
): Promise<RowWrite> {
  const id = await deterministicId(naturalKeys.cardStatement(userId, paymentSourceId, period.periodMonth));
  const sqlite = await getSqliteAsync();
  const existing = await sqlite.getFirstAsync<{ created_at: string }>(
    `SELECT created_at FROM credit_card_statements WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return {
    table: "credit_card_statements",
    row: {
      id,
      paymentSourceId,
      periodMonth: period.periodMonth,
      statementDate: period.statementDate,
      dueDate: period.dueDate,
      createdAt: existing?.created_at,
      deletedAt: null,
    },
  };
}

async function resolveSingleTransactionDates(
  userId: string,
  input: Pick<NewTransaction, "type" | "paymentSourceId" | "effectiveDate" | "isAggregate">,
): Promise<{
  purchaseDate: ISODate | null;
  effectiveDate: ISODate;
  cardStatementId: string | null;
  statementWrite: RowWrite | null;
}> {
  const source = await livePaymentSource(userId, input.paymentSourceId);
  if (input.paymentSourceId && !source) throw new Error("Transaction payment source does not exist");
  if (!source || source.type !== "credit_card" || input.type !== "expense") {
    return { purchaseDate: null, effectiveDate: input.effectiveDate, cardStatementId: null, statementWrite: null };
  }
  const cycle = { statementDay: source.statement_day, dueDay: source.due_day };
  if (!isValidCardCycle(cycle)) throw new CreditCardCycleRequiredError();
  // A month-only card charge has no day of its own, so it sits on the last day
  // that still joins that month's statement: the closing date. It is billed with
  // that statement and reaches the balance on its due date, like any purchase.
  const period = input.isAggregate
    ? statementPeriod(monthKeyOf(input.effectiveDate), cycle)
    : statementForPurchase(input.effectiveDate, cycle);
  const statementWrite = await cardStatementWrite(userId, source.id, period);
  return {
    purchaseDate: input.isAggregate ? period.statementDate : input.effectiveDate,
    effectiveDate: period.dueDate,
    cardStatementId: String(statementWrite.row.id),
    statementWrite,
  };
}

export function assertSignedTransactionAmounts(amountMinor: Minor, amountTryMinor: Minor): void {
  // Zero is refused once: equal signs already make a zero TRY amount a zero amount.
  if (
    !isSupportedMinorAmount(amountMinor, false) ||
    !isSupportedMinorAmount(amountTryMinor) ||
    Math.sign(amountMinor) !== Math.sign(amountTryMinor)
  ) {
    throw new Error("Invalid signed transaction amount");
  }
}

export async function assertTransactionCategory(
  userId: string,
  type: TransactionType,
  categoryId: string | null,
  required: boolean,
): Promise<void> {
  if (!categoryId) {
    if (required) throw new Error("Transaction category is required");
    return;
  }
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<{ kind: "expense" | "income"; is_transfer: number }>(
    `SELECT kind, is_transfer FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId],
  );
  if (
    !category
    || !categoryAcceptsTransaction(type, category.kind)
    || (type === "transfer" && category.is_transfer !== 1)
  ) {
    throw new Error("Transaction type and category do not match");
  }
}

async function writeTransactionRows(
  userId: string,
  writes: RowWrite[],
  validate?: (sqlite: Parameters<typeof assertLiveRow>[0]) => Promise<void>,
): Promise<void> {
  await writeRowsValidated(
    userId,
    writes,
    async (sqlite) => {
      if (validate) await validate(sqlite);
      await assertInvestmentWrites(sqlite, userId, writes);
    },
  );
}

/**
 * A refund may be linked only to a live, positive, single expense in its own
 * currency, and may not take more than is left of it.
 *
 * Instalment rows are refunded against their plan instead (`addInstallmentRefund`),
 * and a refund of a refund is not a thing a statement prints. `excludeId` is the
 * refund being edited, which must not count against itself.
 */
async function assertRefundOf(
  userId: string,
  refund: { type: TransactionType; amountMinor: Minor; currency: string; refundOfTransactionId: string },
  excludeId: string | null,
): Promise<void> {
  const sqlite = await getSqliteAsync();
  const original = await sqlite.getFirstAsync<{
    type: string; amount_minor: number; currency: string; installment_plan_id: string | null; refund_of_transaction_id: string | null;
  }>(
    `SELECT type, amount_minor, currency, installment_plan_id, refund_of_transaction_id FROM transactions
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [refund.refundOfTransactionId, userId],
  );
  if (
    !original
    || original.type !== "expense"
    || original.amount_minor <= 0
    || original.installment_plan_id != null
    || original.refund_of_transaction_id != null
    || refund.type !== "expense"
    || refund.amountMinor >= 0
    || refund.currency !== original.currency
  ) {
    throw new Error("Refund must be linked to a live single expense in its currency");
  }
  const refunded = await sqlite.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount_minor) AS total FROM transactions
     WHERE user_id = ? AND refund_of_transaction_id = ? AND deleted_at IS NULL AND id != ?`,
    [userId, refund.refundOfTransactionId, excludeId ?? ""],
  );
  const leftMinor = original.amount_minor + Number(refunded?.total ?? 0);
  if (-refund.amountMinor > leftMinor) throw new RefundExceedsExpenseError(Math.max(leftMinor, 0));
}

export async function addTransaction(userId: string, input: NewTransaction): Promise<string> {
  if (!isISODate(input.effectiveDate)) throw new Error("Invalid transaction date");
  if (!isSupportedCurrency(input.currency)) throw new Error("Invalid transaction currency");
  assertSignedTransactionAmounts(input.amountMinor, input.amountTryMinor);
  assertInputWithinLimit(input.note, "note");
  await assertLiveTransactionPerson(userId, input.personId);
  await assertTransactionCategory(userId, input.type, input.categoryId, true);
  if (input.refundOfTransactionId) {
    await assertRefundOf(userId, { ...input, refundOfTransactionId: input.refundOfTransactionId }, null);
  }
  const today = todayISO();
  const id = newId();
  const dates = await resolveSingleTransactionDates(userId, input);
  await writeTransactionRows(userId, [
    ...(dates.statementWrite ? [dates.statementWrite] : []),
    {
      table: "transactions",
      row: {
        id,
        ...input,
        purchaseDate: dates.purchaseDate,
        effectiveDate: dates.effectiveDate,
        cardStatementId: dates.cardStatementId,
        isAggregate: input.isAggregate ?? false,
        subscriptionId: input.subscriptionId ?? null,
        origin: input.origin ?? "manual",
        importKey: input.importKey ?? null,
        refundOfTransactionId: input.refundOfTransactionId ?? null,
        installmentPlanId: null,
        installmentNo: null,
        entryDate: today,
        status: dates.effectiveDate <= today ? "realized" : "pending",
        deletedAt: null,
      },
    },
  ]);
  return id;
}

/** Editable fields of a single transaction (installment linkage is preserved). */
export interface TransactionPatch {
  type: TransactionType;
  amountMinor: Minor;
  currency: string;
  fxRate: string | null;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  isAggregate?: boolean;
  categoryId: string;
  paymentSourceId: string | null;
  personId: string;
  note: string | null;
}

/**
 * Update an existing transaction in place; status is re-derived from the date.
 *
 * `existing` is the row in APPLICATION shape (camelCase), which is what the
 * live queries hand a screen — not the snake_case row a raw `SELECT` returns.
 * Both used to be typed `Record<string, unknown>`, so the two shapes were
 * interchangeable to the compiler while spreading the wrong one here would
 * have written a row of undefined columns.
 */
export async function updateTransaction(
  userId: string,
  existing: Partial<typeof transactions.$inferSelect> & { id?: unknown },
  patch: TransactionPatch,
): Promise<void> {
  if (!isISODate(patch.effectiveDate)) throw new Error("Invalid transaction date");
  if (!isSupportedCurrency(patch.currency)) throw new Error("Invalid transaction currency");
  assertSignedTransactionAmounts(patch.amountMinor, patch.amountTryMinor);
  assertInputWithinLimit(patch.note, "note");
  await assertLiveTransactionPerson(userId, patch.personId);
  await assertTransactionCategory(userId, patch.type, patch.categoryId, true);
  // An edit that turns a linked refund back into a charge ends the link; one
  // that keeps it a refund is checked against what is left of its expense.
  const refundOfTransactionId = patch.amountMinor < 0 ? existing.refundOfTransactionId ?? null : null;
  if (refundOfTransactionId) {
    await assertRefundOf(userId, { ...patch, refundOfTransactionId }, String(existing.id));
  }
  const dates = await resolveSingleTransactionDates(userId, patch);
  await writeTransactionRows(
    userId,
    [
      ...(dates.statementWrite ? [dates.statementWrite] : []),
      {
        table: "transactions",
        row: {
          ...existing,
          ...patch,
          refundOfTransactionId,
          purchaseDate: dates.purchaseDate,
          effectiveDate: dates.effectiveDate,
          cardStatementId: dates.cardStatementId,
          status: dates.effectiveDate <= todayISO() ? "realized" : "pending",
        },
      },
    ],
    (sqlite) => assertLiveRow(sqlite, "transactions", userId, String(existing.id)),
  );
}

export async function deleteTransaction(userId: string, id: string) {
  const sqlite = await getSqliteAsync();
  const previous = await sqlite.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    [id, userId],
  );
  if (!previous) return null;
  const writes: RowWrite[] = [{
    table: "transactions",
    row: { ...fromDbShape("transactions", previous), deletedAt: nowIso() },
  }];
  await writeTransactionRows(userId, writes);
  return previous;
}

export function restoreTransaction(userId: string, snapshot: Record<string, unknown>): Promise<void> {
  const writes: RowWrite[] = [{
    table: "transactions",
    row: { ...fromDbShape("transactions", snapshot), deletedAt: null },
  }];
  return writeTransactionRows(userId, writes, (sqlite) => assertRestorableRows(sqlite, userId, writes));
}

export function deleteBalanceAdjustment(userId: string, id: string) {
  return softDelete(userId, "balance_adjustments", id);
}

export function restoreBalanceAdjustment(userId: string, snapshot: Record<string, unknown>): Promise<void> {
  return restoreRow(userId, "balance_adjustments", snapshot);
}

/**
 * Reconcile to a real-world balance WITHOUT rewriting history. Stores the
 * difference between the target and the currently-computed balance as one
 * balance adjustment dated today, so every prior month's chain (and the opening
 * balance) is untouched — only today onward shifts by the delta.
 *
 * `computedNowMinor` is the balance the caller currently shows (it already
 * includes any earlier same-day adjustment). The adjustment row is keyed by day
 * so repeated corrections converge on the target instead of stacking: we back
 * out today's existing adjustment before computing the new delta.
 */
export async function setCurrentBalance(
  userId: string,
  targetMinor: Minor,
  computedNowMinor: Minor,
  note: string | null = null,
): Promise<void> {
  assertSupportedMinorAmount(targetMinor);
  assertInputWithinLimit(note, "note");
  const today = todayISO();
  const id = await deterministicId(naturalKeys.balanceAdjustment(userId, today));
  const sqlite = await getSqliteAsync();
  const prev = await sqlite.getFirstAsync<{ amount_minor: number; created_at: string }>(
    `SELECT amount_minor, created_at FROM balance_adjustments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  const prevAmount = prev?.amount_minor ?? 0;
  // computedNow already contains prevAmount; the new adjustment must make the
  // total land on target: (computedNow - prevAmount) + delta = target.
  const delta = reconciliationDelta(targetMinor, computedNowMinor, prevAmount);
  assertSupportedMinorAmount(delta);
  await writeRows(userId, [
    {
      table: "balance_adjustments",
      row: {
        id,
        date: today,
        amountMinor: delta,
        note,
        createdAt: prev?.created_at,
        // Returning exactly to the unadjusted balance removes the reconciliation
        // from the live ledger instead of leaving a meaningless zero row.
        deletedAt: delta === 0 ? nowIso() : null,
      },
    },
  ]);
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Bulk history entry (approved feature)
// ---------------------------------------------------------------------------

export async function bulkMonthEntry(
  userId: string,
  month: MonthKey,
  personId: string,
  entries: { categoryId: string; type: TransactionType; amountMinor: Minor }[],
): Promise<void> {
  if (!isMonthKey(month)) throw new Error("Invalid bulk entry month");
  if (isCurrentOrFutureMonth(month)) throw new Error("Bulk history accepts past months only");
  entries.forEach((entry) => assertSupportedMinorAmount(entry.amountMinor, false));
  await assertLiveTransactionPerson(userId, personId);
  await Promise.all(
    entries.map((entry) =>
      assertTransactionCategory(userId, entry.type, entry.categoryId, true),
    ),
  );
  const today = todayISO();
  // A month total belongs to the month, not to a day in it. It is stored on the
  // first like every other dateless row — the workbook import and the entry
  // form's "Sadece ay" both do — because the fifteenth this used to write put
  // the same kind of row on two different days of one month.
  const effectiveDate = firstDayOf(month);
  const status = "realized" as const;
  const writes: RowWrite[] = await Promise.all(
    entries.map(async (entry) => ({
      table: "transactions" as const,
      row: {
        id: newId(),
        type: entry.type,
        amountMinor: entry.amountMinor,
        currency: "TRY",
        fxRate: null,
        amountTryMinor: entry.amountMinor,
        entryDate: today,
        effectiveDate,
        status,
        categoryId: entry.categoryId,
        paymentSourceId: null,
        personId,
        installmentPlanId: null,
        installmentNo: null,
        subscriptionId: null,
        isAggregate: true,
        note: null,
        origin: "manual",
        deletedAt: null,
      },
    })),
  );
  await writeTransactionRows(userId, writes);
}

// ---------------------------------------------------------------------------
// Statement payments and declared opening balances
// ---------------------------------------------------------------------------

export interface NewStatementPayment {
  statementId: string;
  paidOn: ISODate;
  amountMinor: Minor;
  kind: "full" | "minimum" | "partial";
  note: string | null;
}

/** What is still owed on a statement: the owner's charges on it less what was paid. */
async function statementRemainingMinor(
  sqlite: Parameters<typeof assertLiveRow>[0],
  userId: string,
  statementId: string,
): Promise<Minor> {
  const charges = await sqlite.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(t.amount_try_minor) AS total FROM transactions t
     JOIN persons p ON p.id = t.person_id AND p.user_id = t.user_id AND p.is_self = 1
     WHERE t.user_id = ? AND t.card_statement_id = ? AND t.type = 'expense' AND t.deleted_at IS NULL`,
    [userId, statementId],
  );
  const paid = await sqlite.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(amount_minor) AS total FROM card_statement_payments
     WHERE user_id = ? AND statement_id = ? AND deleted_at IS NULL`,
    [userId, statementId],
  );
  return Number(charges?.total ?? 0) - Number(paid?.total ?? 0);
}

/**
 * Record a payment the owner made against one card statement (spec §3.1f).
 *
 * From the first one on, the statement is no longer paid in full on its due
 * date: `settleCardStatements` counts what was paid, on the day it was paid.
 * Only the owner's own card takes one — a watched card's charges never reach
 * this balance, so neither can a payment of them — and never for more than is
 * still owed. That limit is checked inside the write, so two devices cannot
 * each pay the same remainder.
 */
export async function addStatementPayment(userId: string, input: NewStatementPayment): Promise<string> {
  if (!isISODate(input.paidOn) || input.paidOn > todayISO()) throw new Error("Invalid statement payment date");
  if (!["full", "minimum", "partial"].includes(input.kind)) throw new Error("Invalid statement payment kind");
  assertSupportedMinorAmount(input.amountMinor);
  if (input.amountMinor <= 0) throw new Error("Statement payment must be positive");
  assertInputWithinLimit(input.note, "note");
  const sqlite = await getSqliteAsync();
  const statement = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT cs.id FROM credit_card_statements cs
     JOIN payment_sources ps ON ps.id = cs.payment_source_id AND ps.user_id = cs.user_id AND ps.deleted_at IS NULL
     JOIN persons p ON p.id = ps.person_id AND p.user_id = ps.user_id AND p.deleted_at IS NULL
     WHERE cs.id = ? AND cs.user_id = ? AND cs.deleted_at IS NULL AND ps.type = 'credit_card' AND p.is_self = 1`,
    [input.statementId, userId],
  );
  if (!statement) throw new Error("Statement does not belong to the owner's card");
  const id = newId();
  await writeRowsValidated(
    userId,
    [{ table: "card_statement_payments", row: { id, ...input, deletedAt: null } }],
    async (db) => {
      await assertLiveRow(db, "credit_card_statements", userId, input.statementId);
      const remainingMinor = await statementRemainingMinor(db, userId, input.statementId);
      if (input.amountMinor > remainingMinor) throw new StatementPaymentTooLargeError(Math.max(remainingMinor, 0));
    },
  );
  return id;
}

export function deleteStatementPayment(userId: string, id: string) {
  return softDelete(userId, "card_statement_payments", id);
}

export function restoreStatementPayment(userId: string, snapshot: Record<string, unknown>): Promise<void> {
  return restoreRow(userId, "card_statement_payments", snapshot);
}

/**
 * Declare the balance a month opened with (spec §2.7): a declaration dated the
 * last day of the month before, which the ledger then holds whatever is later
 * entered on or before that day.
 *
 * `differenceMinor` is what the declaration changes as the ledger stands now,
 * read off the chain by the caller. The ledger recomputes it; it is stored for
 * a client that predates declarations and reads the row as a plain adjustment.
 * One declaration per month, so declaring a month again replaces it.
 */
export async function declareMonthOpeningBalance(
  userId: string,
  month: MonthKey,
  declaredMinor: Minor,
  differenceMinor: Minor,
): Promise<string> {
  const write = await monthOpeningDeclarationWrite(userId, month, declaredMinor, differenceMinor, null);
  await writeRows(userId, [write]);
  return String(write.row.id);
}

/** The row `declareMonthOpeningBalance` writes, for a caller that writes it together with others. */
export async function monthOpeningDeclarationWrite(
  userId: string,
  month: MonthKey,
  declaredMinor: Minor,
  differenceMinor: Minor,
  note: string | null,
): Promise<RowWrite> {
  if (!isMonthKey(month) || month > monthKeyOf(todayISO())) throw new Error("Invalid declaration month");
  assertSupportedMinorAmount(declaredMinor);
  assertSupportedMinorAmount(differenceMinor);
  const id = await deterministicId(naturalKeys.monthOpeningDeclaration(userId, month));
  const sqlite = await getSqliteAsync();
  const previous = await sqlite.getFirstAsync<{ created_at: string }>(
    `SELECT created_at FROM balance_adjustments WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return {
    table: "balance_adjustments",
    row: {
      id,
      date: lastDayOf(addMonthsToKey(month, -1)),
      amountMinor: differenceMinor,
      declaredMinor,
      note,
      createdAt: previous?.created_at,
      deletedAt: null,
    },
  };
}
