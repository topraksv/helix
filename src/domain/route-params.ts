/**
 * Route-parameter validation.
 *
 * A dynamic segment or query string carries whatever the URL says: a bookmark,
 * a shared link, a stale notification deep link, or the Pages 404 shell
 * resolving a bare path. Expo Router also yields `string[]` when a query key
 * appears more than once. Screens must therefore validate before deriving a
 * query, a date range or an id lookup from a param.
 *
 * These predicates live in `domain/` — pure, no React, no I/O — so the whole
 * input space is unit-testable. The screens that consume them import from here
 * and refuse invalid input outright: substituting a plausible default would show
 * a DIFFERENT record's money, and binding a sentinel id would hide bad input
 * inside a well-formed query instead of rejecting it.
 */

import { isMonthKey } from "./dates";

/** A param that is genuinely a single string, not absent and not repeated. */
export function singleParam(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface CellParams {
  month: string;
  categoryId: string;
}

/** `/cell-editor?month=&categoryId=` — both required, month must be a real key. */
export function isValidCellParams(month: unknown, categoryId: unknown): CellParams | null {
  if (!isMonthKey(month)) return null;
  const id = singleParam(categoryId);
  return id ? { month, categoryId: id } : null;
}

/**
 * Calendar years the app can render. The ledger builds twelve month keys from
 * this number, and `makeMonthKey` pads to four digits, so anything outside a
 * plausible range produces keys no data can match.
 */
const MIN_YEAR = 1970;
const MAX_YEAR = 2999;

export const ITEM_KINDS = ["category", "computed", "uncategorized"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemParams {
  col: string;
  year: number;
  kind: ItemKind;
}

/**
 * `/cash-flow/item?col=&year=&kind=` — the year-breakdown screen.
 *
 * `Number(yearParam)` used to run unchecked. `NaN` flowed into
 * `makeMonthKey(NaN, n)`, which returns `"0NaN-01"` — a key that is not a month
 * but still a string, so twelve rows rendered against `"0NaN-01"…`, the header
 * read "NaN yıl toplamı", and every row linked to `/cash-flow/0NaN-01`. `kind`
 * was equally unchecked even though the screen branches on it.
 *
 * `label` is deliberately NOT part of this contract: it is a user-authored
 * category name that the pushing screen put in the URL, and the screen can read
 * it from live data instead of trusting the address bar.
 */
export function isValidItemParams(col: unknown, year: unknown, kind: unknown): ItemParams | null {
  const id = singleParam(col);
  if (!id) return null;
  const yearText = singleParam(year);
  if (yearText === null || !/^\d{4}$/.test(yearText)) return null;
  const parsed = Number(yearText);
  if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) return null;
  const kindText = singleParam(kind);
  if (kindText === null || !(ITEM_KINDS as readonly string[]).includes(kindText)) return null;
  return { col: id, year: parsed, kind: kindText as ItemKind };
}

/**
 * A record id carried by a modal route (`/transaction?id=`, `/installment-new`,
 * `/subscription-form`). Absent means "create new", which is valid; a present
 * but malformed value is not.
 *
 * Returns `"new"` for absent, the id for a usable one, and `null` for input
 * that can never identify a row — so the caller can tell "create" apart from
 * "this link is broken" instead of rendering an empty screen forever.
 */
export function classifyRecordId(id: unknown): { mode: "new" } | { mode: "edit"; id: string } | null {
  if (id === undefined || id === null || id === "") return { mode: "new" };
  const single = singleParam(id);
  return single ? { mode: "edit", id: single } : null;
}
