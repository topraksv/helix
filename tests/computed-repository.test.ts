import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => {
  const liveIds = new Set<string>();
  return {
    liveIds,
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
      if (!dependencies.liveIds.has(id)) throw new Error(`Cannot edit missing ${table} row`);
    }),
    restoreRow: vi.fn(),
    softDelete: vi.fn(),
    writeSetting: vi.fn(),
  };
});

vi.mock("../src/db/ids", () => ({ newId: () => "computed-1" }));
vi.mock("../src/db/mutations", () => ({
  assertLiveRow: dependencies.assertLiveRow,
  restoreRow: dependencies.restoreRow,
  softDelete: dependencies.softDelete,
  writeRows: dependencies.writeRows,
  writeRowsValidated: dependencies.writeRowsValidated,
  writeSetting: dependencies.writeSetting,
}));

import { saveComputedColumn } from "../src/data/repo/computed";

describe("computed-column repository boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.liveIds.clear();
  });

  it("persists a parsed definition and normalized name atomically", async () => {
    const id = await saveComputedColumn("user-1", {
      name: "  Net cash flow  ",
      definition: { op: "income_minus_expense" },
      sortOrder: 3,
    });

    expect(id).toBe("computed-1");
    expect(dependencies.writeRows).toHaveBeenCalledWith("user-1", [{
      table: "computed_columns",
      row: {
        id: "computed-1",
        name: "Net cash flow",
        definition: JSON.stringify({ op: "income_minus_expense" }),
        sortOrder: 3,
        deletedAt: null,
      },
    }]);
  });

  it("rejects an unsupported definition before touching persistence", async () => {
    await expect(saveComputedColumn("user-1", {
      name: "Unsafe",
      definition: { op: "eval", code: "1 + 1" } as never,
      sortOrder: 0,
    })).rejects.toThrow();

    expect(dependencies.writeRowsValidated).not.toHaveBeenCalled();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("rejects an edit whose target is no longer live", async () => {
    await expect(saveComputedColumn("user-1", {
      id: "missing",
      name: "Net cash flow",
      definition: { op: "income_minus_expense" },
      sortOrder: 0,
    })).rejects.toThrow("Cannot edit missing computed_columns row");

    expect(dependencies.writeRows).not.toHaveBeenCalled();
    expect(dependencies.assertLiveRow).toHaveBeenCalledWith({}, "computed_columns", "user-1", "missing");
  });
});
