export type MatrixMode = "cards" | "rows" | "columns";

export function resolveMatrixMode(value: string | null): MatrixMode {
  return value === "cards" || value === "rows" || value === "columns" ? value : "rows";
}

/**
 * The two balance columns are the owner's, not the app's.
 *
 * Every other column in the Mali Tablo is something the owner named. These two
 * were not: "Ay Başı" and "Güncel Bakiye" were fixed, and a workbook that
 * called them "Ay Sonu" and "Toplam" — or did not carry a month-opening figure
 * at all — had no way to say so. A reset cannot remove them either, because
 * they are structure rather than entries, which is what made a cleared
 * workspace still look as though it were holding something.
 *
 * Stored as ONE value rather than three keys: the labels and the visibility
 * are one decision, made on one card, and splitting them would let a device
 * sync half of it.
 */
export interface StoredBalanceColumns {
  /** null means "use the app's own name". */
  openingLabel: string | null;
  closingLabel: string | null;
  /** The closing column is never hidden: it is the balance the ledger is for. */
  showOpening: boolean;
}

/** Longest a column name may be. A heading, not a sentence. */
export const MAX_BALANCE_COLUMN_LABEL = 40;

/** A stored preference, or null when the value is not one. */
export function parseBalanceColumns(value: unknown): StoredBalanceColumns | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = (raw: unknown): string | null | undefined => {
    if (raw == null) return null;
    if (typeof raw !== "string" || raw.length > MAX_BALANCE_COLUMN_LABEL) return undefined;
    return raw;
  };
  const openingLabel = label(record.openingLabel);
  const closingLabel = label(record.closingLabel);
  if (openingLabel === undefined || closingLabel === undefined) return null;
  if (typeof record.showOpening !== "boolean") return null;
  return { openingLabel, closingLabel, showOpening: record.showOpening };
}

/**
 * The heading to draw, given what was stored and what the app calls it.
 *
 * A stored name of only spaces is not a name; it falls back rather than
 * printing a blank column header nobody can identify.
 */
export function balanceColumnLabel(stored: string | null | undefined, fallback: string): string {
  const trimmed = stored?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}
