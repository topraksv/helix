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
 */

export interface YearColumnCategory {
  id: string;
  isColumn: boolean;
}

export function resolveYearColumns<T extends YearColumnCategory>(
  categories: T[],
  columnYears: Record<string, string[]>,
  year: number,
  maxYear: number,
  dataCategoryIds: ReadonlySet<string>,
): T[] {
  const active = categories.filter((c) => c.isColumn);
  const yearColIds = columnYears[String(year)];
  if (!yearColIds) return active;

  const byId = new Map(categories.map((c) => [c.id, c]));
  const claimed = new Set<string>();
  for (const ids of Object.values(columnYears)) for (const id of ids) claimed.add(id);

  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of yearColIds) {
    const c = byId.get(id);
    if (c && !seen.has(id)) {
      out.push(c);
      seen.add(id);
    }
  }
  for (const c of active) {
    if (seen.has(c.id)) continue;
    if (dataCategoryIds.has(c.id) || (year === maxYear && !claimed.has(c.id))) {
      out.push(c);
      seen.add(c.id);
    }
  }
  return out;
}
