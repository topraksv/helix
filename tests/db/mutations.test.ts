/** created_at is insert-only: upsertSql leaves it out of DO UPDATE SET, so a builder that writes a row literal cannot reset it. Runs the real SQL. */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/client", () => ({
  getSqliteAsync: async () => ({ runAsync: vi.fn(), getAllAsync: vi.fn(), getFirstAsync: vi.fn() }),
  withTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../src/db/ids", () => ({
  deterministicId: async (key: string) => `id:${key}`,
  naturalKeys: new Proxy({}, { get: (_t, p) => (...parts: unknown[]) => `${String(p)}|${parts.join("|")}` }),
  newId: () => "new-id",
}));

import { assertLiveRow, fromDbShape, upsertSql } from "../../src/db/mutations";

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

  it("cannot rewrite a colliding row from another local owner", () => {
    apply(db, row());
    apply(db, row({ user_id: "user-2", name: "foreign overwrite", updated_at: EDITED }));
    const after = read(db);
    expect(after.user_id).toBe("user-1");
    expect(after.name).toBe("Market");
    expect(after.updated_at).toBe(INSERTED);
  });
});

describe("assertLiveRow", () => {
  it("requires an actually live row for explicit edits", async () => {
    const sqlite = { getFirstAsync: vi.fn().mockResolvedValue(null) };
    await expect(assertLiveRow(sqlite as never, "categories", "user-1", "cat-1"))
      .rejects.toThrow("Cannot edit missing categories row");
    sqlite.getFirstAsync.mockResolvedValue({ id: "cat-1" });
    await expect(assertLiveRow(sqlite as never, "categories", "user-1", "cat-1")).resolves.toBeUndefined();
  });
});

const storedTransaction = {
  id: "tx-1",
  user_id: "user-1",
  type: "expense",
  amount_minor: 12_34,
  amount_try_minor: 12_34,
  currency: "TRY",
  effective_date: "2026-08-06",
  is_aggregate: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-08-06T00:00:00.000Z",
  deleted_at: null,
};

describe("row shape: fromDbShape", () => {
  it("renames every stored column to the key the write layer writes", () => {
    const row = fromDbShape("transactions", storedTransaction);
    expect(row).toMatchObject({
      id: "tx-1",
      userId: "user-1",
      amountMinor: 12_34,
      amountTryMinor: 12_34,
      effectiveDate: "2026-08-06",
      isAggregate: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });
    // The snake_case originals must not survive beside their renamed twins:
    // `writeRows` would carry them into the upsert as unknown columns.
    expect(Object.keys(row).some((key) => key.includes("_"))).toBe(false);
  });

  it("keeps a column that is present and null, and omits one that is absent", () => {
    const row = fromDbShape("transactions", storedTransaction);
    // Present-and-null is a real value — dropping it would leave a tombstone in
    // place on restore, because the spread would never clear `deleted_at`.
    expect("deletedAt" in row).toBe(true);
    expect(row.deletedAt).toBeNull();
    // Absent is not `undefined`: a partial row must not blank the columns it
    // never carried.
    expect("note" in row).toBe(false);
  });

  it("drops a column the table does not have", () => {
    const row = fromDbShape("transactions", { ...storedTransaction, legacy_column: "x", note: "kept" });
    expect(row.note).toBe("kept");
    expect(Object.values(row)).not.toContain("x");
  });

  it("returns nothing at all for a row that is already in application shape", () => {
    // An application-shaped row passed where a stored row was meant would write one column over a row with no id.
    expect(fromDbShape("transactions", { id: "tx-1", amountMinor: 1, effectiveDate: "2026-08-06" })).toEqual({
      id: "tx-1",
    });
  });
});
