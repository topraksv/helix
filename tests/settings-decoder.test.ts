import { describe, expect, it } from "vitest";
import { decodeSettingValue, type SettingKey } from "../src/domain/settings";

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
    // A newer build can sync a key this one has never declared. The cast is
    // the subject of the test, not a convenience: it proves the runtime still
    // falls back where the compiler would otherwise have stopped us.
    expect(decodeSettingValue("unknown" as SettingKey, "true", "safe")).toBe("safe");
  });

  /**
   * Every key the app itself writes must be readable again.
   *
   * `balance_declared` was written by `setBalanceDeclaration` and read at three
   * screens, but it was never added to this decoder — so it fell through to the
   * unknown-key branch and every read returned the caller's fallback. The
   * declared balance was stored and then permanently invisible, which silently
   * disabled the drift warning that is its only purpose.
   */
  it("reads back every key the app writes", () => {
    expect(decodeSettingValue("balance_declared", JSON.stringify({ minor: 1_000_00, at: "2026-07-21" }), null))
      .toEqual({ minor: 1_000_00, at: "2026-07-21" });
  });

  it("still refuses a malformed declared balance", () => {
    expect(decodeSettingValue("balance_declared", '{"minor":"x","at":"2026-07-21"}', null)).toBeNull();
    expect(decodeSettingValue("balance_declared", '{"minor":100}', null)).toBeNull();
    expect(decodeSettingValue("balance_declared", "null", null)).toBeNull();
  });
});
