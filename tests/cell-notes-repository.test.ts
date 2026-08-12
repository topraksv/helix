import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  const liveCategoryIds = new Set(["category-1"]);
  return {
    liveCategoryIds,
    writeRows: vi.fn(),
    writeRowsValidated: vi.fn(async (
      userId: string,
      writes: unknown[],
      validate: (sqlite: unknown) => Promise<void>,
    ) => {
      await validate({});
      dependencies.writeRows(userId, writes);
    }),
    assertLiveRow: vi.fn(async (_sqlite: unknown, table: string, _userId: string, id: string) => {
      if (!dependencies.liveCategoryIds.has(id)) throw new Error(`Cannot edit missing ${table} row`);
    }),
    deterministicId: vi.fn(async () => "note-1"),
    nowIso: vi.fn(() => "2026-08-02T00:00:00.000Z"),
    scheduleSync: vi.fn(),
  };
});

vi.mock("../src/db/ids", () => ({
  deterministicId: dependencies.deterministicId,
  naturalKeys: { cellNote: (...parts: string[]) => parts.join("|") },
}));
vi.mock("../src/db/mutations", () => ({
  assertLiveRow: dependencies.assertLiveRow,
  nowIso: dependencies.nowIso,
  writeRows: dependencies.writeRows,
  writeRowsValidated: dependencies.writeRowsValidated,
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: dependencies.scheduleSync }));

import { saveCellNote } from "../src/data/repo/cell-notes";

describe("cell-note repository boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.liveCategoryIds.clear();
    dependencies.liveCategoryIds.add("category-1");
  });

  it("persists a normalized note only for a live category", async () => {
    await saveCellNote("user-1", "2026-08", "category-1", "  Ağustos notu  ");

    expect(dependencies.writeRows).toHaveBeenCalledWith("user-1", [{
      table: "cell_notes",
      row: {
        id: "note-1",
        month: "2026-08",
        categoryId: "category-1",
        body: "Ağustos notu",
        deletedAt: null,
      },
    }]);
    expect(dependencies.scheduleSync).toHaveBeenCalledWith("user-1");
  });

  it("rejects a stale category before local persistence", async () => {
    await expect(saveCellNote("user-1", "2026-08", "missing", "not")).rejects.toThrow(
      "Cannot edit missing categories row",
    );

    expect(dependencies.writeRows).not.toHaveBeenCalled();
    expect(dependencies.scheduleSync).not.toHaveBeenCalled();
  });

  it("rejects an invalid month before local persistence", async () => {
    await expect(saveCellNote("user-1", "2026-02-31", "category-1", "not")).rejects.toThrow(
      "Invalid cell note month",
    );

    expect(dependencies.writeRows).not.toHaveBeenCalled();
    expect(dependencies.scheduleSync).not.toHaveBeenCalled();
  });
});
