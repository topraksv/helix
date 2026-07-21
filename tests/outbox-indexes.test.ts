import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

function indexedOutbox(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL DEFAULT 'upsert',
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);
  const migration = readFileSync(join(migrationsDir, "0006_odd_darwin.sql"), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
  return db;
}

function indexColumns(db: DatabaseSync, name: string): string[] {
  return (db.prepare(`PRAGMA index_info(${name})`).all() as { name: string }[]).map((column) => column.name);
}

describe("outbox lookup indexes", () => {
  it("ships indexes matching both sync-engine lookup patterns", () => {
    const db = indexedOutbox();

    expect(indexColumns(db, "idx_outbox_table_id")).toEqual(["table_name", "id"]);
    expect(indexColumns(db, "idx_outbox_table_row_id_id")).toEqual(["table_name", "row_id", "id"]);
  });

  it("uses the indexes for batch selection and acknowledgement checks", () => {
    const db = indexedOutbox();
    const batchPlan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id, payload, row_id FROM outbox WHERE table_name = ? ORDER BY id ASC LIMIT 200",
      )
      .all("transactions") as { detail: string }[];
    const acknowledgementPlan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM outbox WHERE table_name = ? AND row_id = ? ORDER BY id DESC LIMIT 1",
      )
      .all("transactions", "row-1") as { detail: string }[];

    expect(batchPlan.map((step) => step.detail).join("\n")).toContain("idx_outbox_table_id");
    expect(acknowledgementPlan.map((step) => step.detail).join("\n")).toContain(
      "idx_outbox_table_row_id_id",
    );
  });
});
