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
import { migrationStatements } from "../helpers";

type Reply = { data: unknown; error: { message: string; code?: string } | null };

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  /** What the fake PostgREST does with each upsert, per table. */
  onUpsert: null as ((table: string, rows: Record<string, unknown>[]) => Reply | Promise<Reply>) | null,
  calls: [] as { table: string; count: number }[],
  /** How each upsert was asked for: its conflict target and what it read back. */
  upserts: [] as { options: unknown; select: unknown }[],
  rpcs: [] as string[],
  configured: true,
  platform: { OS: "ios" },
  refresh: vi.fn(async (): Promise<unknown> => ({ data: { session: { user: { id: "u" } } }, error: null })),
  diagnostics: { rows: null as unknown, options: null as unknown, error: null as { message: string } | null },
  logger: { devError: vi.fn(), devWarning: vi.fn() },
  uploadDiagnostics: vi.fn(async (..._args: unknown[]) => {}),
  reconcileAttachments: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("../../src/db/client", async () => {
  const { sqliteClientMock } = await import("../helpers");
  return sqliteClientMock(() => harness.db!);
});
vi.mock("../../src/services/logger", () => harness.logger);
vi.mock("../../src/sync/attachment-mirror", () => ({
  purgeRemoteAttachments: vi.fn(async () => {}),
  reconcileAttachments: harness.reconcileAttachments,
}));
vi.mock("../../src/services/diagnostics", () => ({ uploadDiagnostics: harness.uploadDiagnostics }));
// Screen counts ride the same success path; they are not what this file measures.
vi.mock("../../src/services/usage", () => ({ reportUsage: vi.fn(async () => {}) }));

/** A PostgREST that answers only what the engine actually asks it. */
function query(table: string) {
  let rows: Record<string, unknown>[] | null = null;
  const upsert = { options: undefined as unknown, select: undefined as unknown };
  const self: Record<string, unknown> = {
    upsert: (value: Record<string, unknown>[], options: unknown) => {
      rows = value;
      upsert.options = options;
      return self;
    },
    select: (columns: unknown) => {
      upsert.select = columns;
      return self;
    },
    order: () => self,
    limit: () => self,
    or: () => self,
    gte: () => self,
    eq: () => self,
    abortSignal: async (signal: AbortSignal) => {
      if (signal.aborted) throw new Error("aborted");
      if (rows == null) return { data: [], error: null };
      harness.calls.push({ table, count: rows.length });
      harness.upserts.push(upsert);
      // Default: the server takes everything, and echoes it back the way
      // PostgREST's `.select("*")` does after an upsert.
      return harness.onUpsert
        ? harness.onUpsert(table, rows)
        : { data: rows, error: null };
    },
  };
  return self;
}

/** The one insert the engine awaits directly: its diagnostics upload. */
const diagnosticEvents = {
  upsert: async (rows: unknown, options: unknown) => {
    harness.diagnostics.rows = rows;
    harness.diagnostics.options = options;
    return { error: harness.diagnostics.error };
  },
};

vi.mock("../../src/sync/supabase", () => ({
  getSupabase: () => harness.configured
    ? {
        from: (table: string) => (table === "diagnostic_events" ? diagnosticEvents : query(table)),
        // The change probe is absent, which the engine is required to degrade past
        // rather than fail on — so these tests exercise the push without a pull.
        rpc: (name: string) => {
          harness.rpcs.push(name);
          const answer = { data: null, error: { message: "missing", code: "PGRST202" } };
          return Object.assign(Promise.resolve(answer), { abortSignal: async () => answer });
        },
        auth: { refreshSession: harness.refresh },
      }
    : null,
}));

import { tr } from "../../src/i18n/tr";
import {
  flushOutbox,
  runSyncSessionTask,
  scheduleSync,
  startSyncSession,
  stopSyncSession,
  syncNow,
} from "../../src/sync/engine";
import { useSyncStatus } from "../../src/sync/status";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-04T09:00:00.000Z";

function queueCategory(rowId: string, fields: Record<string, unknown> = {}): void {
  const row = {
    id: rowId, user_id: USER, created_at: NOW, updated_at: NOW, deleted_at: null,
    name: "Market", kind: "expense", icon: null, color: null,
    sort_order: 0, is_column: 0, is_transfer: 0, tombstone_version: 0, ...fields,
  };
  harness.db!.prepare(
    `INSERT OR REPLACE INTO categories (id, user_id, created_at, updated_at, deleted_at, name, kind, icon, color, sort_order, is_column, is_transfer, tombstone_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rowId, USER, NOW, NOW, null, String(row.name), "expense", null, null, 0, 0, 0, 0);
  queueEvent(rowId, JSON.stringify(row));
}

function queueEvent(rowId: string, payload: string): void {
  harness.db!.prepare(
    `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("categories", rowId, "upsert", payload, `${rowId}:${Math.random()}`, NOW);
}

const outboxCount = () =>
  Number((harness.db!.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as { n: number }).n);

beforeEach(async () => {
  await stopSyncSession();
  vi.useRealTimers();
  harness.db = new DatabaseSync(":memory:");
  for (const statement of migrationStatements) harness.db.exec(statement);
  harness.onUpsert = null;
  harness.calls = [];
  harness.upserts = [];
  harness.rpcs = [];
  harness.configured = true;
  harness.platform.OS = "ios";
  harness.refresh.mockReset();
  harness.refresh.mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null });
  harness.diagnostics = { rows: null, options: null, error: null };
  harness.logger.devWarning.mockClear();
  harness.uploadDiagnostics.mockClear();
  harness.reconcileAttachments.mockClear();
  useSyncStatus.getState().set({ state: "idle", error: null, lastSyncAt: null, remoteChangeAt: null });
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

const ROW = "01a06b2c-0000-7000-8000-000000000001";
const SERVER_STAMP = "2026-09-04T09:00:05.000Z";
const localCategory = (id: string) =>
  harness.db!.prepare(`SELECT name, updated_at FROM categories WHERE id = ?`).get(id) as { name: string; updated_at: string };
const deadLetters = () =>
  harness.db!.prepare(`SELECT table_name, row_id, reason FROM sync_dead_letters ORDER BY outbox_id`).all();

describe("what an acknowledgement changes", () => {
  it("sends an id-conflict upsert, reads every column back and keeps the server's version", async () => {
    queueCategory(ROW);
    harness.onUpsert = (_table, rows) => ({ data: rows.map((row) => ({ ...row, updated_at: SERVER_STAMP })), error: null });
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(harness.upserts).toEqual([{ options: { onConflict: "id" }, select: "*" }]);
    expect(localCategory(ROW).updated_at).toBe(SERVER_STAMP);
  });

  it("does not let an acknowledgement overwrite an edit made while it was in flight", async () => {
    queueCategory(ROW);
    harness.onUpsert = (_table, rows) => {
      harness.onUpsert = () => new Promise<Reply>(() => {});
      queueCategory(ROW, { name: "Yolda düzenlendi" });
      return { data: rows.map((row) => ({ ...row, updated_at: SERVER_STAMP })), error: null };
    };
    startSyncSession(USER);

    void flushOutbox(USER);
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));

    expect(localCategory(ROW)).toEqual({ name: "Yolda düzenlendi", updated_at: NOW });
    expect(outboxCount(), "the newer edit is still waiting to be sent").toBe(1);
  });

  it("keeps the batch when the server acknowledges a row it was not sent", async () => {
    queueCategory(ROW);
    harness.onUpsert = (_table, rows) => ({ data: rows.map((row) => ({ ...row, id: "01a06b2c-0000-7000-8000-00000000000f" })), error: null });
    startSyncSession(USER);

    await flushOutbox(USER);

    expect(outboxCount()).toBe(1);
  });
});

describe("what the device refuses to send", () => {
  it("quarantines unsendable rows without asking the server, and says which", async () => {
    queueCategory(ROW, { kind: "bogus" });
    queueCategory("01a06b2c-0000-7000-8000-000000000002", { user_id: OTHER });
    queueEvent("01a06b2c-0000-7000-8000-000000000003", "{not json");
    startSyncSession(USER);

    expect(await syncNow(USER)).toBe(true);

    expect(harness.calls, "nothing sendable means no request at all").toEqual([]);
    expect(outboxCount()).toBe(0);
    expect(deadLetters()).toEqual(expect.arrayContaining([
      { table_name: "categories", row_id: ROW, reason: "invalid_row" },
      { table_name: "categories", row_id: "01a06b2c-0000-7000-8000-000000000002", reason: "wrong_user" },
      { table_name: "categories", row_id: "01a06b2c-0000-7000-8000-000000000003", reason: "malformed_payload" },
    ]));
    expect(deadLetters()).toHaveLength(3);
    expect(harness.logger.devWarning.mock.calls.filter(([scope]) => scope === "sync.quarantine").map(([, message]) => message).sort())
      .toEqual(["invalid_row categories", "malformed_payload categories", "wrong_user categories"]);
    expect(useSyncStatus.getState()).toEqual(expect.objectContaining({ state: "attention", error: tr.sync.errQuarantined }));
  });
});

describe("a completed sync", () => {
  it("records the time, purges old diagnostics, uploads the ring and mirrors attachments", async () => {
    startSyncSession(USER);

    expect(await syncNow(USER)).toBe(true);

    expect(useSyncStatus.getState()).toEqual(expect.objectContaining({ state: "idle", error: null, lastSyncAt: expect.any(String) }));
    expect(harness.rpcs).toContain("purge_expired_diagnostics");
    expect(harness.uploadDiagnostics).toHaveBeenCalledWith(expect.anything(), USER, "ios", "0");
    expect(harness.reconcileAttachments).toHaveBeenCalledWith(USER, expect.any(AbortSignal));
  });

  it("names the platform it ran on", async () => {
    startSyncSession(USER);
    for (const os of ["android", "web", "windows"]) {
      harness.platform.OS = os;
      await syncNow(USER);
    }
    expect(harness.uploadDiagnostics.mock.calls.map((call) => call[2])).toEqual(["android", "web", "web"]);
  });

  it("uploads only this account's incidents, once each, and reports a refusal", async () => {
    startSyncSession(USER);
    await syncNow(USER);
    const port = harness.uploadDiagnostics.mock.calls[0]![0] as { upload: (rows: { user_id: string }[]) => Promise<void> };

    await port.upload([{ user_id: USER }, { user_id: OTHER }]);
    expect(harness.diagnostics.rows).toEqual([{ user_id: USER }]);
    expect(harness.diagnostics.options).toEqual({ onConflict: "user_id,occurred_at,scope,code", ignoreDuplicates: true });

    harness.diagnostics.error = { message: "quota" };
    await expect(port.upload([{ user_id: USER }])).rejects.toThrow("quota");
    harness.configured = false;
    await expect(port.upload([{ user_id: USER }])).rejects.toThrow("unconfigured");
  });

  it("reports an unconfigured project as done and sends nothing", async () => {
    harness.configured = false;
    queueCategory(ROW);
    startSyncSession(USER);

    expect(await syncNow(USER)).toBe(true);
    await flushOutbox(USER);

    expect(useSyncStatus.getState().state).toBe("unconfigured");
    expect(outboxCount()).toBe(1);
  });
});

describe("a failed sync", () => {
  const refuse = (message: string) => {
    harness.onUpsert = () => ({ data: null, error: { message } });
  };

  it("names the cause in the user's terms", async () => {
    queueCategory(ROW);
    startSyncSession(USER);
    for (const [raw, shown] of [
      ["new row violates row-level security policy", tr.sync.errRls],
      ["TypeError: Failed to fetch", tr.sync.errNetwork],
      ["something else", tr.sync.errGeneric],
    ]) {
      refuse(raw!);
      expect(await syncNow(USER)).toBe(false);
      expect(useSyncStatus.getState(), raw).toEqual(expect.objectContaining({ state: "error", error: shown }));
    }
  });

  it("retries after 5 s, doubling each time up to five minutes", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    refuse("something else");
    startSyncSession(USER);
    await syncNow(USER);
    for (const wait of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
      const before = harness.calls.length;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(harness.calls.length, `not before ${wait} ms`).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(harness.calls.length, `at ${wait} ms`).toBe(before + 1);
    }
  });

  it("renews an expired token and retries at once, without a second renewal", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    let first = true;
    harness.onUpsert = (_table, rows) => {
      if (!first) return { data: rows, error: null };
      first = false;
      return { data: null, error: { message: "JWT expired" } };
    };
    startSyncSession(USER);

    expect(await syncNow(USER)).toBe(false);
    expect(useSyncStatus.getState().state).toBe("syncing");
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(outboxCount()).toBe(0);
    expect(useSyncStatus.getState().state).toBe("idle");
  });

  it("asks for a sign-in when the session cannot be renewed, and stops retrying", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    refuse("JWT expired");
    startSyncSession(USER);
    for (const reply of [
      { data: { session: null }, error: { name: "AuthApiError", message: "Invalid Refresh Token" } },
      { data: { session: null }, error: null },
    ]) {
      harness.refresh.mockResolvedValueOnce(reply);
      await syncNow(USER);
      expect(useSyncStatus.getState()).toEqual(expect.objectContaining({ state: "error", error: tr.sync.errReauth }));
    }
    const sent = harness.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(harness.calls.length).toBe(sent);
  });

  it("does not renew at all on the retry that follows a renewal", async () => {
    queueCategory(ROW);
    refuse("401 unauthorized");
    startSyncSession(USER);

    await syncNow(USER, false);

    expect(harness.refresh).not.toHaveBeenCalled();
    expect(useSyncStatus.getState().error).toBe(tr.sync.errReauth);
  });

  it("treats a renewal that never reached the server as a network failure", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    refuse("JWT expired");
    harness.refresh.mockRejectedValue(new Error("Failed to fetch"));
    startSyncSession(USER);

    await syncNow(USER);
    expect(useSyncStatus.getState()).toEqual(expect.objectContaining({ state: "error", error: tr.sync.errNetwork }));

    const sent = harness.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.calls.length).toBe(sent + 1);
  });

  it("stays quiet when the account changed while it failed", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    harness.onUpsert = () => {
      startSyncSession(OTHER);
      return { data: null, error: { message: "something else" } };
    };
    startSyncSession(USER);

    expect(await syncNow(USER)).toBe(false);

    expect(useSyncStatus.getState().state).toBe("syncing");
    const sent = harness.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(harness.calls.length).toBe(sent);
  });
});

describe("when a sync runs", () => {
  it("joins a sync already running and runs once more after it, 250 ms later", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    let release!: () => void;
    harness.onUpsert = (_table, rows) => new Promise<Reply>((resolve) => {
      release = () => resolve({ data: rows, error: null });
    });
    startSyncSession(USER);

    const first = syncNow(USER);
    while (harness.calls.length === 0) await vi.advanceTimersByTimeAsync(0);
    const joined = syncNow(USER);
    release();
    await expect(first).resolves.toBe(true);
    await expect(joined).resolves.toBe(true);

    harness.onUpsert = null;
    queueCategory(ROW, { name: "Sonra" });
    await vi.advanceTimersByTimeAsync(249);
    expect(harness.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.calls).toHaveLength(2);
  });

  it("does nothing for an account with no live session", async () => {
    queueCategory(ROW);
    expect(await syncNow(USER)).toBe(false);
    scheduleSync(USER, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(harness.calls).toEqual([]);
  });

  it("debounces scheduled syncs, 1.5 s after the last write by default", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    startSyncSession(USER);

    scheduleSync(USER);
    await vi.advanceTimersByTimeAsync(1_000);
    scheduleSync(USER);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(harness.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.calls).toHaveLength(1);
  });

  it("keeps a scheduled sync when the same account is started again, and drops it when the session stops", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    startSyncSession(USER);
    scheduleSync(USER, 100);
    startSyncSession(USER);
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.calls).toHaveLength(1);

    queueCategory(ROW, { name: "Sonra" });
    scheduleSync(USER, 100);
    await stopSyncSession(USER);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.calls).toHaveLength(1);
  });

  it("restarts the backoff for a new account", async () => {
    vi.useFakeTimers();
    queueCategory(ROW);
    harness.onUpsert = () => ({ data: null, error: { message: "something else" } });
    startSyncSession(USER);
    await syncNow(USER);
    await vi.advanceTimersByTimeAsync(5_000);

    startSyncSession(OTHER);
    harness.db!.exec("DELETE FROM outbox");
    queueCategory(ROW, { user_id: OTHER, name: "Diğer" });
    harness.db!.exec(`UPDATE categories SET user_id = '${OTHER}'`);
    await syncNow(OTHER);
    const sent = harness.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.calls.length).toBe(sent + 1);
  });

  it("waits for an in-flight sync and every session task before a session stops", async () => {
    queueCategory(ROW);
    let release!: () => void;
    harness.onUpsert = (_table, rows) => new Promise<Reply>((resolve) => {
      release = () => resolve({ data: rows, error: null });
    });
    startSyncSession(USER);
    let taskDone!: (value: string) => void;
    const task = runSyncSessionTask(USER, () => new Promise<string>((resolve) => (taskDone = resolve)));
    const sync = syncNow(USER);
    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));

    let stopped = false;
    const stop = stopSyncSession(USER).then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(stopped).toBe(false);
    release();
    await sync;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(stopped, "a session task is still running").toBe(false);
    taskDone("finished");
    await task;
    await stop;
    expect(stopped).toBe(true);
  });

  it("hands back what a session task returns", async () => {
    startSyncSession(USER);
    await expect(runSyncSessionTask(USER, async (signal) => (signal.aborted ? "aborted" : "done"))).resolves.toBe("done");
  });
});
