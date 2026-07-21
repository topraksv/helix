/** Canonical transaction classification and signed-flow helpers. */

import type { Minor } from "./money";
import type { CategoryKind, TransactionType, TxLike } from "./types";

export interface FinancialFlow {
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
 * Older clients could save an income under an expense category (or the
 * reverse). Preserve its cash effect while treating it as a reversal of the
 * referenced category: income +100 in an expense category becomes expense
 * -100. New writes are required to match and can store signed reversals
 * directly.
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
  const flow = financialFlow(tx);
  return flow.type === "income" ? flow.amountTryMinor : -flow.amountTryMinor;
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
