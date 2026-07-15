/**
 * Outbox sync engine (spec §2.2): push → pull → merge, single instance,
 * last-write-wins on server-normalized `updated_at`. Errors surface in the
 * status store (never swallowed) and retry with exponential backoff.
 */

import { getTableColumns } from "drizzle-orm";
import { getSqliteAsync, withTransaction } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { getSupabase } from "./supabase";
import { useSyncStatus } from "./status";
import { tr } from "../i18n/tr";
import { SessionEpoch, SessionEpochCancelledError, type SessionEpochToken } from "./session-epoch";

const isAuthError = (raw: string) => /jwt|token|401|unauthorized|not authenticated/i.test(raw);

/** Map a raw PostgREST/network error to a short, friendly Turkish message. */
function friendlySyncError(raw: string): string {
  if (/row-level security|violates row-level|permission denied/i.test(raw)) return tr.sync.errRls;
  if (isAuthError(raw)) return tr.sync.errAuth;
  if (/network|fetch|failed to fetch|timeout|offline/i.test(raw)) return tr.sync.errNetwork;
  return tr.sync.errGeneric;
}

/**
 * Silently renew the access token. An expired JWT is the common cause of sync
 * 401s (autoRefresh can lag after the app was backgrounded); refreshing and
 * retrying recovers without ever asking the user to sign out and back in.
 */
async function tryRefreshSession(): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && !!data.session;
  } catch {
    return false;
  }
}

const PULL_PAGE = 1000;
const PUSH_BATCH = 200;

/** Columns needing type coercion between SQLite and Postgres. */
const JSONB_COLUMNS: Record<string, Set<string>> = { computed_columns: new Set(["definition"]) };
const NUMERIC_COLUMNS: Record<string, Set<string>> = {
  transactions: new Set(["fx_rate"]),
  fx_rates: new Set(["rate_try"]),
};

function booleanColumnsOf(table: SyncedTableName): Set<string> {
  const set = new Set<string>();
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    if (column.columnType === "SQLiteBoolean") set.add(column.name);
  }
  return set;
}

const BOOLEAN_COLUMNS = new Map<SyncedTableName, Set<string>>();
for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
  BOOLEAN_COLUMNS.set(table, booleanColumnsOf(table));
}

/** The known local columns of each table, used to reject anything the server
 *  sends that this client's schema doesn't have (defense-in-depth + forward
 *  compat: a new server column can't inject SQL or crash the pull merge). */
const KNOWN_COLUMNS = new Map<SyncedTableName, Set<string>>();
for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
  KNOWN_COLUMNS.set(table, new Set(Object.values(getTableColumns(SYNCED_TABLES[table])).map((c) => c.name)));
}

/** SQLite payload → PostgREST payload. */
function toRemote(table: SyncedTableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const col of BOOLEAN_COLUMNS.get(table)!) {
    if (col in out && out[col] !== null) out[col] = Boolean(out[col]);
  }
  for (const col of JSONB_COLUMNS[table] ?? []) {
    if (typeof out[col] === "string") out[col] = JSON.parse(out[col] as string);
  }
  for (const col of NUMERIC_COLUMNS[table] ?? []) {
    if (out[col] != null) out[col] = Number(out[col]);
  }
  return out;
}

/** PostgREST row → SQLite-storable row (canonical ISO timestamps for LWW). */
function toLocal(table: SyncedTableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of ["created_at", "updated_at", "deleted_at", "paid_at", "canceled_at"]) {
    if (out[key]) {
      // Guard against an unparseable server timestamp: `new Date(bad)
      // .toISOString()` throws, which would fail the whole pull into a retry
      // loop. Keep the raw value instead — the LWW compare then skips the row.
      const parsed = Date.parse(out[key] as string);
      if (Number.isFinite(parsed)) out[key] = new Date(parsed).toISOString();
    }
  }
  for (const col of BOOLEAN_COLUMNS.get(table)!) {
    if (col in out && out[col] !== null) out[col] = out[col] ? 1 : 0;
  }
  for (const col of JSONB_COLUMNS[table] ?? []) {
    if (out[col] != null && typeof out[col] !== "string") out[col] = JSON.stringify(out[col]);
  }
  for (const col of NUMERIC_COLUMNS[table] ?? []) {
    if (out[col] != null) out[col] = String(out[col]);
  }
  return out;
}

const sessionEpoch = new SessionEpoch();

function assertActive(token: SessionEpochToken): void {
  sessionEpoch.assertCurrent(token);
}

async function pushOutbox(userId: string, token: SessionEpochToken): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  // Push per table in FK-safe declaration order, oldest events first.
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    for (;;) {
      assertActive(token);
      const events = await sqlite.getAllAsync<{ id: number; payload: string; row_id: string }>(
        `SELECT id, payload, row_id FROM outbox WHERE table_name = ? ORDER BY id ASC LIMIT ${PUSH_BATCH}`,
        [table] as never[],
      );
      if (events.length === 0) break;
      // Keep only the newest event per row (idempotent upserts), and drop any
      // row that belongs to another account — it can never pass RLS under this
      // session, so pushing it would fail the whole batch.
      const latestByRow = new Map<string, { id: number; payload: string }>();
      for (const e of events) {
        try {
          if ((JSON.parse(e.payload) as { user_id?: string }).user_id === userId) latestByRow.set(e.row_id, e);
        } catch {
          /* skip malformed payloads */
        }
      }
      const rows = [...latestByRow.values()].map((e) => toRemote(table, JSON.parse(e.payload)));
      if (rows.length > 0) {
        assertActive(token);
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" }).abortSignal(token.signal);
        if (error) throw new Error(`push ${table}: ${error.message}`);
      }
      // A sign-out/account switch may have happened while PostgREST was in
      // flight. Never clear the local outbox for a stale session response.
      assertActive(token);
      // Clear the whole batch (own rows pushed, foreign rows discarded).
      const maxId = events[events.length - 1].id;
      await sqlite.runAsync(`DELETE FROM outbox WHERE table_name = ? AND id <= ?`, [table, maxId] as never[]);
    }
  }
}

async function pullAndMerge(userId: string, token: SessionEpochToken): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    assertActive(token);
    const allowed = KNOWN_COLUMNS.get(table)!;
    const cursorRow = await sqlite.getFirstAsync<{ last_pulled_at: string }>(
      `SELECT last_pulled_at FROM sync_state WHERE table_name = ?`,
      [table] as never[],
    );
    // Cursor is a keyset on (updated_at, id) encoded as "ts|id"; a plain ISO
    // string is the legacy form (id empty). A composite cursor is required so a
    // page boundary that splits rows sharing one updated_at never skips them.
    const raw = cursorRow?.last_pulled_at ?? "1970-01-01T00:00:00.000Z";
    const sep = raw.indexOf("|");
    let curTs = sep >= 0 ? raw.slice(0, sep) : raw;
    let curId = sep >= 0 ? raw.slice(sep + 1) : "";
    for (;;) {
      let query = supabase
        .from(table)
        .select("*")
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(PULL_PAGE);
      query = curId
        ? query.or(`updated_at.gt.${curTs},and(updated_at.eq.${curTs},id.gt.${curId})`)
        : query.gt("updated_at", curTs);
      const { data, error } = await query.abortSignal(token.signal);
      if (error) throw new Error(`pull ${table}: ${error.message}`);
      if (!data || data.length === 0) break;

      assertActive(token);
      await withTransaction(async () => {
        for (const remoteRaw of data) {
          assertActive(token);
          const remote = toLocal(table, remoteRaw as Record<string, unknown>);
          // An unparseable server timestamp can't participate in LWW; skip it
          // explicitly (and loudly) instead of relying on a NaN comparison
          // silently evaluating false — otherwise the row would never sync and
          // no one would know why.
          const remoteUpdated = Date.parse(remote.updated_at as string);
          if (!Number.isFinite(remoteUpdated)) {
            console.warn(`[sync] ${table} ${String(remote.id)}: unparseable updated_at, skipped`);
            continue;
          }
          const local = await sqlite.getFirstAsync<{ updated_at: string }>(
            `SELECT updated_at FROM ${table} WHERE id = ?`,
            [remote.id] as never[],
          );
          const remoteWins = !local || remoteUpdated >= Date.parse(local.updated_at);
          if (!remoteWins) continue;
          // Only accept columns this client's schema knows (ignore any extra
          // server columns) so the generated SQL is always well-formed.
          const keys = Object.keys(remote).filter((k) => allowed.has(k));
          if (!keys.includes("id")) continue;
          await sqlite.runAsync(
            `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
             ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`,
            keys.map((k) => (remote[k] === undefined ? null : remote[k])) as never[],
          );
        }
        const last = data[data.length - 1] as { updated_at: string; id: string };
        assertActive(token);
        curTs = new Date(last.updated_at).toISOString();
        curId = last.id;
        await sqlite.runAsync(
          `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
           ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
          [table, `${curTs}|${curId}`] as never[],
        );
      });
      if (data.length < PULL_PAGE) break;
    }
  }
  void userId; // RLS scopes the pull; kept for signature clarity
}

let syncing = false;
let rerunRequestedFor: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let inFlight: Promise<boolean> | null = null;
const sessionTasks = new Set<Promise<unknown>>();

function clearScheduledSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  retryAttempt = 0;
  rerunRequestedFor = null;
}

/** Activate sync for the authenticated/local workspace owner. */
export function startSyncSession(userId: string): void {
  const previous = sessionEpoch.capture(userId);
  sessionEpoch.start(userId);
  if (!previous) clearScheduledSync();
}

/**
 * Register non-sync background work (maintenance, FX, notifications) under
 * the same user epoch. Sign-out waits for registered work before wiping the
 * database, and the callback receives an abort signal for cancellable I/O.
 */
export async function runSyncSessionTask<T>(
  userId: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const token = sessionEpoch.capture(userId);
  if (!token) return undefined;
  const running = task(token.signal);
  sessionTasks.add(running);
  try {
    const result = await running;
    assertActive(token);
    return result;
  } catch (e) {
    if (e instanceof SessionEpochCancelledError || token.signal.aborted || !sessionEpoch.isCurrent(token)) return undefined;
    throw e;
  } finally {
    sessionTasks.delete(running);
  }
}

/**
 * Stop every scheduled/pending sync (debounce + retry timers). Called on
 * sign-out so a backoff retry never fires for the previous account after the
 * local workspace has been wiped.
 */
export function cancelSync(): void {
  sessionEpoch.stop();
  clearScheduledSync();
}

/** Abort the current epoch and wait until its transaction/network task exits. */
export async function stopSyncSession(userId?: string): Promise<void> {
  sessionEpoch.stop(userId);
  clearScheduledSync();
  const current = inFlight;
  await Promise.allSettled([...(current ? [current] : []), ...sessionTasks]);
}

async function runSync(userId: string, token: SessionEpochToken, allowRefresh: boolean): Promise<boolean> {
  const status = useSyncStatus.getState();
  if (!getSupabase()) {
    status.set({ state: "unconfigured" });
    return true;
  }
  status.set({ state: "syncing" });
  try {
    await pushOutbox(userId, token);
    await pullAndMerge(userId, token);
    assertActive(token);
    retryAttempt = 0;
    status.set({ state: "idle", lastSyncAt: new Date().toISOString(), error: null });
    return true;
  } catch (e) {
    if (e instanceof SessionEpochCancelledError || !sessionEpoch.isCurrent(token) || token.signal.aborted) {
      return false;
    }
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[sync]", raw);
    // Expired token → refresh once and retry immediately, no user action.
    if (allowRefresh && isAuthError(raw) && (await tryRefreshSession())) {
      status.set({ state: "syncing" });
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void syncNow(userId, false), 0);
      return false;
    }
    status.set({ state: "error", error: friendlySyncError(raw) });
    // Exponential backoff retry: 5s, 10s, 20s… capped at 5 min.
    const delay = Math.min(5000 * 2 ** retryAttempt, 300_000);
    retryAttempt += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void syncNow(userId), delay);
    return false;
  }
}

export async function syncNow(userId: string, allowRefresh = true): Promise<boolean> {
  const token = sessionEpoch.capture(userId);
  // A late maintenance callback from a signed-out account must be a no-op. The
  // auth/session layer is the only place allowed to activate an epoch.
  if (!token) return false;
  if (syncing) {
    // A write landed while a sync is in flight: remember the active account and
    // run one more pass. A new account can replace this request after aborting
    // the old epoch, but an old callback can never replace the new one.
    rerunRequestedFor = userId;
    const current = inFlight;
    return current ? current.catch(() => false) : false;
  }
  syncing = true;
  const task = runSync(userId, token, allowRefresh);
  inFlight = task;
  try {
    return await task;
  } finally {
    if (inFlight === task) inFlight = null;
    syncing = false;
    const requestedUser = rerunRequestedFor;
    rerunRequestedFor = null;
    if (requestedUser && sessionEpoch.capture(requestedUser)) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void syncNow(requestedUser), 250);
    }
  }
}

/** Debounced trigger for after-write sync (UI never waits on this). */
export function scheduleSync(userId: string, delayMs = 1500): void {
  if (!sessionEpoch.capture(userId)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(userId), delayMs);
}
