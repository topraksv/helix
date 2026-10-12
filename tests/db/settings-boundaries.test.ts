import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  newId: vi.fn(() => "record-id"),
  pendingOutboxCount: vi.fn(async () => 7),
  requeueSyncDeadLetter: vi.fn(async () => "requeued" as const),
  discardSyncDeadLetter: vi.fn(async () => true),
  writeSetting: vi.fn(async () => {}),
  deterministicId: vi.fn(async (key: string) => `color:${key}`),
  nowIso: vi.fn(() => "2026-08-20T00:00:00.000Z"),
  writeRows: vi.fn(),
  assertLiveRow: vi.fn(async (_db: unknown, table: string, _user: string, id: string) => {
    if (id !== "category-1") throw new Error(`Cannot edit missing ${table} row`);
  }),
}));

vi.mock("../../src/db/ids", () => ({
  newId: dependencies.newId,
  deterministicId: dependencies.deterministicId,
  naturalKeys: { matrixColor: (...parts: string[]) => parts.join("|") },
}));
vi.mock("../../src/db/mutations", () => ({
  pendingOutboxCount: dependencies.pendingOutboxCount,
  requeueSyncDeadLetter: dependencies.requeueSyncDeadLetter,
  discardSyncDeadLetter: dependencies.discardSyncDeadLetter,
  writeSetting: dependencies.writeSetting,
  assertLiveRow: dependencies.assertLiveRow,
  nowIso: dependencies.nowIso,
  writeRowsValidated: vi.fn(async (user: string, writes: unknown[], validate: (db: unknown) => Promise<void>) => {
    await validate({});
    dependencies.writeRows(user, writes);
  }),
}));

import {
  createRecordId,
  dismissSyncDeadLetter,
  pendingSyncChangeCount,
  retrySyncDeadLetter,
  setAccountFrozen,
  setAttentionState,
  setBalanceDeclaration,
  setBalanceColumns,
  setMatrixColorLabels,
  setPendingTableVisibility,
  setReminderDays,
} from "../../src/data/repo/settings";
import { setMatrixColor } from "../../src/data/repo/matrix-colors";

describe("setting repository delegation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates identity and sync recovery to their authoritative stores", async () => {
    expect(createRecordId()).toBe("record-id");
    await expect(pendingSyncChangeCount()).resolves.toBe(7);
    await expect(retrySyncDeadLetter("user-1", 42)).resolves.toBe("requeued");
    expect(dependencies.requeueSyncDeadLetter).toHaveBeenCalledWith("user-1", 42);
  });

  it("passes a dismissal through, and passes back whether there was one", async () => {
    // The answer matters: a caller that reported success for a no-op would
    // tell someone a row had been cleared when nothing was.
    await expect(dismissSyncDeadLetter(42)).resolves.toBe(true);
    expect(dependencies.discardSyncDeadLetter).toHaveBeenCalledWith(42);

    dependencies.discardSyncDeadLetter.mockResolvedValueOnce(false);
    await expect(dismissSyncDeadLetter(7)).resolves.toBe(false);
  });

  it("writes each supported setting under its stable sync key", async () => {
    await setAccountFrozen("user-1", true);
    await setReminderDays("user-1", 30);
    await setReminderDays("user-1", 0);
    await setPendingTableVisibility("user-1", false);
    await setBalanceDeclaration("user-1", 123_45, "2026-07-21");
    await setMatrixColorLabels("user-1", { red: "Bankaya sorulacak" });
    await setBalanceColumns("user-1", { openingLabel: "Ay Sonu", closingLabel: null, showOpening: false });

    expect(dependencies.writeSetting.mock.calls).toEqual([
      ["user-1", "account_frozen", true],
      ["user-1", "reminder_days", 30],
      ["user-1", "reminder_days", 0],
      ["user-1", "show_pending_in_table", false],
      ["user-1", "balance_declared", { minor: 123_45, at: "2026-07-21" }],
      ["user-1", "matrix_color_labels", { red: "Bankaya sorulacak" }],
      ["user-1", "balance_columns", { openingLabel: "Ay Sonu", closingLabel: null, showOpening: false }],
    ]);
  });

  /**
   * The same boundary as the colour labels, for the same reason: a preference
   * written in a shape the decoder would later refuse is a rename that
   * silently did nothing.
   */
  it("refuses a balance-column preference the decoder could not read back", () => {
    for (const invalid of [null, "Ay Sonu", 7, { openingLabel: "Ay Sonu" }]) {
      expect(() => setBalanceColumns("user-1", invalid as never), String(invalid))
        .toThrow("Invalid balance column preference");
    }
    expect(dependencies.writeSetting).not.toHaveBeenCalled();
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
