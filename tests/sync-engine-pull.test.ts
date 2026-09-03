/**
 * The pull ORCHESTRATION, driven through the real engine.
 *
 * `tests/multi-client-sync.test.ts` proves the sync POLICIES — the merge, the
 * acknowledgement, the tombstone generation — against real SQLite and a
 * PostgREST stand-in. It does not load `src/sync/engine.ts`, and neither did
 * anything else: every suite that touches the engine replaces it with
 * `vi.mock`, which is why its mutation baseline is 0.00 with 470 mutants
 * uncovered. `.claude/rules/mutation-gate.md` names the missing harness as the
 * fix and this is it, one layer up from the policies.
 *
 * What it is here to catch is one decision. The change probe lets a sync skip a
 * table whose server head the device already holds, and the failure mode of a
 * skip is silence: no error, no retry, just rows that never arrive. So every
 * case below is written from the same question — when may a table be skipped,
 * and does anything other than "the device is provably current" ever skip one.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { migrationStatements, sqliteClientMock } from "./helpers";

const USER = "11111111-1111-4111-8111-111111111111";

let db: DatabaseSync | null = null;

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.1.0" } } }));
vi.mock("../src/db/client", () => sqliteClientMock(() => db!));
vi.mock("../src/services/logger", () => ({ devWarning: vi.fn(), devError: vi.fn() }));
vi.mock("../src/services/diagnostics", () => ({ uploadDiagnostics: vi.fn(async () => {}) }));
vi.mock("../src/sync/attachment-mirror", () => ({
  reconcileAttachments: vi.fn(async () => {}),
  purgeRemoteAttachments: vi.fn(async () => {}),
}));

/** Tables the fake server was asked to read, in the order it was asked. */
let pulled: string[] = [];
/** What `sync_cursors()` answers, or an error to answer with. */
let heads: { table_name: string; max_updated_at: string | null; max_id: string | null }[] = [];
let headsError: { code?: string; message: string } | null = null;
let rpcCalls: string[] = [];

/** A builder that records the read and returns no rows, so a pull is visible
 *  without also exercising the merge that `multi-client-sync` already covers. */
function pullBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "or", "gte"]) {
    builder[method] = () => builder;
  }
  builder.abortSignal = async () => {
    pulled.push(table);
    return { data: [], error: null };
  };
  return builder;
}

const client = {
  from: (table: string) => ({
    ...pullBuilder(table),
    upsert: () => ({ select: () => ({ abortSignal: async () => ({ data: [], error: null }) }) }),
  }),
  rpc: (name: string) => {
    rpcCalls.push(name);
    const answer = name === "sync_cursors"
      ? { data: headsError ? null : heads, error: headsError }
      : { data: null, error: null };
    // Both shapes the engine uses: awaited directly, or after `.abortSignal`.
    return Object.assign(Promise.resolve(answer), { abortSignal: async () => answer });
  },
  auth: { refreshSession: async () => ({ data: { session: null }, error: null }) },
};
vi.mock("../src/sync/supabase", () => ({ getSupabase: () => client }));

/** A fresh engine per test: it holds the epoch and the probe flag in module state. */
async function engine() {
  vi.resetModules();
  return import("../src/sync/engine");
}

/** Put a table's cursor where a device that has already pulled would have it. */
function setCursor(table: string, ts: string, id: string): void {
  db!.prepare(
    `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
     ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
  ).run(table, `${ts}|${id}`);
}

const TS = "2026-09-03T10:00:00.000Z";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) db.exec(statement);
  pulled = [];
  rpcCalls = [];
  heads = [];
  headsError = null;
});

afterEach(() => {
  db?.close();
  db = null;
});

describe("when the change probe is consulted at all", () => {
  it("does not ask on a workspace that has never pulled, and reads every table", async () => {
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(true);

    // Nothing to skip means the probe could only add a round trip.
    expect(rpcCalls).not.toContain("sync_cursors");
    expect(pulled).toHaveLength(21);
  });

  it("asks once, not once per table, as soon as any cursor has moved", async () => {
    setCursor("transactions", TS, ID);
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(rpcCalls.filter((name) => name === "sync_cursors")).toHaveLength(1);
  });
});

describe("which tables a probe answer may skip", () => {
  it("skips only the tables whose head this device already holds", async () => {
    setCursor("transactions", TS, ID);
    setCursor("categories", TS, ID);
    heads = [
      { table_name: "transactions", max_updated_at: TS, max_id: ID },
      // Categories moved on the server since this device last looked.
      { table_name: "categories", max_updated_at: TS, max_id: OTHER_ID },
    ];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(pulled).toContain("categories");
    expect(pulled).not.toContain("transactions");
  });

  it("skips a table the server reports as empty", async () => {
    setCursor("transactions", TS, ID);
    heads = [{ table_name: "transactions", max_updated_at: null, max_id: null }];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(pulled).not.toContain("transactions");
  });

  it("pulls a table the answer does not mention, because the list can fall behind", async () => {
    setCursor("transactions", TS, ID);
    // A server function whose table list predates a new table must not cause
    // that table to be silently skipped forever.
    heads = [{ table_name: "transactions", max_updated_at: TS, max_id: ID }];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(pulled).not.toContain("transactions");
    expect(pulled).toContain("attachments");
    expect(pulled).toContain("settings");
  });

  it("pulls a table whose reported head is malformed rather than trusting it", async () => {
    setCursor("transactions", TS, ID);
    setCursor("settings", TS, ID);
    heads = [
      { table_name: "transactions", max_updated_at: TS, max_id: "not-a-uuid" },
      { table_name: "settings", max_updated_at: null, max_id: ID },
    ];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(pulled).toContain("transactions");
    expect(pulled).toContain("settings");
  });

  it("keeps the declaration order, which is the order foreign keys allow", async () => {
    setCursor("transactions", TS, ID);
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    // Parents before children: a category before the transaction naming it.
    expect(pulled.indexOf("categories")).toBeLessThan(pulled.indexOf("transactions"));
    expect(pulled.indexOf("persons")).toBeLessThan(pulled.indexOf("categories"));
  });
});

describe("when the probe cannot be trusted", () => {
  it("pulls every table when the function is not applied, and stops asking", async () => {
    setCursor("transactions", TS, ID);
    headsError = { code: "PGRST202", message: "Could not find the function" };
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);
    expect(pulled).toHaveLength(21);

    // A migration that is not applied does not become a round trip per sync.
    pulled = [];
    rpcCalls = [];
    await syncNow(USER, false);
    expect(rpcCalls).not.toContain("sync_cursors");
    expect(pulled).toHaveLength(21);
  });

  it("fails the sync on any other error instead of skipping tables", async () => {
    setCursor("transactions", TS, ID);
    // An expired JWT must reach the retry and refresh path. Degrading quietly
    // here would turn an auth failure into a workspace that stops updating.
    headsError = { code: "PGRST301", message: "JWT expired" };
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(false);
    expect(pulled).toHaveLength(0);
  });
});
