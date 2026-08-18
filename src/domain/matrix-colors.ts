/**
 * Contextual colours on Mali Tablo rows, columns and cells.
 *
 * What is stored is a TOKEN, never a colour. `ui/theme.ts` owns what each
 * token looks like in light and dark, which is what keeps a marked cell
 * readable in both themes and lets the palette change without stranding a
 * stored hex value below its contrast floor. It is also why there is no colour
 * wheel: five semantic choices the theme has measured, rather than a picker
 * that can produce amber text on an amber cell.
 *
 * The token set reuses the app's existing financial vocabulary
 * (`success`/`warning`/`critical` already mean something here) and adds no
 * sixth meaning. `neutral` is a mark without a judgement — "look at this" —
 * and is the one a person reaches for most.
 */

import type { MonthKey } from "./dates";

export const MATRIX_COLOR_TOKENS = ["neutral", "info", "success", "warning", "critical"] as const;
export type MatrixColorToken = (typeof MATRIX_COLOR_TOKENS)[number];

export const MATRIX_COLOR_SCOPES = ["row", "column", "cell"] as const;
export type MatrixColorScope = (typeof MATRIX_COLOR_SCOPES)[number];

export function isMatrixColorToken(value: unknown): value is MatrixColorToken {
  return typeof value === "string" && (MATRIX_COLOR_TOKENS as readonly string[]).includes(value);
}

/** One stored mark. Coordinates are exactly those its scope needs. */
export interface MatrixColorLike {
  id: string;
  scope: MatrixColorScope;
  itemKey: string | null;
  month: string | null;
  token: MatrixColorToken;
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
    if (!isMatrixColorToken(entry.token)) continue;
    if (entry.scope === "row" && entry.itemKey) row.set(entry.itemKey, entry.token);
    else if (entry.scope === "column" && entry.month) column.set(entry.month, entry.token);
    else if (entry.scope === "cell" && entry.itemKey && entry.month) {
      cell.set(`${entry.itemKey}\u0000${entry.month}`, entry.token);
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
