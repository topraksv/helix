/**
 * The dead-letter completion count runs against the REAL local schema, so it is
 * tested against the real migration DDL rather than a mock.
 *
 * A `WHERE user_id = ?` predicate used to sit on this statement even though
 * `sync_dead_letters` has no such column. SQLite only fails at execution time,
 * and the statement runs AFTER a successful push+pull, so every healthy sync
 * was reported as an error: `lastSyncAt` never advanced, the backoff retried
 * forever, `syncNow` always resolved `false`, and account freeze could never
 * complete. A mocked sqlite cannot catch that class of bug.
 */

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { completedSyncState, DEAD_LETTER_COUNT_SQL } from "../src/sync/status";
import { required } from "./helpers";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

/** Statements of the migration that creates the quarantine table. */
function deadLetterDdl(): string[] {
  const sql = readFileSync(join(migrationsDir, "0002_sync_dead_letters.sql"), "utf8");
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const statement of deadLetterDdl()) db.exec(statement);
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

describe("sync completion state", () => {
  it("reports attention only while rows are quarantined", () => {
    const db = freshDatabase();
    expect(completedSyncState(required(db.prepare(DEAD_LETTER_COUNT_SQL).get() as { count: number }).count)).toBe("idle");

    db.prepare(INSERT_SQL).run(9, "categories", "row-9", "{}", "invalid_row", "2026-07-20T00:00:00.000Z");
    expect(completedSyncState(required(db.prepare(DEAD_LETTER_COUNT_SQL).get() as { count: number }).count)).toBe(
      "attention",
    );
  });
});
