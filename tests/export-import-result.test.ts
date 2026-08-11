import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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
// `importBundle` now runs every bundle through the cross-account id remap
// (`backup-remap.ts`), which calls the real `deterministicId`/`naturalKeys`
// from `../src/db/ids` — previously unreachable from this test because
// `../src/db/mutations` (the only other importer) was fully mocked above.
// Mirrors the mock in `backup-round-trip.test.ts`: a real SHA-256 mirror of
// `deterministicId` so a genuinely-deterministic fixture id round-trips.
vi.mock("../src/db/ids", () => ({
  deterministicId: async (naturalKey: string) => {
    const hex = createHash("sha256").update(naturalKey).digest("hex");
    const nibbles = hex.slice(0, 32).split("");
    nibbles[12] = "8";
    nibbles[16] = "8";
    const s = nibbles.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
  },
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));

import { importBundle } from "../src/services/export-import";

// A backup restores into the account that wrote it — a bundle from another
// account is refused outright (see backup-round-trip.test.ts), so these
// fixtures carry the importing account's id.
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
    dependencies.writeRowBatchesAtomically.mockImplementation(async (
      _userId,
      batches: Iterable<unknown[]>,
      _isUserEntry: boolean,
    ) => {
      for (const batch of batches) {
        for (const _write of batch) void _write;
      }
    });
  });

  it("reports a local newer-or-equal row as skipped", async () => {
    const result = await importBundle(targetUserId, {
      version: 1,
      exportedAt: timestamp,
      tables: {
        settings: [{
          id: settingId,
          user_id: targetUserId,
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

  it("reports restore phases instead of storage-row progress", async () => {
    const newerId = "00000000-0000-4000-8000-000000000004";
    const progress: Array<[number, number]> = [];
    const result = await importBundle(targetUserId, {
      version: 1,
      exportedAt: timestamp,
      tables: {
        settings: [
          {
            id: settingId,
            user_id: targetUserId,
            key: "theme",
            value: JSON.stringify("dark"),
            created_at: timestamp,
            updated_at: timestamp,
            deleted_at: null,
          },
          {
            id: newerId,
            user_id: targetUserId,
            key: "palette",
            value: JSON.stringify("sand"),
            created_at: timestamp,
            updated_at: "2026-07-21T10:00:00.000Z",
            deleted_at: null,
          },
        ],
      },
    }, {
      onProgress: (completed, total) => progress.push([completed, total]),
    });

    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("honours cancellation before restore planning or writes", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    await expect(importBundle(targetUserId, {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(dependencies.writeRowBatchesAtomically).not.toHaveBeenCalled();
  });

  it("rejects a dangling relationship before the atomic writer is called", async () => {
    const personId = "00000000-0000-4000-8000-000000000010";
    await expect(importBundle(targetUserId, {
      version: 1,
      exportedAt: timestamp,
      tables: {
        persons: [{
          id: personId,
          user_id: targetUserId,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          tombstone_version: 0,
          name: "Ben",
          is_self: 1,
        }],
        transactions: [{
          id: "00000000-0000-4000-8000-000000000012",
          user_id: targetUserId,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          tombstone_version: 0,
          type: "expense",
          amount_minor: 1_000,
          currency: "TRY",
          fx_rate: null,
          amount_try_minor: 1_000,
          entry_date: "2026-07-15",
          purchase_date: null,
          effective_date: "2026-07-15",
          status: "realized",
          category_id: "00000000-0000-4000-8000-000000000011",
          payment_source_id: null,
          person_id: personId,
          installment_plan_id: null,
          installment_no: null,
          card_statement_id: null,
          subscription_id: null,
          is_aggregate: 0,
          note: null,
        }],
      },
    })).rejects.toThrow("Geçersiz yedek dosyası");
    expect(dependencies.writeRowBatchesAtomically).not.toHaveBeenCalled();
  });

  it("rejects duplicate ids before the atomic writer is called", async () => {
    const row = {
      id: settingId,
      user_id: targetUserId,
      key: "theme",
      value: JSON.stringify("dark"),
      created_at: timestamp,
      updated_at: "2026-07-21T10:00:00.000Z",
      deleted_at: null,
    };

    await expect(importBundle(targetUserId, {
      version: 1,
      exportedAt: timestamp,
      tables: { settings: [row, row] },
    })).rejects.toThrow("Geçersiz yedek dosyası");
    expect(dependencies.writeRowBatchesAtomically).not.toHaveBeenCalled();
  });
});
