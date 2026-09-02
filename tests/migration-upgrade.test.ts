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
import { existsSync, readFileSync } from "node:fs";
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

/** The migration whose data repair the retirement test exercises. */
const RETIREMENT_TAG = "0010_retire_legacy_expected_payments";
/** The migration whose token rewrite the mark test exercises. */
const MARK_SLOTS_TAG = "0012_matrix_color_slots";

/**
 * How many statements the runner will execute for one migration.
 *
 * Derived, never written down: the interruption test has to fail inside the
 * LAST migration, and a hard-coded count silently stops interrupting anything
 * the moment a one-statement migration is added after it — which is exactly
 * how this suite quietly stopped exercising 0010.
 */
const statementCount = (tag: string): number => sqlFor(tag).split("--> statement-breakpoint").length;

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
    for (const entry of journal.entries) expect(sqlFor(entry.tag).trim().length, entry.tag).toBeGreaterThan(0);
    // Applied in `when` order, which is what the resume rule compares against.
    const times = journal.entries.map((entry) => entry.when);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("keeps a meta snapshot for exactly the migrations that move the schema", () => {
    // `meta/NNNN_snapshot.json` is drizzle-kit's record of the schema AFTER a
    // migration, and `generate` diffs `schema.ts` against the newest one. A
    // data-only migration moves no schema, so drizzle writes no snapshot and
    // the previous one stays current — 0010 and 0012 are both pure `UPDATE`.
    //
    // This is asserted because the gap reads like a defect: the journal has 13
    // entries and `meta/` has 11 snapshots, and an audit has already raised
    // that as a broken folder once. The rule is snapshot-iff-DDL, so state it
    // where it can fail rather than explaining it again in prose.
    for (const entry of journal.entries) {
      const movesSchema = /^\s*(CREATE|ALTER|DROP)\b/im.test(sqlFor(entry.tag));
      const snapshot = join(MIGRATIONS_DIR, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
      expect(existsSync(snapshot), `${entry.tag} ${movesSchema ? "moves" : "does not move"} the schema`).toBe(movesSchema);
    }
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

  it("retires a legacy installment expected row without deleting its tombstone", async () => {
    // Pinned to the migration under test rather than to "the last one": with
    // `length - 1` this silently stopped exercising 0010 the moment 0011 was
    // added, and still passed everything except its own assertion.
    const retirement = journal.entries.findIndex((entry) => entry.tag === RETIREMENT_TAG);
    expect(retirement, `${RETIREMENT_TAG} is missing from the journal`).toBeGreaterThan(-1);
    visibleEntries = retirement;
    await migrateDb();
    database.prepare(
      `INSERT INTO expected_payments (
        id, user_id, created_at, updated_at, deleted_at, tombstone_version,
        direction, kind, ref_id, due_date, amount_minor, amount_is_estimated,
        currency, status, paid_at, auto_confirmed, transaction_id
      ) VALUES (?, ?, ?, ?, NULL, 0, 'out', 'installment', ?, ?, ?, 0, 'TRY', 'pending', NULL, 0, NULL)`,
    ).run(
      "legacy-expected",
      "user-1",
      "2026-08-10T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "plan-1",
      "2026-08-15",
      10_000,
    );

    visibleEntries = retirement + 1;
    await migrateDb();

    expect(database.prepare(
      "SELECT deleted_at IS NOT NULL AS deleted, tombstone_version FROM expected_payments WHERE id = ?",
    ).get("legacy-expected")).toMatchObject({ deleted: 1, tombstone_version: 1 });
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
    // Interrupt the final statement of the final migration, whatever shape it
    // has: a multi-statement migration proves a partial application is rolled
    // back, and a single-statement one proves the entry is not recorded.
    const lastTag = journal.entries.at(-1)!.tag;
    failAfterStatements = statementCount(lastTag) - 1;
    await expect(migrateDb()).rejects.toThrow("injected migration interruption");
    expect(appliedCount(database)).toBe(journal.entries.length - 1);
    expect(schemaOf(database)).toEqual(before);

    await migrateDb();
    expect(appliedCount(database)).toBe(journal.entries.length);
    expect(database.prepare("SELECT amount_try_minor FROM transactions WHERE id = ?").get("tx-interrupted"))
      .toEqual({ amount_try_minor: 54321 });
  });

  /**
   * A mark the owner made is invisible once its token stops resolving, so the
   * rename of the five meaning-named slots has to rewrite what is already
   * stored rather than leave it to be filtered out on read.
   */
  it("carries every retired mark slot onto its hue", async () => {
    const slots = journal.entries.findIndex((entry) => entry.tag === MARK_SLOTS_TAG);
    expect(slots, `${MARK_SLOTS_TAG} must be in the journal`).toBeGreaterThan(0);
    visibleEntries = slots;
    await migrateDb();

    const legacy = [
      ["m-critical", "critical", "red"],
      ["m-warning", "warning", "orange"],
      ["m-neutral", "neutral", "yellow"],
      ["m-info", "info", "yellow"],
      ["m-success", "success", "green"],
    ] as const;
    for (const [id, token] of legacy) {
      database.prepare(
        `INSERT INTO matrix_colors (id, user_id, scope, item_key, month, token, created_at, updated_at)
         VALUES (?, 'user-1', 'cell', 'cat-1', '2026-08', ?, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      ).run(id, token);
    }

    visibleEntries = slots + 1;
    await migrateDb();

    for (const [id, , expected] of legacy) {
      expect(
        database.prepare("SELECT token, updated_at FROM matrix_colors WHERE id = ?").get(id),
        `${id} keeps its mark`,
      ).toEqual({ token: expected, updated_at: "2026-08-01T00:00:00.000Z" });
    }
  });

  it("applies nothing on a second boot", async () => {
    await migrateDb();
    const before = schemaOf(database);
    await migrateDb();
    expect(appliedCount(database)).toBe(journal.entries.length);
    expect(schemaOf(database)).toEqual(before);
  });
});
