import type { ISODate } from "./dates";
import type { TransactionType } from "./types";

export interface SearchableTransaction {
  id: string;
  type: TransactionType;
  categoryId: string | null;
  paymentSourceId: string | null;
  effectiveDate: ISODate;
  searchText: string;
}

interface TransactionSearchFilters {
  query: string;
  type: TransactionType | null;
  categoryId: string | null;
  paymentSourceId: string | null;
  from: ISODate | null;
  to: ISODate | null;
}

export function filterTransactions<T extends SearchableTransaction>(
  transactions: readonly T[],
  filters: TransactionSearchFilters,
  limit = 100,
): T[] {
  const query = filters.query.trim().toLocaleLowerCase("tr-TR");
  const matches = transactions.filter((transaction) =>
    (query === "" || transaction.searchText.toLocaleLowerCase("tr-TR").includes(query)) &&
    (filters.type == null || transaction.type === filters.type) &&
    (filters.categoryId == null || transaction.categoryId === filters.categoryId) &&
    (filters.paymentSourceId == null || transaction.paymentSourceId === filters.paymentSourceId) &&
    (filters.from == null || transaction.effectiveDate >= filters.from) &&
    (filters.to == null || transaction.effectiveDate <= filters.to),
  );
  return matches
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate) || right.id.localeCompare(left.id))
    .slice(0, Math.max(0, limit));
}

export type TransactionSortMode = "recent" | "oldest" | "highest" | "lowest";

interface SortableTransaction {
  id: string;
  effectiveDate: ISODate;
  amountTryMinor: number;
}

/**
 * Order search results the way the user asked for them.
 *
 * Amount order compares MAGNITUDE, not sign. A refund is stored as a negative
 * amount of the same type, and "the biggest amounts first" plainly means the
 * biggest sums — sorting by the signed value would bury a large refund at the
 * far end of the list, which is where nobody looks for it.
 *
 * `id` breaks every tie so the order is total: two rows on the same day for the
 * same amount must not swap places between renders.
 */
export function sortTransactions<T extends SortableTransaction>(
  rows: readonly T[],
  mode: TransactionSortMode,
): T[] {
  const byId = (left: T, right: T) => left.id.localeCompare(right.id);
  return [...rows].sort((left, right) => {
    switch (mode) {
      case "oldest":
        return left.effectiveDate.localeCompare(right.effectiveDate) || byId(left, right);
      case "highest":
        return Math.abs(right.amountTryMinor) - Math.abs(left.amountTryMinor) || byId(left, right);
      case "lowest":
        return Math.abs(left.amountTryMinor) - Math.abs(right.amountTryMinor) || byId(left, right);
      default:
        return right.effectiveDate.localeCompare(left.effectiveDate) || byId(left, right);
    }
  });
}
