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
