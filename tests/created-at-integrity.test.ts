/**
 * `created_at` is insert-only.
 *
 * It used to sit in the upsert's `DO UPDATE SET` list, and `writeRows` stamps
 * `createdAt: row.createdAt ?? nowIso()`. Together that meant any builder which
 * constructs a row LITERAL — rather than spreading `fromDbShape(previous)` —
 * reset the row's creation time on every edit: category budgets
 * (`budgets.ts:23-32`), subscription and recurring-income upserts
 * (`rules.ts:201-228`, `283-301`), expected-payment confirms
 * (`expected.ts:133-149`) and the maintenance re-upserts of already-existing
 * pending drafts (`rules.ts:94-110`, `maintenance.ts:314-330`).
 *
 * `transactions.ts:56-72` compensated by reading and re-supplying `created_at`,
 * which is a per-caller workaround for a property of the write layer — so the
 * fix belongs in `upsertSql`, where it covers every caller including ones added
 * later. These tests run the REAL generated SQL against a real SQLite table.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({ runAsync: vi.fn(), getAllAsync: vi.fn(), getFirstAsync: vi.fn() }),
  withTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `id:${key}`,
  naturalKeys: new Proxy({}, { get: (_t, p) => (...parts: unknown[]) => `${String(p)}|${parts.join("|")}` }),
  newId: () => "new-id",
}));

import { upsertSql } from "../src/db/mutations";

const CREATE = `CREATE TABLE categories (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  deleted_at text
)`;

const INSERTED = "2026-01-01T00:00:00.000Z";
const EDITED = "2026-07-21T10:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "cat-1",
    user_id: "user-1",
    name: "Market",
    created_at: INSERTED,
    updated_at: INSERTED,
    deleted_at: null,
    ...overrides,
  };
}

function apply(db: DatabaseSync, dbRow: Record<string, unknown>) {
  const { sql, args } = upsertSql("categories", dbRow);
  db.prepare(sql).run(...(args as never[]));
}

function read(db: DatabaseSync) {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get("cat-1") as Record<string, unknown>;
}

describe("created_at integrity", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(CREATE);
  });

  it("sets created_at once, on insert", () => {
    apply(db, row());
    expect(read(db).created_at).toBe(INSERTED);
  });

  it("does NOT rewrite created_at on a plain update", () => {
    apply(db, row());
    // A builder that constructs a literal supplies "now" as created_at.
    apply(db, row({ name: "Market & Gıda", created_at: EDITED, updated_at: EDITED }));
    const after = read(db);
    expect(after.created_at).toBe(INSERTED);
    expect(after.updated_at).toBe(EDITED);
    expect(after.name).toBe("Market & Gıda");
  });

  it("survives repeated maintenance re-upserts of an existing row", () => {
    apply(db, row());
    for (let pass = 1; pass <= 5; pass++) {
      apply(db, row({ created_at: `2026-07-2${pass}T00:00:00.000Z`, updated_at: `2026-07-2${pass}T00:00:00.000Z` }));
    }
    expect(read(db).created_at).toBe(INSERTED);
  });

  it("survives a sync replay of the same row payload", () => {
    apply(db, row());
    // Replay: the same logical row arrives again with a later stamp.
    apply(db, row({ updated_at: EDITED, created_at: EDITED }));
    apply(db, row({ updated_at: EDITED, created_at: EDITED }));
    expect(read(db).created_at).toBe(INSERTED);
  });

  it("keeps the original creation time through a conflict resolution write", () => {
    apply(db, row());
    // Last-write-wins merge: newer content, but the row was still created then.
    apply(db, row({ name: "renamed by the other device", created_at: EDITED, updated_at: EDITED }));
    expect(read(db).created_at).toBe(INSERTED);
    expect(read(db).name).toBe("renamed by the other device");
  });

  it("still updates a tombstone without resetting creation time", () => {
    apply(db, row());
    apply(db, row({ deleted_at: EDITED, updated_at: EDITED, created_at: EDITED }));
    const after = read(db);
    expect(after.deleted_at).toBe(EDITED);
    expect(after.created_at).toBe(INSERTED);
  });

  it("orders correctly by created_at after edits — the duplicate-self repair contract", () => {
    // maintenance.ts keeps the OLDEST self person; editing the newer one must
    // not make it look older than the one that should be kept.
    apply(db, row({ id: "cat-1", created_at: INSERTED, updated_at: INSERTED }));
    db.prepare(
      "INSERT INTO categories (id, user_id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)",
    ).run("cat-2", "user-1", "Later", "2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z");
    apply(db, {
      id: "cat-2",
      user_id: "user-1",
      name: "Later edited",
      created_at: EDITED,
      updated_at: EDITED,
      deleted_at: null,
    });
    const ordered = db
      .prepare("SELECT id FROM categories WHERE user_id = ? ORDER BY created_at ASC")
      .all("user-1") as { id: string }[];
    expect(ordered.map((r) => r.id)).toEqual(["cat-1", "cat-2"]);
  });

  it("never emits created_at in the update branch of the statement", () => {
    const { sql } = upsertSql("categories", row());
    const updateBranch = sql.slice(sql.indexOf("DO UPDATE SET"));
    expect(updateBranch).not.toContain("created_at");
    expect(updateBranch).toContain("updated_at = excluded.updated_at");
    // The INSERT branch must still carry it, or a new row would have none.
    expect(sql.slice(0, sql.indexOf("ON CONFLICT"))).toContain("created_at");
  });
});
