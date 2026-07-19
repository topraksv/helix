import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { nowIso, softDelete, writeRows, type RowWrite } from "../../db/mutations";
import { isCurrentOrFutureMonth, todayISO, type ISODate, type MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, isSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import type { PaymentSourceType, TransactionType } from "../../domain/types";
import { reconciliationDelta } from "../../domain/balance";
import { categoryAcceptsTransaction } from "../../domain/transactions";
import { isValidCardCycle, statementForPurchase, type CardStatementPeriod } from "../../domain/card-statements";
import { CreditCardCycleRequiredError } from "./errors";

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
  if (!source || source.type !== "credit_card" || input.type !== "expense") {
    return { purchaseDate: null, effectiveDate: input.effectiveDate, cardStatementId: null, statementWrite: null };
  }
  if (input.isAggregate) throw new CreditCardCycleRequiredError();
  const cycle = { statementDay: source.statement_day, dueDay: source.due_day };
  if (!isValidCardCycle(cycle)) throw new CreditCardCycleRequiredError();
  const period = statementForPurchase(input.effectiveDate, cycle);
  const statementWrite = await cardStatementWrite(userId, source.id, period);
  return {
    purchaseDate: input.effectiveDate,
    effectiveDate: period.dueDate,
    cardStatementId: String(statementWrite.row.id),
    statementWrite,
  };
}

export function assertSignedTransactionAmounts(amountMinor: Minor, amountTryMinor: Minor): void {
  if (
    !isSupportedMinorAmount(amountMinor, false) ||
    !isSupportedMinorAmount(amountTryMinor, false) ||
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
  const category = await sqlite.getFirstAsync<{ kind: "expense" | "income" }>(
    `SELECT kind FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId],
  );
  if (!category || !categoryAcceptsTransaction(type, category.kind)) {
    throw new Error("Transaction type and category do not match");
  }
}

export async function addTransaction(userId: string, input: NewTransaction): Promise<string> {
  assertSignedTransactionAmounts(input.amountMinor, input.amountTryMinor);
  assertInputWithinLimit(input.note, "note");
  await assertTransactionCategory(userId, input.type, input.categoryId, true);
  const today = todayISO();
  const id = newId();
  const dates = await resolveSingleTransactionDates(userId, input);
  await writeRows(userId, [
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

/** Update an existing transaction in place; status is re-derived from the date. */
export async function updateTransaction(
  userId: string,
  existing: Record<string, unknown>,
  patch: TransactionPatch,
): Promise<void> {
  assertSignedTransactionAmounts(patch.amountMinor, patch.amountTryMinor);
  assertInputWithinLimit(patch.note, "note");
  await assertTransactionCategory(userId, patch.type, patch.categoryId, true);
  const dates = await resolveSingleTransactionDates(userId, patch);
  await writeRows(userId, [
    ...(dates.statementWrite ? [dates.statementWrite] : []),
    {
      table: "transactions",
      row: {
        ...existing,
        ...patch,
        purchaseDate: dates.purchaseDate,
        effectiveDate: dates.effectiveDate,
        cardStatementId: dates.cardStatementId,
        status: dates.effectiveDate <= todayISO() ? "realized" : "pending",
      },
    },
  ]);
}

export async function deleteTransaction(userId: string, id: string) {
  return softDelete(userId, "transactions", id);
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

/** How many live transactions reference a category — for a warn-before-delete
 *  confirmation (deleting a category leaves its rows uncategorized, not lost). */
export async function countTransactionsForCategory(userId: string, categoryId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
    [userId, categoryId],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Bulk history entry (approved feature)
// ---------------------------------------------------------------------------

export async function bulkMonthEntry(
  userId: string,
  month: MonthKey,
  personId: string,
  entries: { categoryId: string; kind: "expense" | "income"; amountMinor: Minor; isInvestment?: boolean }[],
): Promise<void> {
  if (isCurrentOrFutureMonth(month)) throw new Error("Bulk history accepts past months only");
  entries.forEach((entry) => assertSupportedMinorAmount(entry.amountMinor, false));
  await Promise.all(
    entries.map((entry) =>
      assertTransactionCategory(userId, entry.isInvestment ? "transfer" : entry.kind, entry.categoryId, true),
    ),
  );
  const today = todayISO();
  const effectiveDate = `${month}-15`; // mid-month anchor for aggregates
  const status = "realized" as const;
  const writes: RowWrite[] = await Promise.all(
    entries.map(async (entry) => ({
      table: "transactions" as const,
      row: {
        id: newId(),
        type: entry.isInvestment ? "transfer" : entry.kind,
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
        deletedAt: null,
      },
    })),
  );
  await writeRows(userId, writes);
}
