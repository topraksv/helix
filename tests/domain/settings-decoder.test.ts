import { describe, expect, it } from "vitest";
import { decodeSettingValue, type SettingKey } from "../../src/domain/settings";
import { parseMatrixColorLabels } from "../../src/domain/matrix-colors";

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

  /** Every key the app writes must decode: an undeclared key falls through to the caller's fallback and is silently unreadable. */
  it("reads back every key the app writes", () => {
    expect(decodeSettingValue("balance_declared", JSON.stringify({ minor: 1_000_00, at: "2026-07-21" }), null))
      .toEqual({ minor: 1_000_00, at: "2026-07-21" });
    // The owner's names for the Mali Tablo mark colours: one account-wide map,
    // so a slot renamed on the phone is renamed on the desktop too.
    expect(decodeSettingValue("matrix_color_labels", '{"red":"Bankaya sorulacak"}', null))
      .toEqual({ red: "Bankaya sorulacak" });
    // The decoder validates, it does not sanitize: a slot this build does not know is returned, so the reader runs `parseMatrixColorLabels`.
    expect(decodeSettingValue("matrix_color_labels", '{"purple":"Nope"}', null)).toEqual({ purple: "Nope" });
    expect(parseMatrixColorLabels(decodeSettingValue("matrix_color_labels", '{"purple":"Nope"}', null))).toEqual({});
    expect(decodeSettingValue("matrix_color_labels", '"red"', null)).toBeNull();
    // What the owner calls the two balance columns, and whether both are drawn.
    expect(decodeSettingValue("balance_columns", '{"openingLabel":"Ay Sonu","closingLabel":null,"showOpening":false}', null))
      .toEqual({ openingLabel: "Ay Sonu", closingLabel: null, showOpening: false });
    expect(decodeSettingValue("balance_columns", '{"openingLabel":"Ay Sonu"}', null)).toBeNull();
    expect(decodeSettingValue("balance_columns", '"Ay Sonu"', null)).toBeNull();
  });

  it("still refuses a malformed declared balance", () => {
    expect(decodeSettingValue("balance_declared", '{"minor":"x","at":"2026-07-21"}', null)).toBeNull();
    expect(decodeSettingValue("balance_declared", '{"minor":100}', null)).toBeNull();
    expect(decodeSettingValue("balance_declared", "null", null)).toBeNull();
  });

  it("accepts collection maxima and rejects near-miss setting keys", () => {
    expect(decodeSettingValue("computed_columns_hidden", JSON.stringify(Array(10_000).fill("x")), [])).toHaveLength(10_000);
    const years = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [String(1500 + index), []]));
    expect(Object.keys(decodeSettingValue("column_years", JSON.stringify(years), {}))).toHaveLength(500);
    expect(decodeSettingValue("column_years", '{"x2026":[]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"2026x":[]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"2026":[],"bad":[1]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("opening_balance_minor", "0", -1)).toBe(0);
    expect(decodeSettingValue("reminder_days", "-1", 3)).toBe(3);
    expect(decodeSettingValue("last_entry_at", "123", null)).toBeNull();
    expect(decodeSettingValue("last_entry_at", '"2026-02-30T10:00:00.000Z"', null)).toBeNull();
    expect(decodeSettingValue("column_years", "123", { safe: [] })).toEqual({ safe: [] });
  });
});

describe("synced setting decoder boundaries", () => {
  it("returns the fallback when storage is absent or is not JSON", () => {
    expect(decodeSettingValue("start_month", undefined, "2026-01")).toBe("2026-01");
    expect(decodeSettingValue("start_month", "{", "2026-01")).toBe("2026-01");
  });

  it("accepts every boolean flag declared by the setting contract", () => {
    for (const key of ["account_frozen", "onboarded", "cc_column_removed"] as const) {
      expect(decodeSettingValue(key, "true", false), key).toBe(true);
      expect(decodeSettingValue(key, '"true"', false), key).toBe(false);
    }
  });

  /**
   * The attention state is one synced value, so the decoder is the boundary
   * that stops a newer build's shape (or a tampered row) becoming the inbox's
   * idea of what the owner dismissed.
   */
  it("accepts a well-formed attention state and refuses every other shape", () => {
    const valid = JSON.stringify({ read: ["a"], dismissed: [], snoozedUntil: { a: "2026-09-01" } });
    expect(decodeSettingValue("attention_state", valid, null)).toEqual({
      read: ["a"],
      dismissed: [],
      snoozedUntil: { a: "2026-09-01" },
    });
    for (const raw of ['null', '3', '"x"', '{}', '{"read":[1],"dismissed":[],"snoozedUntil":{}}', '{"read":[],"dismissed":[],"snoozedUntil":5}']) {
      expect(decodeSettingValue("attention_state", raw, null), raw).toBeNull();
    }
  });

  it("bounds reminder days and validates timestamp semantics", () => {
    expect(decodeSettingValue("reminder_days", "0", -1)).toBe(0);
    expect(decodeSettingValue("reminder_days", "30", -1)).toBe(30);
    expect(decodeSettingValue("reminder_days", "31", -1)).toBe(-1);
    expect(decodeSettingValue("reminder_days", "1.5", -1)).toBe(-1);
    expect(decodeSettingValue("last_entry_at", '"2026-07-21T99:00:00.000Z"', null)).toBeNull();
  });

  it("rejects oversized or malformed collections before they reach consumers", () => {
    expect(decodeSettingValue("computed_columns_hidden", JSON.stringify(["a", 1]), ["safe"])).toEqual(["safe"]);
    expect(decodeSettingValue("computed_columns_hidden", JSON.stringify(Array(10_001).fill("a")), ["safe"])).toEqual(["safe"]);
    expect(decodeSettingValue("column_years", "[]", { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"year":["a"]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"2026":[1]}', { safe: [] })).toEqual({ safe: [] });
    const tooManyYears = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [String(1500 + index), []]));
    expect(decodeSettingValue("column_years", JSON.stringify(tooManyYears), { safe: [] })).toEqual({ safe: [] });
  });
});
