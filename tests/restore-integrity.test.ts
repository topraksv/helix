/**
 * Explicit undo may only restore the tombstone that this account just created.
 * A snapshot is application state, not an authorization token: if its owner or
 * tombstoned target no longer matches the current local workspace, restoring it
 * would create a new row and queue it for sync.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  failOnPersonWrite: null as number | null,
  personWrites: 0,
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[]) => harness.db!.prepare(sql).get(...args as never[]),
    getAllAsync: async (sql: string, args: unknown[]) => harness.db!.prepare(sql).all(...args as never[]),
    runAsync: async (sql: string, args: unknown[]) => {
      if (sql.trimStart().startsWith("INSERT INTO persons")) {
        harness.personWrites += 1;
        if (harness.personWrites === harness.failOnPersonWrite) {
          throw Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
        }
      }
      return { changes: Number(harness.db!.prepare(sql).run(...args as never[]).changes) };
    },
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
  deterministicId: async (key: string) => `id:${key}`,
  naturalKeys: new Proxy({}, { get: (_target, property) => (...parts: unknown[]) => `${String(property)}|${parts.join("|")}` }),
}));

import { restoreRow, restoreRows, writeRowBatchesAtomically } from "../src/db/mutations";

const INSERTED = "2026-07-01T00:00:00.000Z";
const DELETED = "2026-07-02T00:00:00.000Z";

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE persons (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      tombstone_version INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      is_self INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      tombstone_version INTEGER NOT NULL DEFAULT 0,
      key TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL DEFAULT 'upsert',
      payload TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
}

function person(id: string, userId: string, deletedAt: string | null) {
  return {
    id,
    user_id: userId,
    created_at: INSERTED,
    updated_at: DELETED,
    deleted_at: deletedAt,
    tombstone_version: 1,
    name: "Kişi",
    is_self: 0,
  };
}

describe("restore ownership and tombstone boundary", () => {
  beforeEach(() => {
    harness.db = new DatabaseSync(":memory:");
    harness.failOnPersonWrite = null;
    harness.personWrites = 0;
    createSchema(harness.db);
  });

  it("restores an existing tombstone owned by the current account", async () => {
    const snapshot = person("person-1", "user-1", DELETED);
    harness.db!.prepare(`
      INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(snapshot.id, snapshot.user_id, snapshot.created_at, snapshot.updated_at, snapshot.deleted_at, snapshot.tombstone_version, snapshot.name, snapshot.is_self);

    await restoreRow("user-1", "persons", snapshot);

    expect((harness.db!.prepare("SELECT user_id, deleted_at FROM persons WHERE id = ?").get("person-1") as Record<string, unknown>))
      .toMatchObject({ user_id: "user-1", deleted_at: null });
  });

  it("rejects a foreign snapshot instead of inserting it into the current workspace", async () => {
    const snapshot = person("person-foreign", "user-a", DELETED);

    await expect(restoreRow("user-b", "persons", snapshot)).rejects.toThrow(/restore.*owner|account/i);

    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM persons").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("rejects a snapshot whose tombstoned target is no longer present", async () => {
    await expect(restoreRow("user-1", "persons", person("purged", "user-1", DELETED)))
      .rejects.toThrow(/restore.*missing|tombstone/i);
  });

  it("does not overwrite a later live row with an older delete snapshot", async () => {
    const live = person("person-1", "user-1", null);
    harness.db!.prepare(`
      INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(live.id, live.user_id, live.created_at, live.updated_at, live.deleted_at, live.tombstone_version, "Yeni kişi", live.is_self);

    await expect(restoreRow("user-1", "persons", { ...live, deleted_at: DELETED, name: "Eski kişi" }))
      .rejects.toThrow(/restore.*tombstone/i);
    expect((harness.db!.prepare("SELECT name FROM persons WHERE id = ?").get("person-1") as Record<string, unknown>).name)
      .toBe("Yeni kişi");
  });

  it("validates every row before a composite restore writes any of them", async () => {
    const valid = person("person-1", "user-1", DELETED);
    harness.db!.prepare(`
      INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(valid.id, valid.user_id, valid.created_at, valid.updated_at, valid.deleted_at, valid.tombstone_version, valid.name, valid.is_self);

    await expect(restoreRows("user-1", [
      { table: "persons", row: { ...valid, deletedAt: null, userId: valid.user_id } },
      { table: "persons", row: { ...person("missing", "user-1", DELETED), deletedAt: null, userId: "user-1" } },
    ])).rejects.toThrow(/restore.*tombstone/i);

    expect((harness.db!.prepare("SELECT deleted_at FROM persons WHERE id = ?").get("person-1") as Record<string, unknown>).deleted_at)
      .toBe(DELETED);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("rolls back every row and outbox event when SQLite reports a full disk mid-batch", async () => {
    const anchor = person("anchor", "user-1", null);
    harness.db!.prepare(`
      INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(anchor.id, anchor.user_id, anchor.created_at, anchor.updated_at, anchor.deleted_at, 0, anchor.name, anchor.is_self);
    harness.failOnPersonWrite = 2;
    const row = (id: string) => ({
      id,
      userId: "user-1",
      createdAt: INSERTED,
      updatedAt: INSERTED,
      deletedAt: null,
      tombstoneVersion: 0,
      name: id,
      isSelf: false,
    });

    await expect(writeRowBatchesAtomically("user-1", [[
      { table: "persons", row: row("person-1") },
      { table: "persons", row: row("person-2") },
    ]], false)).rejects.toMatchObject({ code: "SQLITE_FULL" });

    expect(harness.db!.prepare("SELECT id FROM persons ORDER BY id").all()).toEqual([{ id: "anchor" }]);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });
});
