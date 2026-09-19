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
const logger = vi.hoisted(() => ({ devWarning: vi.fn(), devError: vi.fn() }));
vi.mock("../src/services/logger", () => logger);
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

/** Rows the fake server holds, per table. Empty unless a case puts some there. */
let server: Record<string, Record<string, unknown>[]> = {};
let pullError: { message: string } | null = null;
/** Every builder call of every read, so a case can check what was asked. */
let reads: { table: string; calls: unknown[][] }[] = [];

const KEYSET = /^updated_at\.gt\.(.+),and\(updated_at\.eq\.(.+),id\.gt\.(.+)\)$/;
// A row whose timestamp cannot be read is always served: it is what the
// refusal cases hand the engine, and a real filter could not rank it either.
const at = (row: Record<string, unknown>) => Date.parse(String(row.updated_at));
const unranked = (row: Record<string, unknown>) => !Number.isFinite(at(row));

/**
 * A builder that answers the way PostgREST does for the calls it was given:
 * the keyset filter, `(updated_at, id)` order and page limit are applied as
 * asked, so a wrong argument yields a wrong page rather than passing unseen.
 */
function pullBuilder(table: string) {
  const calls: unknown[][] = [];
  reads.push({ table, calls });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "or", "gte"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.abortSignal = async () => {
    pulled.push(table);
    if (pullError) return { data: null, error: pullError };
    let rows = [...(server[table] ?? [])];
    for (const [method, ...args] of calls) {
      if (method === "gte") rows = rows.filter((row) => unranked(row) || at(row) >= Date.parse(String(args[1])));
      if (method === "or") {
        const keyset = KEYSET.exec(String(args[0]));
        if (!keyset) throw new Error(`unreadable filter ${String(args[0])}`);
        const [, gt, eq, id] = keyset;
        rows = rows.filter((row) => unranked(row)
          || at(row) > Date.parse(gt!) || (at(row) === Date.parse(eq!) && String(row.id) > id!));
      }
    }
    const ordered = calls.filter(([method]) => method === "order").map(([, column, options]) =>
      `${String(column)}:${(options as { ascending?: boolean } | undefined)?.ascending}`);
    if (ordered.join(",") === "updated_at:true,id:true") {
      rows.sort((a, b) => at(a) - at(b) || String(a.id).localeCompare(String(b.id)));
    }
    const limit = calls.find(([method]) => method === "limit")?.[1];
    return { data: rows.slice(0, Number(limit)), error: null };
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
  const module = await import("../src/sync/engine");
  // The status store the fresh engine reports to, not a copy from before the reset.
  const { useSyncStatus } = await import("../src/sync/status");
  return { ...module, useSyncStatus };
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
  server = {};
  pullError = null;
  reads = [];
  logger.devError.mockClear();
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
    expect(pulled).toHaveLength(22);
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
    expect(pulled).toHaveLength(22);

    // A migration that is not applied does not become a round trip per sync.
    pulled = [];
    rpcCalls = [];
    await syncNow(USER, false);
    expect(rpcCalls).not.toContain("sync_cursors");
    expect(pulled).toHaveLength(22);
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
    expect(logger.devError).toHaveBeenCalledWith("sync", "pull probe: JWT expired");
  });
});

/** A category exactly as PostgREST returns it: real booleans, offset timestamps. */
function serverCategory(id: string, updatedAt: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, user_id: USER, created_at: "2026-09-01T10:00:00+00:00", updated_at: updatedAt, deleted_at: null,
    tombstone_version: 0, name: "Market", kind: "expense", icon: null, color: null,
    sort_order: 0, is_column: true, is_transfer: false, ...fields,
  };
}

function localCategory(id: string, updatedAt: string, fields: Record<string, unknown> = {}): void {
  const row = {
    id, user_id: USER, created_at: "2026-09-01T10:00:00.000Z", updated_at: updatedAt, deleted_at: null,
    tombstone_version: 0, name: "Yerel", kind: "expense", icon: null, color: null,
    sort_order: 0, is_column: 0, is_transfer: 0, ...fields,
  };
  const columns = Object.keys(row);
  db!.prepare(`INSERT INTO categories (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...(Object.values(row) as never[]));
}

const category = (id: string) =>
  db!.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Record<string, unknown> | undefined;
const cursorOf = (table: string) =>
  (db!.prepare("SELECT last_pulled_at FROM sync_state WHERE table_name = ?").get(table) as { last_pulled_at: string } | undefined)
    ?.last_pulled_at;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("what a pulled page writes", () => {
  it("stores a server row in this device's shapes and advances the keyset cursor", async () => {
    server.categories = [serverCategory(ID, "2026-09-03T10:00:00+00:00", {
      deleted_at: "2026-09-03T09:00:00+00:00",
      tombstone_version: 1,
      a_column_this_client_lacks: "ignored",
    })];
    server.fx_rates = [{
      id: OTHER_ID, user_id: USER, created_at: TS, updated_at: TS, deleted_at: null, tombstone_version: 0,
      currency: "USD", rate_date: "2026-09-03", rate_try: 40.5,
    }];
    server.computed_columns = [
      { id: uuid(1), user_id: USER, created_at: TS, updated_at: TS, deleted_at: null, tombstone_version: 0,
        name: "Net", definition: { op: "income_minus_expense" }, sort_order: 0 },
      { id: uuid(2), user_id: USER, created_at: TS, updated_at: TS, deleted_at: null, tombstone_version: 0,
        name: "Net 2", definition: "{\"op\":\"income_minus_expense\"}", sort_order: 1 },
    ];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(true);

    expect(category(ID)).toEqual(expect.objectContaining({
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-03T10:00:00.000Z",
      deleted_at: "2026-09-03T09:00:00.000Z",
      is_column: 1,
      is_transfer: 0,
      tombstone_version: 1,
    }));
    expect(db!.prepare("SELECT rate_try FROM fx_rates").get()).toEqual({ rate_try: "40.5" });
    expect(db!.prepare("SELECT definition FROM computed_columns ORDER BY sort_order").all()).toEqual([
      { definition: "{\"op\":\"income_minus_expense\"}" },
      { definition: "{\"op\":\"income_minus_expense\"}" },
    ]);
    expect(cursorOf("categories")).toBe(`2026-09-03T10:00:00.000Z|${ID}`);
    expect(reads.find((read) => read.table === "categories")?.calls).toEqual([
      ["select", "*"],
      ["order", "updated_at", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["limit", 1000],
      ["gte", "updated_at", "1970-01-01T00:00:00.000Z"],
    ]);
  });

  it("resumes after the cursor, and replays a legacy cursor's own timestamp once", async () => {
    setCursor("categories", TS, ID);
    db!.prepare("INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)").run("persons", TS);
    server.categories = [serverCategory(ID, TS), serverCategory(OTHER_ID, TS)];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(reads.find((read) => read.table === "categories")?.calls).toContainEqual(
      ["or", `updated_at.gt.${TS},and(updated_at.eq.${TS},id.gt.${ID})`],
    );
    expect(reads.find((read) => read.table === "persons")?.calls).toContainEqual(["gte", "updated_at", TS]);
    expect(category(ID), "the row the cursor already names is not fetched again").toBeUndefined();
    expect(category(OTHER_ID)).toBeDefined();
  });

  it("keeps a column the server did not send", async () => {
    localCategory(ID, "2026-09-02T10:00:00.000Z", { is_transfer: 1 });
    const sent = serverCategory(ID, TS, { name: "Sunucu" });
    delete sent.is_transfer;
    server.categories = [sent];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(category(ID)).toEqual(expect.objectContaining({ name: "Sunucu", is_transfer: 1 }));
  });

  it("pages through a table a thousand rows at a time, never trusting a partial local snapshot", async () => {
    // The last row of the first page is newer here than on the server: a merge
    // that lost part of the page's local state would overwrite it.
    localCategory(uuid(999), "2026-09-05T00:00:00.000Z");
    server.categories = Array.from({ length: 1001 }, (_, n) =>
      serverCategory(uuid(n), `2026-09-03T10:00:${String(Math.floor(n / 100)).padStart(2, "0")}+00:00`, { sort_order: n }));
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(true);

    expect(reads.filter((read) => read.table === "categories")).toHaveLength(2);
    expect(db!.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 1001 });
    expect(category(uuid(999))?.name).toBe("Yerel");
    expect(cursorOf("categories")).toBe(`2026-09-03T10:00:10.000Z|${uuid(1000)}`);
  });

  it("stops after a short page", async () => {
    server.categories = Array.from({ length: 999 }, (_, n) => serverCategory(uuid(n), TS));
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(reads.filter((read) => read.table === "categories")).toHaveLength(1);
  });
});

describe("which pulled rows win", () => {
  it("replaces an older local row and says so, but not a newer one or a later delete generation", async () => {
    localCategory(ID, "2026-09-02T10:00:00.000Z");
    localCategory(OTHER_ID, "2026-09-05T10:00:00.000Z");
    localCategory(uuid(3), "2026-09-01T10:00:00.000Z", { deleted_at: "2026-09-01T10:00:00.000Z", tombstone_version: 2 });
    server.categories = [
      serverCategory(ID, TS, { name: "Sunucu" }),
      serverCategory(OTHER_ID, TS, { name: "Eski" }),
      serverCategory(uuid(3), TS, { name: "Diriltilmiş", deleted_at: "2026-09-01T00:00:00+00:00", tombstone_version: 1 }),
    ];
    const { startSyncSession, syncNow, useSyncStatus } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(category(ID)?.name).toBe("Sunucu");
    expect(category(OTHER_ID)?.name).toBe("Yerel");
    expect(category(uuid(3))).toEqual(expect.objectContaining({ name: "Yerel", tombstone_version: 2 }));
    expect(useSyncStatus.getState().remoteChangeAt).not.toBeNull();
  });

  it("announces nothing when a pull only adds rows this device never had", async () => {
    server.categories = [serverCategory(ID, TS)];
    const { startSyncSession, syncNow, useSyncStatus } = await engine();
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(category(ID)).toBeDefined();
    expect(useSyncStatus.getState().remoteChangeAt).toBeNull();
  });
});

describe("a page the device refuses", () => {
  const refusals: [string, Record<string, unknown>, string][] = [
    ["an id that is not a UUID", { id: "row-1" }, "invalid server row"],
    ["another account's row", { user_id: "22222222-2222-4222-8222-222222222222" }, "invalid server row"],
    ["a timestamp that is not text", { updated_at: 1_788_000_000_000 }, "invalid server row"],
    ["a timestamp nobody can read", { updated_at: "soon" }, "invalid server row"],
    ["a fractional delete generation", { tombstone_version: 1.5 }, "invalid server row"],
    ["a negative delete generation", { tombstone_version: -1 }, "invalid server row"],
    ["an unreadable creation time", { created_at: "garbage" }, "invalid server data"],
    ["a row the schema forbids", { kind: "income", is_transfer: true }, "invalid server data"],
  ];

  for (const [label, fields, reason] of refusals) {
    it(`fails the sync on ${label}, merging nothing and keeping the cursor`, async () => {
      server.categories = [serverCategory(OTHER_ID, TS), serverCategory(ID, TS, fields)];
      const { startSyncSession, syncNow } = await engine();
      startSyncSession(USER);

      expect(await syncNow(USER, false)).toBe(false);

      expect(logger.devError).toHaveBeenCalledWith("sync", `pull categories: ${reason}`);
      expect(category(OTHER_ID)).toBeUndefined();
      expect(cursorOf("categories")).toBeUndefined();
    });
  }

  it("refuses to overwrite a local row another account owns", async () => {
    localCategory(ID, "2026-09-01T10:00:00.000Z", { user_id: "22222222-2222-4222-8222-222222222222" });
    server.categories = [serverCategory(ID, TS)];
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(false);
    expect(logger.devError).toHaveBeenCalledWith("sync", "pull categories: local ownership conflict");
  });

  it("fails the sync when the server refuses a read", async () => {
    pullError = { message: "permission denied for table categories" };
    const { startSyncSession, syncNow } = await engine();
    startSyncSession(USER);

    expect(await syncNow(USER, false)).toBe(false);
    expect(logger.devError).toHaveBeenCalledWith("sync", "pull persons: permission denied for table categories");
  });
});

