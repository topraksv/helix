/** Runtime decoders for synced/imported JSON settings. */

import { parseBalanceDeclaration } from "./balance-declaration";
import { isISODate, isMonthKey } from "./dates";
import { isSupportedMinorAmount } from "./money";

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 10_000 && value.every((item) => typeof item === "string");
}

function columnYears(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 500 && entries.every(([year, ids]) => /^\d{4}$/.test(year) && stringArray(ids));
}

/**
 * Every settings key this app writes, beside the shape it may hold.
 *
 * One object rather than a `switch` plus the same key spelled as a bare string
 * in each screen that reads it. `balance_declared` is why: it was written by
 * `setBalanceDeclaration` and read at three surfaces, but never added to the
 * decoder — so it fell to the unknown-key branch, every read returned the
 * caller's fallback, and the declared balance was stored and then permanently
 * invisible. That silently disabled the drift warning it exists for.
 *
 * Deriving `SettingKey` from these entries turns the same omission into a
 * compile error: a key with no validator is not a key you can read or write.
 */
const SETTING_VALIDATORS = {
  start_month: (value: unknown) => isMonthKey(value),
  opening_balance_minor: (value: unknown) => typeof value === "number" && isSupportedMinorAmount(value, true),
  show_pending_in_table: (value: unknown) => typeof value === "boolean",
  reminder_days: (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 30,
  computed_columns_hidden: stringArray,
  column_years: columnYears,
  last_entry_at: (value: unknown) =>
    typeof value === "string" && isISODate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)),
  balance_declared: (value: unknown) => parseBalanceDeclaration(value) !== null,
  // Read through their own live queries rather than this decoder. Listed
  // anyway so that "which settings does Helix have" has exactly one answer.
  account_frozen: (value: unknown) => typeof value === "boolean",
  onboarded: (value: unknown) => typeof value === "boolean",
  cc_column_removed: (value: unknown) => typeof value === "boolean",
} satisfies Record<string, (value: unknown) => boolean>;

/** A settings key with a declared shape. */
export type SettingKey = keyof typeof SETTING_VALIDATORS;

/** One import record per spreadsheet year — a family, not a fixed name. */
export type ImportBatchKey = `import_batch:${number}`;

export type AnySettingKey = SettingKey | ImportBatchKey;

export function decodeSettingValue<T>(key: SettingKey, raw: string | undefined, fallback: T): T {
  if (raw == null) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  // A newer build can sync a key this one has never heard of. Falling back
  // keeps an unknown shape out of the product instead of trusting it.
  const validate = SETTING_VALIDATORS[key] as ((value: unknown) => boolean) | undefined;
  return validate?.(value) === true ? value as T : fallback;
}
