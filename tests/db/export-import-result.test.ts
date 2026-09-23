import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const dependencies = vi.hoisted(() => ({
  getAllAsync: vi.fn(),
  writeRowBatchesAtomically: vi.fn(),
  platform: { OS: "web" },
  /** What the native file system was asked to do, in order. */
  files: [] as string[],
  existing: new Set<string>(),
}));

vi.mock("react-native", () => ({ Platform: dependencies.platform }));
vi.mock("expo-file-system", () => ({
  File: class {
    readonly uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    get exists() { return dependencies.existing.has(this.uri); }
    delete() { dependencies.files.push(`delete ${this.uri}`); }
    create() { dependencies.files.push(`create ${this.uri}`); }
    write(content: unknown) { dependencies.files.push(`write ${this.uri} ${typeof content === "string" ? content : `${(content as Uint8Array).length} bytes`}`); }
  },
  Paths: { cache: "cache" },
}));
vi.mock("../../src/db/client", () => ({
  getSqliteAsync: async () => ({ getAllAsync: dependencies.getAllAsync }),
}));
vi.mock("../../src/db/mutations", () => ({
  fromDbShape: (_table: string, row: Record<string, unknown>) => row,
  writeRowBatchesAtomically: dependencies.writeRowBatchesAtomically,
}));
// `importBundle` now runs every bundle through the cross-account id remap
// (`backup-remap.ts`), which calls the real `deterministicId`/`naturalKeys`
// from `../src/db/ids` — previously unreachable from this test because
// `../src/db/mutations` (the only other importer) was fully mocked above.
// Mirrors the mock in `backup-round-trip.test.ts`: a real SHA-256 mirror of
// `deterministicId` so a genuinely-deterministic fixture id round-trips.
vi.mock("../../src/db/ids", () => ({
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

import { importBundle, saveFile } from "../../src/services/export-import";

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

const setting = (n: number, updatedAt = "2026-07-21T10:00:00.000Z") => ({
  id: `00000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`,
  user_id: targetUserId, key: `k${n}`, value: JSON.stringify(n),
  created_at: timestamp, updated_at: updatedAt, deleted_at: null,
});
const category = (id: string, fields: Record<string, unknown>) => ({
  id, user_id: targetUserId, created_at: timestamp, updated_at: timestamp, deleted_at: null, tombstone_version: 0,
  name: "Market", kind: "expense", icon: null, color: null, sort_order: 0, is_column: 0, ...fields,
});
const bundle = (tables: Record<string, unknown[]>) => ({ version: 1, exportedAt: timestamp, tables });

describe("what a restore writes", () => {
  let batches: Record<string, unknown>[][];

  beforeEach(() => {
    batches = [];
    dependencies.writeRowBatchesAtomically.mockImplementation(async (_userId, source: Iterable<{ row: Record<string, unknown> }[]>) => {
      for (const batch of source) batches.push(batch.map((write) => write.row));
    });
  });

  it("writes in batches of 400, as restored rows rather than the user's own entries", async () => {
    await importBundle(targetUserId, bundle({ settings: Array.from({ length: 401 }, (_, n) => setting(n)) }), {});

    expect(batches.map((batch) => batch.length)).toEqual([400, 1]);
    expect(dependencies.writeRowBatchesAtomically.mock.calls[0]?.[2]).toBe(false);
  });

  it("writes no empty batch after a full one", async () => {
    await importBundle(targetUserId, bundle({ settings: Array.from({ length: 400 }, (_, n) => setting(n)) }));
    expect(batches.map((batch) => batch.length)).toEqual([400]);
  });

  it("takes a row newer than the local copy", async () => {
    dependencies.getAllAsync.mockImplementation(async (sql: string) =>
      sql.includes("FROM settings") ? [{ id: setting(0).id, updated_at: timestamp }] : []);

    expect(await importBundle(targetUserId, bundle({ settings: [setting(0)] }))).toEqual({ imported: 1, skipped: 0 });
  });

  it("lets a restored row point at a parent only this device holds", async () => {
    const localCategory = "00000000-0000-4000-8000-000000000011";
    dependencies.getAllAsync.mockImplementation(async (sql: string) =>
      sql.includes("FROM categories") ? [{ id: localCategory, updated_at: timestamp }] : []);

    await expect(importBundle(targetUserId, bundle({
      category_budgets: [{
        id: "00000000-0000-4000-8000-000000000020", user_id: targetUserId, created_at: timestamp, updated_at: timestamp,
        deleted_at: null, tombstone_version: 0, category_id: localCategory, month: "2026-07", amount_minor: 50_000,
      }],
    }))).resolves.toEqual({ imported: 1, skipped: 0 });
  });

  it("rewrites a retired colour name to its current slot", async () => {
    await importBundle(targetUserId, bundle({
      matrix_colors: [{
        id: "00000000-0000-4000-8000-000000000030", user_id: targetUserId, created_at: timestamp, updated_at: timestamp,
        deleted_at: null, tombstone_version: 0, scope: "column", item_key: null, month: "2026-07", token: "critical",
      }],
    }));
    expect(batches[0]?.[0]).toEqual(expect.objectContaining({ token: "red" }));
  });

  it("decides the transfer flag of a category written before it existed", async () => {
    const [moved, invest, income, declared] = [31, 32, 33, 34].map((n) => `00000000-0000-4000-8000-0000000000${n}`);
    await importBundle(targetUserId, bundle({
      categories: [
        category(moved!, { name: "Birikim" }),
        category(invest!, { name: "YATIRIM hesabı" }),
        category(income!, { name: "Yatırım geliri", kind: "income" }),
        category(declared!, { name: "Yatırım", is_transfer: 0 }),
      ],
      persons: [{ id: "00000000-0000-4000-8000-000000000040", user_id: targetUserId, created_at: timestamp, updated_at: timestamp,
        deleted_at: null, tombstone_version: 0, name: "Ben", is_self: 1 }],
      transactions: [{
        id: "00000000-0000-4000-8000-000000000041", user_id: targetUserId, created_at: timestamp, updated_at: timestamp,
        deleted_at: null, tombstone_version: 0, type: "transfer", amount_minor: 1_000, currency: "TRY", fx_rate: null,
        amount_try_minor: 1_000, entry_date: "2026-07-15", purchase_date: null, effective_date: "2026-07-15",
        status: "realized", category_id: moved, payment_source_id: null, person_id: "00000000-0000-4000-8000-000000000040",
        installment_plan_id: null, installment_no: null, card_statement_id: null, subscription_id: null, is_aggregate: 0, note: null,
      }],
    }));

    const flags = Object.fromEntries(batches.flat().filter((row) => "kind" in row).map((row) => [row.id, row.isTransfer ?? row.is_transfer]));
    expect(flags).toEqual({ [moved!]: true, [invest!]: true, [income!]: false, [declared!]: 0 });
  });

  it("passes on a failure that is not about the investment wallet unchanged", async () => {
    const failure = new Error("disk full");
    dependencies.writeRowBatchesAtomically.mockRejectedValue(failure);
    await expect(importBundle(targetUserId, bundle({ settings: [setting(0)] }))).rejects.toBe(failure);
  });
});

describe("handing a file to the platform", () => {
  const download = () => {
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:helix";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    return { anchor, created, revoke };
  };

  beforeEach(() => {
    dependencies.platform.OS = "web";
    dependencies.files.length = 0;
    dependencies.existing.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads text and bytes on the web, typed as asked", async () => {
    const { anchor, created, revoke } = download();

    expect(await saveFile("yedek.json", "{}", "application/json")).toBeNull();
    expect(await saveFile("helix.xlsx", new Uint8Array([1, 2, 3]), "application/vnd.ms-excel")).toBeNull();

    expect(await Promise.all(created.map(async (blob) => [blob.type, blob.size]))).toEqual([
      ["application/json", 2],
      ["application/vnd.ms-excel", 3],
    ]);
    expect(anchor).toEqual(expect.objectContaining({ href: "blob:helix", download: "helix.xlsx" }));
    expect(anchor.click).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:helix");
    expect(dependencies.files).toEqual([]);
  });

  it("writes a fresh cache file natively, replacing one left from before", async () => {
    dependencies.platform.OS = "ios";
    dependencies.existing.add("cache/helix.xlsx");

    expect(await saveFile("yedek.json", "{}", "application/json")).toBe("cache/yedek.json");
    expect(await saveFile("helix.xlsx", new Uint8Array([1, 2, 3]), "application/vnd.ms-excel")).toBe("cache/helix.xlsx");

    expect(dependencies.files).toEqual([
      "create cache/yedek.json", "write cache/yedek.json {}",
      "delete cache/helix.xlsx", "create cache/helix.xlsx", "write cache/helix.xlsx 3 bytes",
    ]);
  });
});

