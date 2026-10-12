/**
 * Per-year column resolution for the cash-flow matrix (Mali Tablo).
 *
 * An imported year (or one edited via the `column_years` setting) shows
 * exactly its recorded columns in Excel order; a year without a recording
 * falls back to all active columns. Self-healing rules on top:
 * - a column that gained data in the year surfaces automatically, and
 * - the live (max) year always shows every active column so newly added ones
 *   appear — but columns explicitly claimed by some year stay confined to
 *   those years (only unclaimed manual/template columns bleed into it).
 *
 * `column_years` decides column MEMBERSHIP per year; the DISPLAY order always
 * follows the caller's category order (sortOrder), so reordering columns in
 * settings is reflected 1:1 in the table for every year — including imported
 * ones (whose columns start in Excel order because that's the seed sortOrder).
 */

interface YearColumnCategory {
  id: string;
  isColumn: boolean;
}

interface LedgerCategoryOrder {
  id: string;
  kind: "expense" | "income";
  sortOrder: number;
}

/**
 * Settings exposes two independent sortable lists, expenses then incomes; one
 * global sort-order pass could interleave them. Recreate the order the user
 * edited before resolving each year's membership.
 */
export function orderLedgerCategories<T extends LedgerCategoryOrder>(categories: readonly T[]): T[] {
  return [...categories].sort((left, right) =>
    Number(left.kind === "income") - Number(right.kind === "income")
    || left.sortOrder - right.sortOrder
    || left.id.localeCompare(right.id),
  );
}

export function resolveYearColumns<T extends YearColumnCategory>(
  categories: T[],
  columnYears: Record<string, string[]>,
  year: number,
  maxYear: number,
  dataCategoryIds: ReadonlySet<string>,
): T[] {
  const active = categories.filter((c) => c.isColumn);
  // `column_years` is synced and read unchecked, so a non-array entry (a hand-edited
  // backup, a tampered sync) would throw during render: ignore malformed entries.
  const yearColIds = columnYears[String(year)];
  if (!Array.isArray(yearColIds)) return active;

  const claimed = new Set<string>();
  for (const ids of Object.values(columnYears)) {
    if (!Array.isArray(ids)) continue;
    for (const id of ids) claimed.add(id);
  }

  // Membership: active columns recorded for this year, plus any that gained data
  // in the year (self-heal) and, on the live year, unclaimed columns.
  const activeIds = new Set(active.map((category) => category.id));
  const member = new Set<string>();
  for (const id of yearColIds) if (activeIds.has(id)) member.add(id);
  for (const c of active) {
    if (member.has(c.id)) continue;
    if (dataCategoryIds.has(c.id) || (year === maxYear && !claimed.has(c.id))) member.add(c.id);
  }

  return active.filter((category) => member.has(category.id));
}
