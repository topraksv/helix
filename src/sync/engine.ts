/**
 * Outbox sync engine (spec §2.2): push → pull → merge, single instance,
 * last-write-wins on server-normalized `updated_at`. Errors surface in the
 * status store (never swallowed) and retry with exponential backoff.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteBindValue } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { getSupabase } from "./supabase";
import { classifyRefreshFailure, completedSyncState, DEAD_LETTER_COUNT_SQL, useSyncStatus, type RefreshOutcome } from "./status";
import { tr } from "../i18n/tr";
import { SessionEpoch, SessionEpochCancelledError, runSessionEpochTask, type SessionEpochToken } from "./session-epoch";
import {
  cursorIsAtServerHead,
  formatPullCursor,
  isUuidShaped,
  parsePullCursor,
  PULL_EPOCH,
  remoteSupersededLocal,
  remoteWinsLww,
  shouldApplyServerAck,
  type ParsedOutboxEvent,
  type PullCursor,
} from "./merge-policy";
import { devError, devWarning } from "../services/logger";
import { uploadDiagnostics, type DiagnosticUpload, type DiagnosticUploadPort } from "../services/diagnostics";
import { prepareOutboundBatch } from "./outbound-validation";
import { purgeRemoteAttachments, reconcileAttachments } from "./attachment-mirror";
import { isValidImportRow } from "../services/backup-validation";
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
async function tryRefreshSession(): Promise<RefreshOutcome> {
  const supabase = getSupabase();
  if (!supabase) return "unavailable";
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) return "refreshed";
    return classifyRefreshFailure(error);
  } catch (error) {
    return classifyRefreshFailure(error);
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
    !Number.isFinite(Date.parse(remote.updated_at)) ||
    !Number.isSafeInteger(remote.tombstone_version) ||
    Number(remote.tombstone_version) < 0
  ) {
    throw new Error(`pull ${table}: invalid server row`);
  }
  if (!isValidImportRow(table, remote)) throw new Error(`pull ${table}: invalid server data`);
  return remote;
}

/**
 * SQLite's compiled parameter ceiling is well above this, but a page is 1000
 * rows and a chunk that large builds a 1000-placeholder statement string for
 * every table on every sync. Five statements of 200 cost less to prepare than
 * one of 1000 and stay clear of the ceiling on any build.
 */
const ID_LOOKUP_CHUNK = 200;

/** The handle `getSqliteAsync` hands back, named so the helpers below can take it. */
type LocalDatabase = Awaited<ReturnType<typeof getSqliteAsync>>;

/** `ids` in groups small enough to bind in one statement. */
function* idChunks(ids: readonly string[]): Generator<string[]> {
  for (let start = 0; start < ids.length; start += ID_LOOKUP_CHUNK) {
    yield ids.slice(start, start + ID_LOOKUP_CHUNK);
  }
}

/**
 * The local merge state for a whole pulled page, keyed by id.
 *
 * One point read per row was the shape this had, and the cost is not the query
 * — SQLite answers a primary-key lookup in microseconds — it is the driver. On
 * web every one of these is a postMessage round trip to the SQLite worker, so a
 * 1000-row page paid 1000 of them before merging anything. Ids within a page
 * are unique (the server pages by `(updated_at, id)`), and the merge loop
 * writes only the row it is holding, so a snapshot taken before the loop stays
 * true for every row still to come.
 */
async function localMergeState(
  sqlite: LocalDatabase,
  table: SyncedTableName,
  ids: readonly string[],
): Promise<Map<string, { updated_at: string; tombstone_version: number }>> {
  const state = new Map<string, { updated_at: string; tombstone_version: number }>();
  for (const chunk of idChunks(ids)) {
    const rows = await sqlite.getAllAsync<{ id: string; updated_at: string; tombstone_version: number }>(
      `SELECT id, updated_at, tombstone_version FROM ${table} WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    for (const row of rows) state.set(row.id, { updated_at: row.updated_at, tombstone_version: row.tombstone_version });
  }
  return state;
}

/**
 * The newest outbox event id per row, for a whole acknowledged batch.
 *
 * `MAX(id)` over a group is the same answer `ORDER BY id DESC LIMIT 1` gave one
 * row at a time; what changes is that a 200-row batch asks once. Safe to read
 * before the loop for the same reason as above: the loop writes to the table
 * being synced, never to `outbox`, and the batch's own rows are deleted after
 * it ends.
 */
async function newestOutboxIds(
  sqlite: LocalDatabase,
  table: SyncedTableName,
  rowIds: readonly string[],
): Promise<Map<string, number>> {
  const newest = new Map<string, number>();
  for (const chunk of idChunks(rowIds)) {
    const rows = await sqlite.getAllAsync<{ row_id: string; id: number }>(
      `SELECT row_id, MAX(id) AS id FROM outbox WHERE table_name = ? AND row_id IN (${chunk.map(() => "?").join(", ")})
       GROUP BY row_id`,
      [table, ...chunk],
    );
    for (const row of rows) newest.set(row.row_id, row.id);
  }
  return newest;
}

async function upsertLocalRemote(
  table: SyncedTableName,
  remote: Record<string, unknown>,
  allowed: Set<string>,
): Promise<void> {
  const sqlite = await getSqliteAsync();
  const keys = Object.keys(remote).filter((key) => allowed.has(key));
  if (!keys.includes("id") || keys.length < 2) throw new Error(`pull ${table}: incomplete server row`);
  const result = await sqlite.runAsync(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
     ON CONFLICT(id) DO UPDATE SET ${keys.filter((key) => key !== "id").map((key) => `${key} = excluded.${key}`).join(", ")}
     WHERE ${table}.user_id = excluded.user_id`,
    // toLocal already coerced every column to string/number/null; this is the
    // dynamic-row boundary where that guarantee meets the driver's types.
    keys.map((key): SQLiteBindValue => (remote[key] === undefined ? null : (remote[key] as SQLiteBindValue))),
  );
  if (result.changes !== 1) throw new Error(`pull ${table}: local ownership conflict`);
}

async function pushOutbox(userId: string, token: SessionEpochToken): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  // Which tables were refused, per reason, across the whole push.
  //
  // `sync_dead_letters` is local to the device (see `src/db/schema.ts`), so no
  // server query can reach it and a row stuck here is invisible to anyone not
  // holding the phone. The incident log is the only channel that leaves, and
  // what it used to carry was `"12 invalid outbox event(s) quarantined"` —
  // whose count the fingerprint drops as digits and whose table and reason it
  // never had. Naming them costs nothing and is the difference between knowing
  // something is stuck and knowing what.
  const quarantined = new Map<string, Set<string>>();
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
        const newestByRow = await newestOutboxIds(sqlite, table, pushedEvents.map((event) => event.row_id));
        for (const raw of acknowledged) {
          const remote = validatedRemoteRow(table, raw, userId);
          const pushed = eventByRow.get(remote.id as string);
          if (!pushed) throw new Error(`push ${table}: unknown acknowledgement`);
          if (shouldApplyServerAck(pushed.id, newestByRow.get(pushed.row_id) ?? null)) {
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
      for (const event of rejected) {
        const tables = quarantined.get(event.reason) ?? new Set<string>();
        tables.add(table);
        quarantined.set(event.reason, tables);
      }
    }
  }
  // Grouped by reason rather than per rejected row: the ring holds twelve
  // events, and there are exactly three reasons, so a push that refuses a
  // thousand rows still cannot evict the rest of the ring to say so. The table
  // names ride in the message because they survive the fingerprint as tokens.
  for (const [reason, tables] of quarantined) {
    devWarning("sync.quarantine", `${reason} ${[...tables].join(" ")}`);
  }
}

/** One row of `public.sync_cursors()` (migration 32). */
interface ServerHeadRow {
  table_name: string;
  max_updated_at: string | null;
  max_id: string | null;
}

/**
 * Set when the server answers "no such function".
 *
 * Migration 32 is not applied to a project the moment this code ships, and
 * rediscovering that would cost a round trip on every sync. Module-scoped
 * rather than persisted, so applying the migration takes effect at the next
 * launch without a client change.
 */
let changeProbeUnavailable = false;

/**
 * Where each table's keyset head is, in one request.
 *
 * Returns null when the probe cannot be used, which the caller reads as "pull
 * every table" — the behaviour this function replaced, unchanged. A table the
 * answer does not mention is likewise absent from the map, and is pulled: the
 * function's table list is a second copy of `SYNCED_TABLES`, and a copy can
 * fall behind. Only a table that is present AND reports a head may be skipped.
 */
async function fetchServerHeads(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  token: SessionEpochToken,
): Promise<Map<string, PullCursor | null> | null> {
  if (changeProbeUnavailable) return null;
  const { data, error } = await supabase.rpc("sync_cursors").abortSignal(token.signal);
  if (error) {
    // PGRST202 is PostgREST's "no such function in the schema cache", and is
    // the only failure that degrades quietly. An auth or network error has to
    // reach `runSync` so the session refresh and the backoff still happen.
    if (error.code !== "PGRST202") throw new Error(`pull probe: ${error.message}`);
    devWarning("sync", "sync_cursors() is not applied; pulling every table");
    changeProbeUnavailable = true;
    return null;
  }
  const heads = new Map<string, PullCursor | null>();
  for (const row of (data ?? []) as ServerHeadRow[]) {
    if (typeof row?.table_name !== "string") continue;
    if (row.max_updated_at == null && row.max_id == null) {
      heads.set(row.table_name, null);
    } else if (typeof row.max_updated_at === "string" && isUuidShaped(row.max_id)) {
      heads.set(row.table_name, { ts: row.max_updated_at, id: row.max_id });
    }
    // Any other shape is left out of the map, so that table is pulled.
  }
  return heads;
}

/** Returns how many pulled rows replaced a version this device already had. */
async function pullAndMerge(userId: string, token: SessionEpochToken): Promise<number> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  let superseded = 0;
  const tables = Object.keys(SYNCED_TABLES) as SyncedTableName[];

  // One read for all 21 cursors. `sync_state` holds one small row per table,
  // and this was 21 separate statements for them.
  const cursorRows = await sqlite.getAllAsync<{ table_name: string; last_pulled_at: string }>(
    `SELECT table_name, last_pulled_at FROM sync_state`,
    [],
  );
  const cursors = new Map(cursorRows.map((row) => [row.table_name, parsePullCursor(row.last_pulled_at)]));
  const cursorFor = (table: SyncedTableName): PullCursor => cursors.get(table) ?? parsePullCursor(null);

  assertActive(token);
  // A workspace that has never pulled anything has nothing to skip, so the
  // probe could only add a round trip. Every other sync asks once and then
  // pulls the few tables that actually moved.
  const heads = tables.some((table) => cursorFor(table).ts !== PULL_EPOCH)
    ? await fetchServerHeads(supabase, token)
    : null;
  // `filter` keeps the declaration order, which is FK-safe: SQLite runs with
  // `PRAGMA foreign_keys = ON`, so a child row must never be merged before its
  // parent exists. That ordering is also why the pending tables are pulled one
  // after another rather than concurrently.
  const pending = heads
    ? tables.filter((table) =>
        !heads.has(table) || !cursorIsAtServerHead(cursorFor(table), heads.get(table) ?? null))
    : tables;

  for (const table of pending) {
    assertActive(token);
    const allowed = KNOWN_COLUMNS.get(table)!;
    // Cursor is a keyset on (updated_at, id) encoded as "ts|id"; a plain ISO
    // string is the legacy form (id empty). A composite cursor is required so a
    // page boundary that splits rows sharing one updated_at never skips them.
    let { ts: curTs, id: curId } = cursorFor(table);
    for (;;) {
      let query = supabase
        .from(table)
        .select("*")
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(PULL_PAGE);
      query = curId
        ? query.or(`updated_at.gt.${curTs},and(updated_at.eq.${curTs},id.gt.${curId})`)
        // A legacy cursor has no id tie-breaker. Include its timestamp once so
        // rows sharing that timestamp are recovered during the migration to
        // the composite cursor; the LWW merge makes the replay idempotent.
        : query.gte("updated_at", curTs);
      const { data, error } = await query.abortSignal(token.signal);
      if (error) throw new Error(`pull ${table}: ${error.message}`);
      if (!data || data.length === 0) break;

      assertActive(token);
      // Validate the complete page before merging anything or advancing its
      // cursor. A bad server row must retry in place, never become a permanent
      // omission hidden behind a newer cursor.
      const remoteRows = data.map((row) => validatedRemoteRow(table, row as Record<string, unknown>, userId));
      await withTransaction(async () => {
        const localByRow = await localMergeState(sqlite, table, remoteRows.map((remote) => String(remote.id)));
        for (const remote of remoteRows) {
          assertActive(token);
          const local = localByRow.get(String(remote.id)) ?? null;
          const remoteWins = remoteWinsLww(
            local?.updated_at ?? null,
            remote.updated_at as string,
            local?.tombstone_version ?? 0,
            Number(remote.tombstone_version),
          );
          if (!remoteWins) continue;
          if (
            remoteSupersededLocal(
              local?.updated_at ?? null,
              remote.updated_at as string,
              local?.tombstone_version ?? 0,
              Number(remote.tombstone_version),
            )
          ) superseded += 1;
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
          [table, formatPullCursor({ ts: curTs, id: curId })],
        );
      });
      if (data.length < PULL_PAGE) break;
    }
  }
  return superseded;
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

/** The version the incident happened in, as the table's CHECK will accept it. */
const APP_VERSION = String(Constants.expoConfig?.version ?? "0").slice(0, 32);

function devicePlatform(): DiagnosticUpload["platform"] {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
}

/**
 * The only writer of `diagnostic_events`.
 *
 * `ignoreDuplicates` leans on the table's identity index: a device that has
 * been offline for a week still holds its whole ring, and re-sending it must
 * add nothing rather than fail the batch.
 */
function diagnosticUploadPort(userId: string): DiagnosticUploadPort {
  return {
    async upload(rows) {
      const client = getSupabase();
      if (!client) throw new Error("unconfigured");
      const { error } = await client
        .from("diagnostic_events")
        .upsert(rows.filter((row) => row.user_id === userId), {
          onConflict: "user_id,occurred_at,scope,code",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(error.message);
    },
  };
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
    const superseded = await pullAndMerge(userId, token);
    assertActive(token);
    const sqlite = await getSqliteAsync();
    const deadLetters = await sqlite.getFirstAsync<{ count: number }>(DEAD_LETTER_COUNT_SQL, []);
    const completionState = completedSyncState(deadLetters?.count ?? 0);
    retryAttempt = 0;
    // Piggybacked on a completed sync rather than scheduled on its own: this is
    // the one moment the app knows it has a live session AND a working network,
    // and the upload must never be the reason either is spent. It reports its
    // own failures nowhere and cannot fail this sync.
    void uploadDiagnostics(diagnosticUploadPort(userId), userId, devicePlatform(), APP_VERSION);
    // The retention window, applied where the app already has a live session.
    // There is no scheduler on this project, so an unenforced policy would be
    // a sentence in a document; this makes it a delete. It can only reach rows
    // already past the window, so calling it often costs nothing and calling
    // it never is the only way the limit is missed.
    // `.catch` even though PostgREST failures come back as `{ error }` rather
    // than a rejection: this is a fire-and-forget on the sync's success path,
    // and a transport that ever did reject would surface as an unhandled
    // rejection — which `installCrashHandlers` would faithfully record as a
    // crash the app did not actually have.
    void getSupabase()?.rpc("purge_expired_diagnostics").then(undefined, () => {});
    // Registered as session work rather than fired loose: this one can spend a
    // while sending a 25 MB file, and a sign-out that wiped the database out
    // from under it would be reading a document that no longer has a row.
    void runSyncSessionTask(userId, (signal) => reconcileAttachments(userId, signal));
    status.set({
      state: completionState,
      lastSyncAt: new Date().toISOString(),
      error: completionState === "attention" ? tr.sync.errQuarantined : null,
      // Announce only a pull that replaced something the user could already
      // see. Their own acknowledged writes come back with an identical
      // timestamp and are excluded by `remoteSupersededLocal`.
      ...(superseded > 0 ? { remoteChangeAt: new Date().toISOString() } : {}),
    });
    return true;
  } catch (e) {
    if (e instanceof SessionEpochCancelledError || !sessionEpoch.isCurrent(token) || token.signal.aborted) {
      return false;
    }
    const raw = e instanceof Error ? e.message : String(e);
    devError("sync", raw);
    let message = friendlySyncError(raw);
    // Expired token → refresh once and retry immediately, no user action.
    if (isAuthError(raw)) {
      const outcome = allowRefresh
        ? await runSessionEpochTask(sessionEpoch, userId, () => tryRefreshSession())
        : ("expired" as RefreshOutcome);
      if (outcome == null) return false;
      if (outcome === "refreshed") {
        status.set({ state: "syncing" });
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void syncNow(userId, false), 0);
        return false;
      }
      if (outcome === "expired") {
        // The refresh token itself is gone (revoked elsewhere, or expired while
        // the app was closed). Retrying cannot fix that, so stop promising an
        // automatic sync that will never happen, stop the backoff from hammering
        // a dead session, and say plainly that the local data is safe and needs a
        // sign-in to leave the device.
        status.set({ state: "error", error: tr.sync.errReauth });
        return false;
      }
      // `unavailable`: the refresh never reached the auth service, so it proves
      // nothing about the session. Fall through to the ordinary backoff with
      // the message that matches the real cause.
      message = tr.sync.errNetwork;
    }
    status.set({ state: "error", error: message });
    // Exponential backoff retry: 5s, 10s, 20s… capped at 5 min.
    const delay = Math.min(5000 * 2 ** retryAttempt, 300_000);
    retryAttempt += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void syncNow(userId), delay);
    return false;
  }
}

/**
 * Push the outbox and nothing else.
 *
 * Sign-out flushes before it wipes so a queued row is never deleted while the
 * user believes it is saved. A full `syncNow` also PULLS, which fetches remote
 * pages into a database that is about to be dropped — on a real account that
 * turned an instant sign-out into a wait for the network. Only the push
 * decides whether anything would be lost.
 */
export async function flushOutbox(userId: string): Promise<void> {
  const token = sessionEpoch.capture(userId);
  if (!token || !getSupabase()) return;
  try {
    await pushOutbox(userId, token);
  } catch {
    // The caller re-counts the outbox; a failed push simply leaves rows in it.
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

/**
 * Erase this account's mirrored documents.
 *
 * Re-exported here rather than imported from `attachment-mirror` directly,
 * because this module is the whole of what the auth layer knows about sync —
 * it already comes here for `flushOutbox` and the session epoch. Reaching past
 * it made the sign-out path load the database layer that the auth tests mock
 * this module precisely to avoid, which is the seam telling the truth.
 */
export { purgeRemoteAttachments };

/** Debounced trigger for after-write sync (UI never waits on this). */
export function scheduleSync(userId: string, delayMs = 1500): void {
  if (!sessionEpoch.capture(userId)) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(userId), delayMs);
}
