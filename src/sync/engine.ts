/**
 * Outbox sync engine (spec §2.2): push → pull → merge, single instance,
 * last-write-wins on server-normalized `updated_at`. Errors surface in the
 * status store (never swallowed) and retry with exponential backoff.
 */

import { getTableColumns } from "drizzle-orm";
import type { SQLiteBindValue } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { getSupabase } from "./supabase";
import { completedSyncState, DEAD_LETTER_COUNT_SQL, useSyncStatus } from "./status";
import { tr } from "../i18n/tr";
import { SessionEpoch, SessionEpochCancelledError, runSessionEpochTask, type SessionEpochToken } from "./session-epoch";
import { isUuidShaped, remoteWinsLww, shouldApplyServerAck, type ParsedOutboxEvent } from "./merge-policy";
import { devError, devWarning } from "../services/logger";
import { prepareOutboundBatch } from "./outbound-validation";
import type { Database } from "./database.types";

type SyncedInsert = Database["public"]["Tables"][SyncedTableName]["Insert"];

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
  if (table === "computed_columns" && out.definition != null && typeof out.definition !== "string") {
    out.definition = JSON.stringify(out.definition);
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

function validatedRemoteRow(
  table: SyncedTableName,
  raw: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const remote = toLocal(table, raw);
  // The id becomes the keyset cursor and is interpolated into a PostgREST
  // `.or()` filter, so its UUID shape is part of the trust boundary.
  if (
    !isUuidShaped(remote.id) ||
    remote.user_id !== userId ||
    typeof remote.updated_at !== "string" ||
    !Number.isFinite(Date.parse(remote.updated_at))
  ) {
    throw new Error(`pull ${table}: invalid server row`);
  }
  return remote;
}

async function upsertLocalRemote(
  table: SyncedTableName,
  remote: Record<string, unknown>,
  allowed: Set<string>,
): Promise<void> {
  const sqlite = await getSqliteAsync();
  const keys = Object.keys(remote).filter((key) => allowed.has(key));
  if (!keys.includes("id") || keys.length < 2) throw new Error(`pull ${table}: incomplete server row`);
  await sqlite.runAsync(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
     ON CONFLICT(id) DO UPDATE SET ${keys.filter((key) => key !== "id").map((key) => `${key} = excluded.${key}`).join(", ")}`,
    // toLocal already coerced every column to string/number/null; this is the
    // dynamic-row boundary where that guarantee meets the driver's types.
    keys.map((key): SQLiteBindValue => (remote[key] === undefined ? null : (remote[key] as SQLiteBindValue))),
  );
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
        [table],
      );
      if (events.length === 0) break;
      // Keep only the newest event per row. Invalid/cross-account payloads are
      // quarantined below; they are never silently discarded or sent under the
      // wrong RLS identity.
      const { rejected, pushedEvents, rows } = prepareOutboundBatch(table, events, userId, {
        allowedColumns: KNOWN_COLUMNS.get(table)!,
        booleanColumns: BOOLEAN_COLUMNS.get(table)!,
      });
      let acknowledged: Record<string, unknown>[] = [];
      if (rows.length > 0) {
        assertActive(token);
        const { data, error } = await supabase
          .from(table)
          // prepareOutboundBatch performs table-aware runtime validation. This
          // cast is the one dynamic-table bridge into generated Supabase types.
          .upsert(rows as SyncedInsert[], { onConflict: "id" })
          .select("*")
          .abortSignal(token.signal);
        if (error) throw new Error(`push ${table}: ${error.message}`);
        acknowledged = (data ?? []) as Record<string, unknown>[];
        if (acknowledged.length !== rows.length) throw new Error(`push ${table}: incomplete acknowledgement`);
      }
      // A sign-out/account switch may have happened while PostgREST was in
      // flight. Never clear the local outbox for a stale session response.
      assertActive(token);
      const eventByRow = new Map<string, ParsedOutboxEvent>(pushedEvents.map((event) => [event.row_id, event]));
      const allowed = KNOWN_COLUMNS.get(table)!;
      await withTransaction(async () => {
        assertActive(token);
        for (const raw of acknowledged) {
          const remote = validatedRemoteRow(table, raw, userId);
          const pushed = eventByRow.get(remote.id as string);
          if (!pushed) throw new Error(`push ${table}: unknown acknowledgement`);
          const newest = await sqlite.getFirstAsync<{ id: number }>(
            `SELECT id FROM outbox WHERE table_name = ? AND row_id = ? ORDER BY id DESC LIMIT 1`,
            [table, pushed.row_id],
          );
          if (shouldApplyServerAck(pushed.id, newest?.id ?? null)) {
            await upsertLocalRemote(table, remote, allowed);
          }
        }
        for (const event of rejected) {
          await sqlite.runAsync(
            `INSERT OR IGNORE INTO sync_dead_letters
             (outbox_id, table_name, row_id, payload, reason, quarantined_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [event.id, table, event.row_id, event.payload, event.reason, new Date().toISOString()],
          );
        }
        const placeholders = events.map(() => "?").join(", ");
        await sqlite.runAsync(`DELETE FROM outbox WHERE id IN (${placeholders})`, events.map((event) => event.id));
      });
      if (rejected.length > 0) {
        devWarning("sync", `${rejected.length} invalid outbox event(s) quarantined`);
      }
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
      [table],
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
      // Validate the complete page before merging anything or advancing its
      // cursor. A bad server row must retry in place, never become a permanent
      // omission hidden behind a newer cursor.
      const remoteRows = data.map((row) => validatedRemoteRow(table, row as Record<string, unknown>, userId));
      await withTransaction(async () => {
        for (const remote of remoteRows) {
          assertActive(token);
          const local = await sqlite.getFirstAsync<{ updated_at: string }>(
            `SELECT updated_at FROM ${table} WHERE id = ?`,
            [String(remote.id)],
          );
          const remoteWins = remoteWinsLww(local?.updated_at ?? null, remote.updated_at as string);
          if (!remoteWins) continue;
          // Only accept columns this client's schema knows (ignore any extra
          // server columns) so the generated SQL is always well-formed.
          await upsertLocalRemote(table, remote, allowed);
        }
        const last = remoteRows[remoteRows.length - 1];
        if (!last) throw new Error(`pull ${table}: empty validated page`);
        assertActive(token);
        curTs = new Date(last.updated_at as string).toISOString();
        curId = last.id as string;
        await sqlite.runAsync(
          `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
           ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
          [table, `${curTs}|${curId}`],
        );
      });
      if (data.length < PULL_PAGE) break;
    }
  }
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
  const running = runSessionEpochTask(sessionEpoch, userId, task);
  sessionTasks.add(running);
  try {
    return await running;
  } finally {
    sessionTasks.delete(running);
  }
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
    const sqlite = await getSqliteAsync();
    const deadLetters = await sqlite.getFirstAsync<{ count: number }>(DEAD_LETTER_COUNT_SQL, []);
    const completionState = completedSyncState(deadLetters?.count ?? 0);
    retryAttempt = 0;
    status.set({
      state: completionState,
      lastSyncAt: new Date().toISOString(),
      error: completionState === "attention" ? tr.sync.errQuarantined : null,
    });
    return true;
  } catch (e) {
    if (e instanceof SessionEpochCancelledError || !sessionEpoch.isCurrent(token) || token.signal.aborted) {
      return false;
    }
    const raw = e instanceof Error ? e.message : String(e);
    devError("sync", raw);
    // Expired token → refresh once and retry immediately, no user action.
    if (allowRefresh && isAuthError(raw)) {
      const refreshed = await runSessionEpochTask(sessionEpoch, userId, () => tryRefreshSession());
      if (refreshed == null) return false;
      if (refreshed) {
        status.set({ state: "syncing" });
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void syncNow(userId, false), 0);
        return false;
      }
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
