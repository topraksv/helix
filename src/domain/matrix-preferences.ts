export type MatrixMode = "cards" | "rows" | "columns";

export function resolveMatrixMode(value: string | null): MatrixMode {
  return value === "cards" || value === "columns" ? value : "rows";
}

/**
 * The two balance columns are the owner's to name, like every other Mali Tablo
 * column. Stored as ONE value, not three keys: the labels and the visibility
 * are one decision, and splitting them would let a device sync half of it.
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

/** The heading to draw: a stored name of only spaces is not a name and falls back. */
export function balanceColumnLabel(stored: string | null | undefined, fallback: string): string {
  return stored?.trim() || fallback;
}
