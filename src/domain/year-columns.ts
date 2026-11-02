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
 * `column_years` decides column MEMBERSHIP per year and `year_layouts` what the
 * owner did to that one year: its order, and what it hides. Neither reaches
 * another year. A year never arranged follows the caller's category order.
 * A column holding data in the year stays: hiding it would leave the table's
 * figures adding up to something it no longer shows.
 */

interface YearColumnCategory {
  id: string;
  isColumn: boolean;
  kind?: string;
}

export interface YearLayout {
  order?: string[];
  hidden?: string[];
}
export type YearLayouts = Record<string, YearLayout>;

/** The year's own order inside each kind; anything it never placed keeps its place behind them. */
function arranged<T extends YearColumnCategory>(columns: T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return columns;
  const position = new Map(order.map((id, index) => [id, index]));
  const kinds = [...new Set(columns.map((column) => column.kind))];
  return kinds.flatMap((kind) => {
    const group = columns.filter((column) => column.kind === kind);
    return [
      ...group.filter((column) => position.has(column.id)).sort((a, b) => position.get(a.id)! - position.get(b.id)!),
      ...group.filter((column) => !position.has(column.id)),
    ];
  });
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
  layout: YearLayout = {},
): T[] {
  // Decoded against `year_layouts`'s validator, so `hidden` is a list or absent.
  const hidden = new Set(layout.hidden);
  const order = Array.isArray(layout.order) ? layout.order : undefined;
  const active = categories.filter((c) => c.isColumn && (!hidden.has(c.id) || dataCategoryIds.has(c.id)));
  // `column_years` is synced and read unchecked, so a non-array entry (a hand-edited
  // backup, a tampered sync) would throw during render: ignore malformed entries.
  const yearColIds = columnYears[String(year)];
  if (!Array.isArray(yearColIds)) return arranged(active, order);

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

  return arranged(active.filter((category) => member.has(category.id)), order);
}

/**
 * The categories a form may offer for a day in `year`, that year's columns
 * first. A category outside the table is not a column of any year, so it stays;
 * `keep` is what the row already holds, which an edit must still be able to show.
 */
export function categoriesForYear<T extends YearColumnCategory & { sortOrder: number; kind: "expense" | "income" }>(
  categories: readonly T[],
  context: {
    columnYears: Record<string, string[]>;
    layouts: YearLayouts;
    transactions: readonly { categoryId: string | null; effectiveDate: string; amountTryMinor: number; deletedAt?: string | null }[];
    currentYear: number;
  },
  year: number,
  keep?: string | null,
): T[] {
  const used = new Set<string>();
  let maxYear = context.currentYear;
  for (const row of context.transactions) {
    if (row.deletedAt != null) continue;
    const rowYear = Number(row.effectiveDate.slice(0, 4));
    if (rowYear > maxYear) maxYear = rowYear;
    if (rowYear === year && row.categoryId && row.amountTryMinor !== 0) used.add(row.categoryId);
  }
  const ordered = orderLedgerCategories(categories);
  const columns = resolveYearColumns(ordered, context.columnYears, year, maxYear, used, context.layouts[String(year)]);
  const shown = new Set(columns.map((column) => column.id));
  return [...columns, ...ordered.filter((category) => !shown.has(category.id) && (!category.isColumn || category.id === keep))];
}
