/** Canonical transaction classification and signed-flow helpers. */

import { tr } from "../i18n/tr";
import type { Minor } from "./money";
import type { CategoryKind, TransactionType, TxLike } from "./types";

/**
 * Whether a stored row is a workbook column's remainder (spec §8.3).
 *
 * Recognised by the three things only the importer writes together: its
 * origin, its month-level shape and its exact note. There is no marker column;
 * an owner who rewrites the note has made the row their own.
 */
export function isWorkbookRemainderRow(row: { origin?: string | null; isAggregate: boolean; note?: string | null }): boolean {
  return row.origin === "spreadsheet" && row.isAggregate && row.note === tr.importer.columnRemainder;
}

interface FinancialFlow {
  type: TransactionType;
  amountTryMinor: Minor;
}

function normalizeFinancialFlow(
  type: TransactionType,
  amountTryMinor: Minor,
  categoryKind: CategoryKind | null,
): FinancialFlow {
  if (type === "transfer" || !categoryKind || categoryKind === type) return { type, amountTryMinor };
  return { type: categoryKind, amountTryMinor: -amountTryMinor };
}

/**
 * A row saved under a category of the opposite kind is read as a reversal of
 * that category, keeping its cash effect: income +100 in an expense category
 * becomes expense -100.
 */
export function financialFlow(tx: TxLike): FinancialFlow {
  return normalizeFinancialFlow(tx.type, tx.amountTryMinor, tx.categoryKind);
}

export function categoryAcceptsTransaction(type: TransactionType, categoryKind: CategoryKind): boolean {
  return type === "transfer" ? categoryKind === "expense" : type === categoryKind;
}

/** Financial type used by quick/month-table entry for a persisted category. */
export function categoryTableEntryType(category: {
  kind: CategoryKind;
  isTransfer: boolean;
}): TransactionType {
  return category.kind === "expense" && category.isTransfer ? "transfer" : category.kind;
}

export function signedBalanceEffect(tx: TxLike): Minor {
  return signedBalanceEffectOf(tx.type, tx.amountTryMinor, tx.categoryKind);
}

export function projectedTransactionFlow(tx: TxLike): {
  direction: "in" | "out";
  amountTryMinor: Minor;
} {
  const effect = signedBalanceEffect(tx);
  return effect >= 0
    ? { direction: "in", amountTryMinor: effect }
    : { direction: "out", amountTryMinor: -effect };
}

export function signedBalanceEffectOf(
  type: TransactionType,
  amountTryMinor: Minor,
  categoryKind: CategoryKind | null,
): Minor {
  const flow = normalizeFinancialFlow(type, amountTryMinor, categoryKind);
  return flow.type === "income" ? flow.amountTryMinor : -flow.amountTryMinor;
}

/**
 * What is still refundable on an expense (spec §2.2): its amount plus the
 * negative refunds linked to it. `exceptId` leaves out the refund being
 * edited, whose old amount is about to be replaced.
 */
export function refundLeftMinor(
  expense: { id: string; amountMinor: Minor },
  rows: readonly { id: string; refundOfTransactionId?: string | null; amountMinor: Minor }[],
  exceptId?: string,
): Minor {
  return expense.amountMinor + rows
    .filter((row) => row.refundOfTransactionId === expense.id && row.id !== exceptId)
    .reduce((sum, row) => sum + row.amountMinor, 0);
}
