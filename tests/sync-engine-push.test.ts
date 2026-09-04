/**
 * The push half of the sync engine, driven for real.
 *
 * Measured before this file existed: `src/sync/engine.ts` scored 16.60 with 269
 * mutants uncovered, and NO test imported it — twenty suites replace it with
 * `vi.mock`. It is 646 lines deciding what leaves this device and what is
 * cleared from the outbox once it has left, and none of it had ever run in a
 * test.
 *
 * The stand-in is the network and nothing else: a fake PostgREST whose replies
 * the tests choose. The database is real SQLite with the real migrations, and
 * `merge-policy`, `outbound-validation`, `session-epoch` and the status store
 * are the shipped modules.
 *
 * What is asserted here is the rule the outbox exists to keep: **a row leaves
 * the outbox only when the server has said it has it, under the session that
 * sent it.** Every other case — a refusal, a short acknowledgement, a session
 * that was replaced mid-flight — must leave the work on the device, because
 * the outbox is the only record that it is unsent.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrationStatements } from "./helpers";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  /** What the fake PostgREST does with each upsert, per table. */
  onUpsert: null as ((table: string, rows: Record<string, unknown>[]) => { data: unknown; error: { message: string; code?: string } | null }) | null,
  calls: [] as { table: string; count: number }[],
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});
vi.mock("../src/services/logger", () => ({ devError: vi.fn(), devWarning: vi.fn() }));
vi.mock("../src/sync/attachment-mirror", () => ({
  purgeRemoteAttachments: vi.fn(async () => {}),
  reconcileAttachments: vi.fn(async () => {}),
}));
vi.mock("../src/services/diagnostics", () => ({ uploadDiagnostics: vi.fn(async () => {}) }));

/** A PostgREST that answers only what the engine actually asks it. */
function query(table: string) {
  let rows: Record<string, unknown>[] = [];
  const self: Record<string, unknown> = {
    upsert: (value: Record<string, unknown>[]) => {
      rows = value;
      return self;
    },
    select: () => self,
    order: () => self,
    limit: () => self,
    or: () => self,
    gte: () => self,
    eq: () => self,
    abortSignal: async (signal: AbortSignal) => {
      if (signal.aborted) throw new Error("aborted");
      if (rows.length === 0) return { data: [], error: null };
      harness.calls.push({ table, count: rows.length });
      // Default: the server takes everything, and echoes it back the way
      // PostgREST's `.select("*")` does after an upsert.
      return harness.onUpsert
        ? harness.onUpsert(table, rows)
        : { data: rows, error: null };
    },
  };
  return self;
}

vi.mock("../src/sync/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => query(table),
    // The change probe is absent, which the engine is required to degrade past
    // rather than fail on — so these tests exercise the push without a pull.
    rpc: () => ({ abortSignal: async () => ({ data: null, error: { message: "missing", code: "PGRST202" } }) }),
    auth: { refreshSession: async () => ({ data: { session: { user: { id: "u" } } }, error: null }) },
  }),
}));

import { flushOutbox, startSyncSession, stopSyncSession } from "../src/sync/engine";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-04T09:00:00.000Z";

function queueCategory(rowId: string): void {
  const row = {
    id: rowId, user_id: USER, created_at: NOW, updated_at: NOW, deleted_at: null,
    name: "Market", kind: "expense", icon: null, color: null,
    sort_order: 0, is_column: 0, is_transfer: 0, tombstone_version: 0,
  };
  harness.db!.prepare(
    `INSERT INTO categories (id, user_id, created_at, updated_at, deleted_at, name, kind, icon, color, sort_order, is_column, is_transfer, tombstone_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rowId, USER, NOW, NOW, null, "Market", "expense", null, null, 0, 0, 0, 0);
  harness.db!.prepare(
    `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("categories", rowId, "upsert", JSON.stringify(row), `${rowId}:1`, NOW);
}

const outboxCount = () =>
  Number((harness.db!.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number }).n);

beforeEach(async () => {
  await stopSyncSession();
  harness.db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) harness.db.exec(statement);
  harness.onUpsert = null;
  harness.calls = [];
});

describe("what leaves the outbox", () => {
  it("clears a row the server acknowledged", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(harness.calls).toEqual([{ table: "categories", count: 1 }]);
    expect(outboxCount(), "an acknowledged row is no longer unsent").toBe(0);
  });

  /**
   * A short acknowledgement means the server did not take every row, and the
   * engine cannot tell which. Clearing the batch anyway would drop the missing
   * one silently and for ever — the outbox is the only record it existed.
   */
  it("keeps every row when the acknowledgement is short", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    queueCategory("01a06b2c-0000-7000-8000-000000000002");
    harness.onUpsert = (_table, rows) => ({ data: rows.slice(0, 1), error: null });
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(outboxCount(), "a partial ack must not empty the batch").toBe(2);
  });

  it("keeps the work when the server refuses the push", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    harness.onUpsert = () => ({ data: null, error: { message: "permission denied" } });
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(outboxCount(), "a refused push leaves the row unsent").toBe(1);
  });

  /**
   * The session epoch, which `ARCHITECTURE.md` lists as a control that must
   * survive simplification: late work from one account must never write for
   * another. Here the reply arrives after the account has been replaced, and
   * the outbox it would have cleared belongs to the account that is gone.
   */
  it("does not clear an outbox for a session that has been replaced", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    harness.onUpsert = (_table, rows) => {
      // The account switches while PostgREST is in flight.
      startSyncSession(OTHER);
      return { data: rows, error: null };
    };
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(outboxCount(), "a stale session may not clear another account's outbox").toBe(1);
  });

  it("sends nothing at all for an account with no live session", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    // Deliberately no `startSyncSession`: a maintenance callback that outlived
    // its sign-out lands exactly here.
    await flushOutbox(USER);

    expect(harness.calls, "a signed-out account must not reach the network").toEqual([]);
    expect(outboxCount()).toBe(1);
  });

  it("sends nothing for an account other than the live one", async () => {
    queueCategory("01a06b2c-0000-7000-8000-000000000001");
    startSyncSession(OTHER);

    await flushOutbox(USER);

    expect(harness.calls).toEqual([]);
    expect(outboxCount()).toBe(1);
  });
});
