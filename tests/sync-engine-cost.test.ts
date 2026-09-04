/**
 * What one page of sync COSTS the local database.
 *
 * Every other sync suite asks whether the right rows arrive. This one asks how
 * many statements it took, because the answer was "one per row" in both
 * directions and nothing said so: a page is 1000 rows on the way in and a
 * batch 200 on the way out, and each row was preceded by its own point read.
 * On web that read is a postMessage round trip to the SQLite worker, so a first
 * sync of a real ledger spent most of its time waiting on the bridge rather
 * than on Postgres.
 *
 * The assertions are written as a per-page BOUND rather than an exact count, so
 * they survive an extra statement that does not scale with the page — and fail
 * the moment a lookup moves back inside the row loop.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { migrationStatements } from "./helpers";

const USER = "11111111-1111-4111-8111-111111111111";
const TS = "2026-09-03T10:00:00.000Z";

let db: DatabaseSync | null = null;
/** Every statement the engine sent, in order. */
let statements: string[] = [];

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.1.0" } } }));
vi.mock("../src/services/logger", () => ({ devWarning: vi.fn(), devError: vi.fn() }));
vi.mock("../src/services/diagnostics", () => ({ uploadDiagnostics: vi.fn(async () => {}) }));
vi.mock("../src/sync/attachment-mirror", () => ({
  reconcileAttachments: vi.fn(async () => {}),
  purgeRemoteAttachments: vi.fn(async () => {}),
}));

/** The client mock from `helpers`, plus a record of the SQL it was given. */
vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) => {
      statements.push(sql);
      return db!.prepare(sql).get(...(args as never[])) ?? null;
    },
    getAllAsync: async (sql: string, args: unknown[] = []) => {
      statements.push(sql);
      return db!.prepare(sql).all(...(args as never[]));
    },
    runAsync: async (sql: string, args: unknown[] = []) => {
      statements.push(sql);
      return { changes: Number(db!.prepare(sql).run(...(args as never[])).changes) };
    },
  }),
  withTransaction: async (task: () => Promise<void>) => {
    db!.exec("BEGIN");
    try {
      await task();
      db!.exec("COMMIT");
    } catch (error) {
      db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

const PAGE = 40;

function uuid(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`;
}

/** One page of `persons`, then nothing, so the pull terminates. */
function personPage(): Record<string, unknown>[] {
  return Array.from({ length: PAGE }, (_, index) => ({
    id: uuid(index),
    user_id: USER,
    created_at: TS,
    updated_at: TS,
    deleted_at: null,
    name: `Kişi ${index}`,
    is_self: index === 0,
    tombstone_version: 0,
  }));
}

let served = false;

function pullBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "or", "gte"]) builder[method] = () => builder;
  builder.abortSignal = async () => {
    if (table !== "persons" || served) return { data: [], error: null };
    served = true;
    return { data: personPage(), error: null };
  };
  return builder;
}

const client = {
  from: (table: string) => ({
    ...pullBuilder(table),
    upsert: (rows: Record<string, unknown>[]) => ({
      select: () => ({ abortSignal: async () => ({ data: rows, error: null }) }),
    }),
  }),
  rpc: () => {
    const answer = { data: [], error: null };
    return Object.assign(Promise.resolve(answer), { abortSignal: async () => answer });
  },
  auth: { refreshSession: async () => ({ data: { session: null }, error: null }) },
};
vi.mock("../src/sync/supabase", () => ({ getSupabase: () => client }));

async function engine() {
  vi.resetModules();
  return import("../src/sync/engine");
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) db.exec(statement);
  statements = [];
  served = false;
});

afterEach(() => {
  db?.close();
  db = null;
});

/** Statements whose text contains `needle`, counted. */
function count(needle: string): number {
  return statements.filter((sql) => sql.replace(/\s+/g, " ").includes(needle)).length;
}

describe("what a pull page costs", () => {
  it("reads the local side of a page in a bounded number of statements", async () => {
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(true);

    // The rows did arrive: the bound below is worthless if the merge did nothing.
    expect(db!.prepare("SELECT COUNT(*) AS n FROM persons").get()).toEqual({ n: PAGE });
    // The LWW comparison needs the local `updated_at`/`tombstone_version` for
    // every id on the page. That is ONE read of the page, not one per row.
    expect(count("tombstone_version FROM persons")).toBeLessThanOrEqual(2);
  });
});

describe("what a push batch costs", () => {
  it("finds the newest outbox event per row in a bounded number of statements", async () => {
    const now = new Date().toISOString();
    for (let index = 0; index < PAGE; index += 1) {
      db!.prepare(
        `INSERT INTO persons (id, user_id, created_at, updated_at, deleted_at, name, is_self)
         VALUES (?, ?, ?, ?, NULL, ?, 0)`,
      ).run(uuid(index), USER, now, now, `Kişi ${index}`);
      db!.prepare(
        `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES ('persons', ?, 'upsert', ?, ?, ?)`,
      ).run(
        uuid(index),
        JSON.stringify({
          id: uuid(index),
          user_id: USER,
          created_at: now,
          updated_at: now,
          deleted_at: null,
          name: `Kişi ${index}`,
          is_self: 0,
          tombstone_version: 0,
        }),
        `key-${index}`,
        now,
      );
    }

    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(true);

    // The outbox emptied, so the acknowledgement really was applied.
    expect(db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
    expect(count("FROM outbox WHERE table_name = ? AND row_id")).toBeLessThanOrEqual(2);
  });
});
