/**
 * Contextual colours on Mali Tablo rows, columns and cells.
 *
 * ## Four slots, and why they are named after their hue
 *
 * What is stored is a SLOT, never a colour value. `ui/theme.ts` owns what each
 * slot looks like in light and dark, which is what keeps a marked cell readable
 * in both themes and lets the palette change without stranding a stored hex
 * below its contrast floor. It is also why there is no colour wheel.
 *
 * The slots used to be named for meanings the app chose (`success`,
 * `critical`, …). They are named for their hue now because the MEANING is the
 * owner's: the four labels are editable and stored once for the whole account,
 * so a slot called `success` that a person has renamed "Ödenmedi" would be a
 * lie in the database. The hue is the only thing this module can promise, so it
 * is the only thing the identifier claims.
 *
 * Four rather than five: at five the fills were 2.7 ΔE apart on the shipped
 * palettes, which is not a difference anyone can act on across a table of
 * numbers. See `matrixColorStyle` for the measurement.
 */

import type { MonthKey } from "./dates";

export const MATRIX_COLOR_TOKENS = ["red", "orange", "yellow", "green"] as const;
export type MatrixColorToken = (typeof MATRIX_COLOR_TOKENS)[number];

export type MatrixColorScope = "row" | "column" | "cell";

/**
 * What the five meaning-named slots become.
 *
 * A stored mark outlives the vocabulary it was written in: rows already in the
 * ledger, rows arriving from a device that has not updated, and rows inside a
 * backup taken before the change. Dropping them would silently unmark cells the
 * owner marked, which is invisible — the mark is simply gone.
 *
 * `neutral` and `info` both land on yellow: both meant "look at this", which is
 * what yellow says, and the fifth hue is the one that was removed.
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

/**
 * A slot this build can DISPLAY, which is a wider set than the one it writes.
 *
 * Reading accepts the retired names so no existing mark disappears; writing
 * goes through `isMatrixColorToken` so nothing new is stored in the old
 * vocabulary and the two never mix in fresh data.
 */
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
 * The coordinates a scope requires, checked as one rule.
 *
 * A "row" mark carrying a month is not a row mark with extra information — it
 * is a row that another client version would read as a cell. Refusing the
 * shape here is what stops two devices disagreeing about what is coloured.
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

/**
 * The identity of a mark, so re-colouring replaces rather than stacks.
 *
 * NUL-separated because both halves are user-reachable keys: a category named
 * with the separator would otherwise let one target collide with another.
 */
export function colorTargetKey(target: {
  scope: MatrixColorScope;
  itemKey: string | null;
  month: string | null;
}): string {
  return [target.scope, target.itemKey ?? "", target.month ?? ""].join("\u0000");
}

export interface MatrixColorIndex {
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
 * The token that applies to one cell, given every stored mark.
 *
 * Specificity, not recency: a cell's own mark beats the column it sits in,
 * which beats the row it sits on. Anything else makes colouring a whole month
 * silently erase the one cell someone had already singled out — and there is
 * no way to see that happen, because the mark is still stored, it just stops
 * showing.
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

/**
 * How long a slot's name may be.
 *
 * It is drawn beside a swatch in the sheet and spoken in every marked cell's
 * accessibility label, so it is a name and not a sentence. Long enough for
 * "Kontrol edilmeli" (16) with room to spare.
 */
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

/**
 * A slot's name: the owner's, or the shipped default.
 *
 * Defaults are Turkish copy and live in `i18n`, so they are passed in rather
 * than imported — this module stays free of presentation strings, and the
 * resolution rule stays testable without one.
 */
export function matrixColorLabel(
  token: MatrixColorToken,
  labels: MatrixColorLabels | null,
  defaults: Readonly<Record<MatrixColorToken, string>>,
): string {
  const own = labels?.[token]?.trim();
  return own && own.length > 0 ? own : defaults[token];
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
