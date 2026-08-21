/**
 * Storing and removing attachment rows.
 *
 * The write ORDER is the point: the file lands before the row that names it,
 * and on delete the row is tombstoned while the file is left for the
 * maintenance sweep — so an interruption leaves collectable garbage rather
 * than an attachment the list offers and cannot open.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ db: null as DatabaseSync | null, nextId: 0 }));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});

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
  restoreAttachment,
} from "../src/data/repo/attachments";
import { AttachmentRejectedError } from "../src/data/repo/errors";
import { migrationStatements } from "./helpers";

/**
 * The read-back these assertions need. Production reads attachments through
 * the `useAttachmentsState` live query, so the repo layer exports no list
 * function for this to borrow.
 */
const listed = (userId: string, transactionId: string): Record<string, unknown>[] =>
  harness.db!.prepare(
    `SELECT file_name, mime_type, byte_size, kind FROM attachments
     WHERE user_id = ? AND transaction_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
  ).all(userId, transactionId) as Record<string, unknown>[];

const USER = "attachment-user";
const OTHER = "other-user";
const NOW = "2026-08-18T09:00:00.000Z";

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
    for (const statement of migrationStatements) harness.db.exec(statement);
    harness.nextId = 0;
    copied.length = 0;
    seed();
  });

  it("copies the file before writing the row that names it", async () => {
    const id = await addAttachment(USER, newAttachment());
    expect(copied).toEqual([`${id}.pdf`]);
    const rows = listed(USER, "tx-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ file_name: "fatura.pdf", mime_type: "application/pdf", byte_size: 2048, kind: "other" });
  });

  it("refuses a rejected file without copying anything or writing a row", async () => {
    await expect(addAttachment(USER, newAttachment({ mimeType: "application/zip" })))
      .rejects.toBeInstanceOf(AttachmentRejectedError);
    expect(copied).toEqual([]);
    expect(listed(USER, "tx-1")).toEqual([]);
  });

  it("refuses to attach to a transaction this account does not own", async () => {
    seed(OTHER, "tx-other");
    await expect(addAttachment(USER, newAttachment({ transactionId: "tx-other" }))).rejects.toThrow();
    expect(listed(USER, "tx-other")).toEqual([]);
  });

  it("never lists another account's attachments", async () => {
    await addAttachment(USER, newAttachment());
    expect(listed(OTHER, "tx-1")).toEqual([]);
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
    expect(listed(USER, "tx-1")).toEqual([]);

    await restoreAttachment(USER, snapshot!);
    expect(listed(USER, "tx-1")).toHaveLength(1);
  });

  it("reports nothing to delete for a row that is already gone", async () => {
    expect(await deleteAttachment(USER, "missing")).toBeNull();
  });

  /**
   * A stored name is about to become a filesystem path, and this row may have
   * arrived from sync or a restored backup rather than from the picker — so
   * the sweep re-validates it on the way OUT, not only on the way in. Opening
   * one is refused separately, in `attachment-store`'s own path resolution.
   */
  it("keeps a stored name this app could not have written out of the sweep", async () => {
    const id = await addAttachment(USER, newAttachment());
    harness.db!.prepare(`UPDATE attachments SET stored_name = '../escape.pdf' WHERE id = ?`).run(id);
    expect(await liveAttachmentNames(USER)).toEqual(new Set());
  });

  it("reports the names still worth keeping on disk", async () => {
    const kept = await addAttachment(USER, newAttachment());
    const removed = await addAttachment(USER, newAttachment({ fileName: "fis.jpg", mimeType: "image/jpeg" }));
    await deleteAttachment(USER, removed);
    expect(await liveAttachmentNames(USER)).toEqual(new Set([`${kept}.pdf`]));
  });
});
