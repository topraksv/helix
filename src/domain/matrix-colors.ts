/**
 * Contextual colours on Mali Tablo rows, columns and cells (spec §1.3).
 *
 * What is stored is a SLOT, never a colour value: `ui/theme.ts` owns what each
 * looks like in light and dark, so the palette can change without stranding a
 * stored hex below its contrast floor. Slots are named for their hue because
 * the MEANING is the owner's (labels are editable account-wide); a slot called
 * `success` renamed "Ödenmedi" would lie in the database. Four, not five: five
 * fills were too close to tell apart across a table of numbers.
 */

import type { MonthKey } from "./dates";

export const MATRIX_COLOR_TOKENS = ["red", "orange", "yellow", "green"] as const;
export type MatrixColorToken = (typeof MATRIX_COLOR_TOKENS)[number];

export type MatrixColorScope = "row" | "column" | "cell";

/**
 * What the retired meaning-named slots become. A stored mark outlives its
 * vocabulary (old rows, un-updated devices, older backups), and dropping one
 * would silently unmark a cell. `neutral` and `info` both meant "look at this",
 * which is what yellow says.
 */
const LEGACY_MATRIX_COLOR_TOKENS: Readonly<Record<string, MatrixColorToken>> = {
  critical: "red",
  warning: "orange",
  neutral: "yellow",
  info: "yellow",
  success: "green",
};

/** A slot this build writes. Strict: only the current vocabulary may be stored. */
export function isMatrixColorToken(value: unknown): value is MatrixColorToken {
  return typeof value === "string" && (MATRIX_COLOR_TOKENS as readonly string[]).includes(value);
}

/** A slot this build can DISPLAY: reading accepts the retired names, writing goes through `isMatrixColorToken`. */
export function normalizeMatrixColorToken(value: unknown): MatrixColorToken | null {
  if (isMatrixColorToken(value)) return value;
  return typeof value === "string" ? LEGACY_MATRIX_COLOR_TOKENS[value] ?? null : null;
}

/** One stored mark. Coordinates are exactly those its scope needs. */
export interface MatrixColorLike {
  id: string;
  scope: MatrixColorScope;
  itemKey: string | null;
  month: string | null;
  token: string;
}

/**
 * The coordinates a scope requires, as one rule: a "row" mark carrying a month
 * would be read as a cell by another client version, so two devices would
 * disagree about what is coloured.
 */
export function isValidColorTarget(target: {
  scope: unknown;
  itemKey: unknown;
  month: unknown;
}): target is { scope: MatrixColorScope; itemKey: string | null; month: MonthKey | null } {
  const hasItem = typeof target.itemKey === "string" && target.itemKey !== "" && target.itemKey.length <= 120;
  const hasMonth = typeof target.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(target.month);
  if (target.scope === "row") return hasItem && target.month == null;
  if (target.scope === "column") return hasMonth && target.itemKey == null;
  if (target.scope === "cell") return hasItem && hasMonth;
  return false;
}

interface MatrixColorIndex {
  row: ReadonlyMap<string, MatrixColorToken>;
  column: ReadonlyMap<string, MatrixColorToken>;
  cell: ReadonlyMap<string, MatrixColorToken>;
}

/** Build the lookup once per data change, not once per cell. */
export function buildColorIndex(rows: readonly MatrixColorLike[]): MatrixColorIndex {
  const row = new Map<string, MatrixColorToken>();
  const column = new Map<string, MatrixColorToken>();
  const cell = new Map<string, MatrixColorToken>();
  for (const entry of rows) {
    const token = normalizeMatrixColorToken(entry.token);
    if (!token) continue;
    if (entry.scope === "row" && entry.itemKey) row.set(entry.itemKey, token);
    else if (entry.scope === "column" && entry.month) column.set(entry.month, token);
    else if (entry.scope === "cell" && entry.itemKey && entry.month) {
      cell.set(`${entry.itemKey}\u0000${entry.month}`, token);
    }
  }
  return { row, column, cell };
}

/**
 * The token that applies to one cell: specificity, not recency. A cell's own
 * mark beats its column, which beats its row; otherwise colouring a month would
 * silently hide a cell already singled out.
 */
export function resolveCellToken(
  index: MatrixColorIndex,
  itemKey: string,
  month: string,
): MatrixColorToken | null {
  return index.cell.get(`${itemKey}\u0000${month}`)
    ?? index.column.get(month)
    ?? index.row.get(itemKey)
    ?? null;
}

// ---------------------------------------------------------------------------
// What the owner calls each slot
// ---------------------------------------------------------------------------

/** How long a slot's name may be: it is drawn beside a swatch and spoken in every marked cell's label, so a name, not a sentence. */
export const MATRIX_COLOR_LABEL_MAX = 24;

/** The names the owner has chosen. An absent slot keeps its shipped default. */
export type MatrixColorLabels = Partial<Record<MatrixColorToken, string>>;

/**
 * Read a stored label map, keeping only what is usable.
 *
 * Account-wide and synced, so it arrives from other devices and from backups:
 * an unknown slot, a non-string, or an over-long name is dropped rather than
 * rejecting the whole map, because losing one renamed slot is recoverable and
 * losing all four is not.
 */
export function parseMatrixColorLabels(value: unknown): MatrixColorLabels | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const labels: MatrixColorLabels = {};
  for (const [token, label] of Object.entries(value as Record<string, unknown>)) {
    if (!isMatrixColorToken(token)) continue;
    if (typeof label !== "string") continue;
    const trimmed = label.trim();
    if (trimmed === "" || trimmed.length > MATRIX_COLOR_LABEL_MAX) continue;
    labels[token] = trimmed;
  }
  return labels;
}

/** A slot's name: the owner's, or the shipped default, passed in so this module holds no presentation strings. */
export function matrixColorLabel(
  token: MatrixColorToken,
  labels: MatrixColorLabels | null,
  defaults: Readonly<Record<MatrixColorToken, string>>,
): string {
  return labels?.[token]?.trim() || defaults[token];
}

/**
 * Apply one rename, or clear it back to the default.
 *
 * Returns the whole map because that is what is stored: one setting, written
 * as a unit, so two devices renaming two different slots converge on the
 * later write rather than on a half-merged object.
 */
export function withMatrixColorLabel(
  labels: MatrixColorLabels | null,
  token: MatrixColorToken,
  label: string,
): MatrixColorLabels {
  const next: MatrixColorLabels = { ...(labels ?? {}) };
  const trimmed = label.trim();
  if (trimmed === "") delete next[token];
  else next[token] = trimmed.slice(0, MATRIX_COLOR_LABEL_MAX);
  return next;
}
