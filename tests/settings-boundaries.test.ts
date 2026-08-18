import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  newId: vi.fn(() => "record-id"),
  pendingOutboxCount: vi.fn(async () => 7),
  requeueSyncDeadLetter: vi.fn(async () => "requeued" as const),
  writeSetting: vi.fn(async () => {}),
}));

vi.mock("../src/db/ids", () => ({ newId: dependencies.newId }));
vi.mock("../src/db/mutations", () => ({
  pendingOutboxCount: dependencies.pendingOutboxCount,
  requeueSyncDeadLetter: dependencies.requeueSyncDeadLetter,
  writeSetting: dependencies.writeSetting,
}));

import {
  createRecordId,
  pendingSyncChangeCount,
  retrySyncDeadLetter,
  setAccountFrozen,
  setAttentionState,
  setBalanceDeclaration,
  setPendingTableVisibility,
  setReminderDays,
} from "../src/data/repo/settings";
import { decodeSettingValue, type SettingKey } from "../src/domain/settings";

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
    expect(decodeSettingValue("last_entry_at", '"2026-07-21T10:00:00.000Z"', null)).toBe("2026-07-21T10:00:00.000Z");
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
    expect(decodeSettingValue("future_key" as SettingKey, "true", "safe")).toBe("safe");
  });
});

describe("setting repository delegation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates identity and sync recovery to their authoritative stores", async () => {
    expect(createRecordId()).toBe("record-id");
    await expect(pendingSyncChangeCount()).resolves.toBe(7);
    await expect(retrySyncDeadLetter("user-1", 42)).resolves.toBe("requeued");
    expect(dependencies.requeueSyncDeadLetter).toHaveBeenCalledWith("user-1", 42);
  });

  it("writes each supported setting under its stable sync key", async () => {
    await setAccountFrozen("user-1", true);
    await setReminderDays("user-1", 30);
    await setReminderDays("user-1", 0);
    await setPendingTableVisibility("user-1", false);
    await setBalanceDeclaration("user-1", 123_45, "2026-07-21");

    expect(dependencies.writeSetting.mock.calls).toEqual([
      ["user-1", "account_frozen", true],
      ["user-1", "reminder_days", 30],
      ["user-1", "reminder_days", 0],
      ["user-1", "show_pending_in_table", false],
      ["user-1", "balance_declared", { minor: 123_45, at: "2026-07-21" }],
    ]);
  });

  it("rejects every invalid reminder boundary before persistence", () => {
    for (const days of [-1, 31, 1.5, Number.NaN]) {
      expect(() => setReminderDays("user-1", days), String(days)).toThrow("Invalid reminder days");
    }
    expect(dependencies.writeSetting).not.toHaveBeenCalled();
  });
});

/**
 * The stored attention value must not grow with the age of the account: a
 * decision about an item nothing derives any more is not a decision worth
 * keeping, and this is the only write path that can prune it.
 */
describe("attention state persistence", () => {
  beforeEach(() => {
    dependencies.writeSetting.mockClear();
  });

  it("prunes decisions about items that no longer exist, and marks the write as the owner's", async () => {
    await setAttentionState(
      "user-1",
      { read: ["live", "gone"], dismissed: ["gone"], snoozedUntil: { live: "2026-09-01", gone: "2026-09-01" } },
      new Set(["live"]),
    );
    expect(dependencies.writeSetting).toHaveBeenCalledWith(
      "user-1",
      "attention_state",
      { read: ["live"], dismissed: [], snoozedUntil: { live: "2026-09-01" } },
      true,
    );
  });

  it("writes an empty state rather than skipping the write when everything is gone", async () => {
    await setAttentionState("user-1", { read: ["gone"], dismissed: ["gone"], snoozedUntil: {} }, new Set());
    expect(dependencies.writeSetting).toHaveBeenCalledWith(
      "user-1",
      "attention_state",
      { read: [], dismissed: [], snoozedUntil: {} },
      true,
    );
  });
});
