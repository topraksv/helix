/** Runs against the real migration DDL: SQLite fails a bad column only at execution, which a mocked sqlite cannot catch. */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

import { DEAD_LETTER_COUNT_SQL } from "../../src/sync/status";
import { migrationStatements, required } from "../helpers";

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) db.exec(statement);
  return db;
}

const INSERT_SQL = `INSERT OR IGNORE INTO sync_dead_letters
  (outbox_id, table_name, row_id, payload, reason, quarantined_at)
  VALUES (?, ?, ?, ?, ?, ?)`;

describe("dead-letter quarantine count", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = freshDatabase();
  });

  it("executes against the shipped schema", () => {
    const row = db.prepare(DEAD_LETTER_COUNT_SQL).get() as { count: number } | undefined;
    expect(required(row).count).toBe(0);
  });

  it("counts rows written by the engine's own insert statement", () => {
    db.prepare(INSERT_SQL).run(1, "transactions", "row-1", "{}", "malformed_payload", "2026-07-20T00:00:00.000Z");
    db.prepare(INSERT_SQL).run(2, "transactions", "row-2", "{}", "wrong_user", "2026-07-20T00:00:01.000Z");
    // Same outbox id → INSERT OR IGNORE on the unique index, not a second row.
    db.prepare(INSERT_SQL).run(2, "transactions", "row-2", "{}", "wrong_user", "2026-07-20T00:00:02.000Z");

    const row = db.prepare(DEAD_LETTER_COUNT_SQL).get() as { count: number } | undefined;
    expect(required(row).count).toBe(2);
  });

  it("has no user column to filter on — the local database is single-account", () => {
    const columns = (db.prepare("PRAGMA table_info(sync_dead_letters)").all() as { name: string }[])
      .map((column) => column.name);
    expect(columns).not.toContain("user_id");
    expect(() => db.prepare("SELECT COUNT(*) FROM sync_dead_letters WHERE user_id = ?").get("u1")).toThrow(
      /no such column/i,
    );
  });

  it("is a bare aggregate, so it can never bind a non-existent column", () => {
    expect(DEAD_LETTER_COUNT_SQL).not.toMatch(/where/i);
    expect(DEAD_LETTER_COUNT_SQL).not.toMatch(/\?/);
  });
});
