/**
 * Storing and removing attachment rows.
 *
 * The write ORDER is the point: the file lands before the row that names it,
 * and on delete the row is tombstoned while the file is left for the
 * maintenance sweep — so an interruption leaves collectable garbage rather
 * than an attachment the list offers and cannot open.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) => harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => ({
      changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
    }),
  }),
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/ids", () => ({
  newId: () => `0198f2aa-1c2d-7e3f-8a9b-00000000000${++harness.nextId}`,
  deterministicId: async (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32),
  naturalKeys: new Proxy({}, {
    get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}`,
  }),
}));
vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import {
  addAttachment,
  deleteAttachment,
  liveAttachmentNames,
  listAttachments,
  restoreAttachment,
} from "../src/data/repo/attachments";
import { AttachmentRejectedError } from "../src/data/repo/errors";

const USER = "attachment-user";
const OTHER = "other-user";
const NOW = "2026-08-18T09:00:00.000Z";
const migrationsDir = join(process.cwd(), "src/db/migrations");
const migrationSql = readdirSync(migrationsDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .flatMap((name) => readFileSync(join(migrationsDir, name), "utf8").split("--> statement-breakpoint"))
  .map((statement) => statement.trim())
  .filter(Boolean);

function seed(userId = USER, transactionId = "tx-1"): void {
  harness.db!.prepare(
    `INSERT OR IGNORE INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES ('person-self', ?, ?, ?, NULL, 0, 'Ben', 1)`,
  ).run(userId, NOW, NOW);
  harness.db!.prepare(
    `INSERT INTO transactions (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       type, amount_minor, currency, amount_try_minor, entry_date, effective_date, status, person_id, is_aggregate)
     VALUES (?, ?, ?, ?, NULL, 0, 'expense', 100, 'TRY', 100, '2026-08-18', '2026-08-18', 'realized', 'person-self', 0)`,
  ).run(transactionId, userId, NOW, NOW);
}

const copied: string[] = [];
const newAttachment = (over: Record<string, unknown> = {}) => ({
  transactionId: "tx-1",
  fileName: "fatura.pdf",
  mimeType: "application/pdf",
  byteSize: 2048,
  copyInto: async (storedName: string) => { copied.push(storedName); },
  ...over,
});

describe("attachment rows", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationSql) harness.db.exec(statement);
    harness.nextId = 0;
    copied.length = 0;
    seed();
  });

  it("copies the file before writing the row that names it", async () => {
    const id = await addAttachment(USER, newAttachment());
    expect(copied).toEqual([`${id}.pdf`]);
    const rows = await listAttachments(USER, "tx-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: "fatura.pdf", mimeType: "application/pdf", byteSize: 2048, kind: "other" });
  });

  it("refuses a rejected file without copying anything or writing a row", async () => {
    await expect(addAttachment(USER, newAttachment({ mimeType: "application/zip" })))
      .rejects.toBeInstanceOf(AttachmentRejectedError);
    expect(copied).toEqual([]);
    expect(await listAttachments(USER, "tx-1")).toEqual([]);
  });

  it("refuses to attach to a transaction this account does not own", async () => {
    seed(OTHER, "tx-other");
    await expect(addAttachment(USER, newAttachment({ transactionId: "tx-other" }))).rejects.toThrow();
    expect(await listAttachments(USER, "tx-other")).toEqual([]);
  });

  it("never lists another account's attachments", async () => {
    await addAttachment(USER, newAttachment());
    expect(await listAttachments(OTHER, "tx-1")).toEqual([]);
  });

  /**
   * The row is tombstoned and the FILE IS LEFT: undo has to bring the whole
   * document back, and a row whose bytes were already deleted would return as
   * an attachment that cannot be opened.
   */
  it("tombstones the row on delete and reports the file for later collection", async () => {
    const id = await addAttachment(USER, newAttachment());
    const snapshot = await deleteAttachment(USER, id);
    expect(snapshot?.storedName).toBe(`${id}.pdf`);
    expect(await listAttachments(USER, "tx-1")).toEqual([]);

    await restoreAttachment(USER, snapshot!);
    expect(await listAttachments(USER, "tx-1")).toHaveLength(1);
  });

  it("reports nothing to delete for a row that is already gone", async () => {
    expect(await deleteAttachment(USER, "missing")).toBeNull();
  });

  /**
   * A stored name is about to become a filesystem path, and this row may have
   * arrived from sync or a restored backup rather than from the picker — so it
   * is re-validated on the way OUT, not only on the way in.
   */
  it("hides a row whose stored name this app could not have written", async () => {
    const id = await addAttachment(USER, newAttachment());
    harness.db!.prepare(`UPDATE attachments SET stored_name = '../escape.pdf' WHERE id = ?`).run(id);
    expect(await listAttachments(USER, "tx-1")).toEqual([]);
    expect(await liveAttachmentNames(USER)).toEqual(new Set());
  });

  it("reports the names still worth keeping on disk", async () => {
    const kept = await addAttachment(USER, newAttachment());
    const removed = await addAttachment(USER, newAttachment({ fileName: "fis.jpg", mimeType: "image/jpeg" }));
    await deleteAttachment(USER, removed);
    expect(await liveAttachmentNames(USER)).toEqual(new Set([`${kept}.pdf`]));
  });
});
