import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getAllAsync: vi.fn(),
  writeRowBatchesAtomically: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "" } }));
vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({ getAllAsync: dependencies.getAllAsync }),
}));
vi.mock("../src/db/mutations", () => ({
  fromDbShape: (_table: string, row: Record<string, unknown>) => row,
  writeRowBatchesAtomically: dependencies.writeRowBatchesAtomically,
}));

import { importBundle } from "../src/services/export-import";

const sourceUserId = "00000000-0000-4000-8000-000000000001";
const targetUserId = "00000000-0000-4000-8000-000000000002";
const settingId = "00000000-0000-4000-8000-000000000003";
const timestamp = "2026-07-20T10:00:00.000Z";

describe("backup import result counts", () => {
  beforeEach(() => {
    dependencies.getAllAsync.mockReset();
    dependencies.writeRowBatchesAtomically.mockReset();
    dependencies.getAllAsync.mockImplementation(async (sql: string) =>
      sql.includes("FROM settings") ? [{ id: settingId, updated_at: timestamp }] : [],
    );
    dependencies.writeRowBatchesAtomically.mockImplementation(async (_userId, batches: Iterable<unknown[]>) => {
      for (const _batch of batches) { /* consume the lazy restore plan */ }
    });
  });

  it("reports a local newer-or-equal row as skipped", async () => {
    const result = await importBundle(targetUserId, {
      version: 1,
      exportedAt: timestamp,
      tables: {
        settings: [{
          id: settingId,
          user_id: sourceUserId,
          key: "theme",
          value: JSON.stringify("dark"),
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
        }],
      },
    });

    expect(result).toEqual({ imported: 0, skipped: 1 });
  });
});
