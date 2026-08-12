import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  writes: [] as unknown[],
  deterministicId: vi.fn(async () => "canonical-note"),
  nowIso: vi.fn(() => "2026-08-02T00:00:00.000Z"),
  writeRowsValidated: vi.fn(async (
    _userId: string,
    writes: unknown[],
    validate: (sqlite: unknown) => Promise<void>,
  ) => {
    await validate({});
    dependencies.writes = writes;
  }),
  assertLiveRow: vi.fn(async () => {}),
  scheduleSync: vi.fn(),
}));

vi.mock("../src/db/ids", () => ({
  deterministicId: dependencies.deterministicId,
  naturalKeys: { cellNote: (...parts: string[]) => parts.join("|") },
}));
vi.mock("../src/db/mutations", () => ({
  assertLiveRow: dependencies.assertLiveRow,
  nowIso: dependencies.nowIso,
  writeRowsValidated: dependencies.writeRowsValidated,
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: dependencies.scheduleSync }));

import { saveCellNote } from "../src/data/repo/cell-notes";

describe("cell-note canonical identity boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.writes = [];
  });

  it("tombstones a legacy random-id row before writing its canonical replacement", async () => {
    await saveCellNote("user-1", "2026-08", "category-1", " yeni ", {
      id: "legacy-note",
      body: "eski",
    });

    expect(dependencies.writes).toEqual([
      {
        table: "cell_notes",
        row: {
          id: "legacy-note",
          month: "2026-08",
          categoryId: "category-1",
          body: "eski",
          deletedAt: "2026-08-02T00:00:00.000Z",
        },
      },
      {
        table: "cell_notes",
        row: {
          id: "canonical-note",
          month: "2026-08",
          categoryId: "category-1",
          body: "yeni",
          deletedAt: null,
        },
      },
    ]);
  });

  it("uses a tombstone for an empty canonical note without duplicating its id", async () => {
    await saveCellNote("user-1", "2026-08", "category-1", "   ", {
      id: "canonical-note",
      body: "eski",
    });

    expect(dependencies.writes).toEqual([{
      table: "cell_notes",
      row: {
        id: "canonical-note",
        month: "2026-08",
        categoryId: "category-1",
        body: "",
        deletedAt: "2026-08-02T00:00:00.000Z",
      },
    }]);
  });
});
