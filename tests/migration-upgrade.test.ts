/**
 * An existing install must reach the same schema a fresh one does.
 *
 * `migrateDb` runs on every boot and is the only thing standing between a
 * user's ledger and the current schema, and nothing tested it. The suite built
 * databases by replaying every migration from nothing, which proves a CLEAN
 * INSTALL works — the case that is never in danger. What is in danger is the
 * phone that stopped at migration 4: it takes a different path through the
 * same SQL, and a statement that only works against a fresh table (a `CREATE
 * TABLE` without `IF NOT EXISTS`, a column added twice) fails there and
 * nowhere else. A failed boot migration is the user's whole history.
 *
 * These run the REAL runner — its journal ordering, its `created_at`
 * bookkeeping and its resume rule — against a real SQLite database.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import journal from "../src/db/migrations/meta/_journal.json";

const MIGRATIONS_DIR = join(process.cwd(), "src/db/migrations");

/**
 * `migrations.js` pulls its `.sql` files through `babel-plugin-inline-import`,
 * which only exists inside the app's Babel pipeline. Reading the same files
 * from disk keeps the runner under test and its input identical to what ships.
 */
const sqlFor = (tag: string): string => readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), "utf8");

let database: DatabaseSync;
/** How many journal entries the runner is allowed to see this time. */
let visibleEntries = journal.entries.length;
/** Fail after this many migration statements; the journal-table setup is excluded. */
let failAfterStatements: number | null = null;

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    execAsync: async (sql: string) => {
      if (failAfterStatements != null && !sql.includes("__drizzle_migrations")) {
        if (failAfterStatements === 0) {
          failAfterStatements = null;
          throw new Error("injected migration interruption");
        }
        failAfterStatements -= 1;
      }
      database.exec(sql);
    },
    runAsync: async (sql: string, args: unknown[] = []) => { database.prepare(sql).run(...(args as never[])); },
    getFirstAsync: async (sql: string, args: unknown[] = []) => database.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) => database.prepare(sql).all(...(args as never[])),
  }),
  withTransaction: async (fn: () => Promise<unknown>) => {
    database.exec("BEGIN");
    try {
      const result = await fn();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/migrations/migrations", () => ({
  default: {
    get journal() {
      return { ...journal, entries: journal.entries.slice(0, visibleEntries) };
    },
    migrations: Object.fromEntries(
      journal.entries.map((entry) => [`m${String(entry.idx).padStart(4, "0")}`, sqlFor(entry.tag)]),
    ),
  },
}));

const { migrateDb } = await import("../src/db/migrate");

/** Everything SQLite itself says the database is, order-independent. */
function schemaOf(db: DatabaseSync): string[] {
  return (db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL").all() as {
    type: string;
    name: string;
    sql: string;
  }[])
    .filter((row) => !row.name.startsWith("sqlite_"))
    .map((row) => `${row.type} ${row.name} :: ${row.sql.replace(/\s+/g, " ").trim()}`)
    .sort();
}

const appliedCount = (db: DatabaseSync): number =>
  (db.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count: number }).count;

describe("boot migration", () => {
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    visibleEntries = journal.entries.length;
    failAfterStatements = null;
  });

  it("has a migration file behind every journal entry", () => {
    // The runner throws "Missing migration" at boot for a journal entry with no
    // bundle — a failure the user meets as a dead app, not as a build error.
    expect(journal.entries.length).toBeGreaterThanOrEqual(9);
    for (const entry of journal.entries) expect(() => sqlFor(entry.tag)).not.toThrow();
    // Applied in `when` order, which is what the resume rule compares against.
    const times = journal.entries.map((entry) => entry.when);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("brings a fresh install to the full schema", async () => {
    await migrateDb();
    const schema = schemaOf(database);
    expect(appliedCount(database)).toBe(journal.entries.length);
    for (const table of ["transactions", "categories", "persons", "settings", "outbox", "sync_dead_letters", "investment_operations"]) {
      expect(schema.some((entry) => entry.startsWith(`table ${table} ::`)), table).toBe(true);
    }
  });

  it("lands a half-migrated install on exactly the fresh schema", async () => {
    // Every intermediate version, not just the newest one: an install can have
    // stopped at any release.
    for (let stopped = 1; stopped < journal.entries.length; stopped += 1) {
      const fresh = new DatabaseSync(":memory:");
      const upgraded = new DatabaseSync(":memory:");

      database = fresh;
      visibleEntries = journal.entries.length;
      await migrateDb();

      database = upgraded;
      visibleEntries = stopped;
      await migrateDb();
      expect(appliedCount(upgraded), `stopped at ${stopped}`).toBe(stopped);

      visibleEntries = journal.entries.length;
      await migrateDb();

      expect(schemaOf(upgraded), `install stopped at migration ${stopped}`).toEqual(schemaOf(fresh));
      expect(appliedCount(upgraded)).toBe(journal.entries.length);
    }
  });

  it("carries an existing ledger through the upgrade", async () => {
    // The whole point. A schema that matches but loses the rows is worse than
    // one that fails loudly.
    visibleEntries = 1;
    await migrateDb();
    database.prepare(
      `INSERT INTO transactions (id, user_id, type, amount_minor, currency, amount_try_minor, entry_date, effective_date, status, person_id, created_at, updated_at)
       VALUES (?, ?, 'expense', 12345, 'TRY', 12345, '2026-01-15', '2026-01-15', 'realized', 'person-1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')`,
    ).run("tx-1", "user-1");

    visibleEntries = journal.entries.length;
    await migrateDb();

    const row = database.prepare("SELECT id, amount_try_minor, effective_date FROM transactions WHERE id = ?").get("tx-1");
    expect(row).toMatchObject({ id: "tx-1", amount_try_minor: 12345, effective_date: "2026-01-15" });
  });

  it("rolls back an interrupted migration and resumes it without losing the ledger", async () => {
    visibleEntries = journal.entries.length - 1;
    await migrateDb();
    database.prepare(
      `INSERT INTO transactions (id, user_id, type, amount_minor, currency, amount_try_minor, entry_date, effective_date, status, person_id, created_at, updated_at)
       VALUES (?, ?, 'expense', 54321, 'TRY', 54321, '2026-02-15', '2026-02-15', 'realized', 'person-1', '2026-02-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z')`,
    ).run("tx-interrupted", "user-1");
    const before = schemaOf(database);

    visibleEntries = journal.entries.length;
    failAfterStatements = 1;
    await expect(migrateDb()).rejects.toThrow("injected migration interruption");
    expect(appliedCount(database)).toBe(journal.entries.length - 1);
    expect(schemaOf(database)).toEqual(before);

    await migrateDb();
    expect(appliedCount(database)).toBe(journal.entries.length);
    expect(database.prepare("SELECT amount_try_minor FROM transactions WHERE id = ?").get("tx-interrupted"))
      .toEqual({ amount_try_minor: 54321 });
  });

  it("applies nothing on a second boot", async () => {
    await migrateDb();
    const before = schemaOf(database);
    await migrateDb();
    expect(appliedCount(database)).toBe(journal.entries.length);
    expect(schemaOf(database)).toEqual(before);
  });
});
