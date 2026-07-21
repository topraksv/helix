/** Runtime decoders for synced/imported JSON settings. */

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

export function decodeSettingValue<T>(key: string, raw: string | undefined, fallback: T): T {
  if (raw == null) return fallback;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }

  const valid = (() => {
    switch (key) {
      case "start_month": return isMonthKey(value);
      case "opening_balance_minor": return typeof value === "number" && isSupportedMinorAmount(value, true);
      case "show_pending_in_table": return typeof value === "boolean";
      case "reminder_days": return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 30;
      case "computed_columns_hidden": return stringArray(value);
      case "column_years": return columnYears(value);
      case "last_entry_at":
        return typeof value === "string" && isISODate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
      default:
        return false;
    }
  })();
  return valid ? value as T : fallback;
}
