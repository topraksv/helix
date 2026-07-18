/** Bound nested transaction rows without fighting the parent ScrollView. */

export const INITIAL_TRANSACTION_ROWS = 80;
export const TRANSACTION_ROW_PAGE = 80;

export function nextVisibleTransactionCount(total: number, current: number): number {
  return Math.min(total, current + TRANSACTION_ROW_PAGE);
}
