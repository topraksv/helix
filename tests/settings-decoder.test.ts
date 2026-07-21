import { describe, expect, it } from "vitest";
import { decodeSettingValue } from "../src/domain/settings";

describe("synced settings runtime decoding", () => {
  it("accepts the supported shape for each consumed key", () => {
    expect(decodeSettingValue("start_month", '"2026-07"', null)).toBe("2026-07");
    expect(decodeSettingValue("opening_balance_minor", "12345", 0)).toBe(12345);
    expect(decodeSettingValue("show_pending_in_table", "false", true)).toBe(false);
    expect(decodeSettingValue("reminder_days", "7", 3)).toBe(7);
    expect(decodeSettingValue("computed_columns_hidden", '["a"]', [])).toEqual(["a"]);
    expect(decodeSettingValue("column_years", '{"2026":["a"]}', {})).toEqual({ "2026": ["a"] });
    expect(decodeSettingValue("last_entry_at", '"2026-07-21T10:00:00.000Z"', null)).toBe("2026-07-21T10:00:00.000Z");
  });

  it("falls back for malformed or wrong-shaped synced values", () => {
    expect(decodeSettingValue("start_month", "123", "2026-01")).toBe("2026-01");
    expect(decodeSettingValue("start_month", '"2026-13"', "2026-01")).toBe("2026-01");
    expect(decodeSettingValue("opening_balance_minor", "1e20", 0)).toBe(0);
    expect(decodeSettingValue("show_pending_in_table", '"true"', false)).toBe(false);
    expect(decodeSettingValue("computed_columns_hidden", "{}", [])).toEqual([]);
    expect(decodeSettingValue("column_years", "null", {})).toEqual({});
    expect(decodeSettingValue("last_entry_at", '"not-a-date"', null)).toBeNull();
    expect(decodeSettingValue("unknown", "true", "safe")).toBe("safe");
  });
});
