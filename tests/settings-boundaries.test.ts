import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  newId: vi.fn(() => "record-id"),
  pendingOutboxCount: vi.fn(async () => 7),
  requeueSyncDeadLetter: vi.fn(async () => "requeued" as const),
  writeSetting: vi.fn(async () => {}),
  deterministicId: vi.fn(async (key: string) => `color:${key}`),
  nowIso: vi.fn(() => "2026-08-20T00:00:00.000Z"),
  writeRows: vi.fn(),
  assertLiveRow: vi.fn(async (_db: unknown, table: string, _user: string, id: string) => {
    if (id !== "category-1") throw new Error(`Cannot edit missing ${table} row`);
  }),
  scheduleSync: vi.fn(),
}));

vi.mock("../src/db/ids", () => ({
  newId: dependencies.newId,
  deterministicId: dependencies.deterministicId,
  naturalKeys: { matrixColor: (...parts: string[]) => parts.join("|") },
}));
vi.mock("../src/db/mutations", () => ({
  pendingOutboxCount: dependencies.pendingOutboxCount,
  requeueSyncDeadLetter: dependencies.requeueSyncDeadLetter,
  writeSetting: dependencies.writeSetting,
  assertLiveRow: dependencies.assertLiveRow,
  nowIso: dependencies.nowIso,
  writeRowsValidated: vi.fn(async (user: string, writes: unknown[], validate: (db: unknown) => Promise<void>) => {
    await validate({});
    dependencies.writeRows(user, writes);
  }),
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: dependencies.scheduleSync }));

import {
  createRecordId,
  pendingSyncChangeCount,
  retrySyncDeadLetter,
  setAccountFrozen,
  setAttentionState,
  setBalanceDeclaration,
  setMatrixColorLabels,
  setPendingTableVisibility,
  setReminderDays,
} from "../src/data/repo/settings";
import { decodeSettingValue, type SettingKey } from "../src/domain/settings";
import { setMatrixColor } from "../src/data/repo/matrix-colors";

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
    await setMatrixColorLabels("user-1", { red: "Bankaya sorulacak" });

    expect(dependencies.writeSetting.mock.calls).toEqual([
      ["user-1", "account_frozen", true],
      ["user-1", "reminder_days", 30],
      ["user-1", "reminder_days", 0],
      ["user-1", "show_pending_in_table", false],
      ["user-1", "balance_declared", { minor: 123_45, at: "2026-07-21" }],
      ["user-1", "matrix_color_labels", { red: "Bankaya sorulacak" }],
    ]);
  });

  /**
   * The colour names are one account-wide synced value, so this writer is the
   * boundary that keeps a shape the decoder would later refuse out of storage —
   * a map written and then permanently unreadable is a rename that silently
   * did nothing.
   */
  it("refuses a colour-label map the decoder could not read back", () => {
    for (const invalid of [null, "red", 7, ["red"]]) {
      expect(() => setMatrixColorLabels("user-1", invalid as never), String(invalid))
        .toThrow("Invalid matrix colour labels");
    }
    expect(dependencies.writeSetting).not.toHaveBeenCalled();
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

/**
 * The other half of the Mali Tablo colour surface. `setMatrixColorLabels`
 * above was covered; the write that actually marks a cell was not — measured
 * at 0% lines with all 32 of its mutants uncovered, while
 * `cash-flow/index.tsx` has been calling it in production.
 */
describe("matrix colour writes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes a mark addressed by all four coordinates, substituting the absent one", async () => {
    await setMatrixColor("user-1", { scope: "cell", itemKey: "category-1", month: "2026-08" }, "green");
    expect(dependencies.writeRows).toHaveBeenCalledWith("user-1", [{
      table: "matrix_colors",
      row: {
        id: "color:user-1|cell|category-1|2026-08",
        scope: "cell",
        itemKey: "category-1",
        month: "2026-08",
        token: "green",
        deletedAt: null,
      },
    }]);
    expect(dependencies.scheduleSync).toHaveBeenCalledWith("user-1");

    // A row mark has no month; the key must still have four parts or a row
    // mark and a column mark could collide.
    await setMatrixColor("user-1", { scope: "row", itemKey: "category-1", month: null }, "red");
    expect(dependencies.deterministicId).toHaveBeenLastCalledWith("user-1|row|category-1|");
  });

  it("tombstones a cleared mark and keeps its last token", async () => {
    // The column is NOT NULL; the tombstone is what makes it cleared.
    await setMatrixColor("user-1", { scope: "cell", itemKey: "category-1", month: "2026-08" }, null);
    expect(dependencies.writeRows).toHaveBeenCalledWith("user-1", [expect.objectContaining({
      row: expect.objectContaining({ token: "yellow", deletedAt: "2026-08-20T00:00:00.000Z" }),
    })]);
  });

  it("refuses a target whose coordinates do not match its scope, and a retired token", async () => {
    for (const target of [
      { scope: "row", itemKey: "category-1", month: "2026-08" },
      { scope: "cell", itemKey: "category-1", month: null },
      { scope: "column", itemKey: "category-1", month: "2026-08" },
    ]) {
      await expect(setMatrixColor("user-1", target as never, "red"), JSON.stringify(target))
        .rejects.toThrow("Invalid matrix colour target");
    }
    // `critical` still displays, by design; it must never be written again.
    await expect(setMatrixColor("user-1", { scope: "row", itemKey: "category-1", month: null }, "critical" as never))
      .rejects.toThrow("Invalid matrix colour token");
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("checks the named category only when asked", async () => {
    await expect(setMatrixColor("user-1", { scope: "row", itemKey: "gone", month: null }, "red", { validateCategory: true }))
      .rejects.toThrow("Cannot edit missing categories row");

    // Mali Tablo passes no options, so the DEFAULT path is unvalidated: the
    // same dead category still writes. Making the check unconditional would
    // change what production does.
    await setMatrixColor("user-1", { scope: "row", itemKey: "gone", month: null }, "red");
    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
  });
});
