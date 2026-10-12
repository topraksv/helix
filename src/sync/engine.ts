/**
 * Outbox sync engine (spec §10.1): push → pull → merge, single instance,
 * last-write-wins on server-normalized `updated_at`. Errors surface in the
 * status store (never swallowed) and retry with exponential backoff.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteBindValue } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "../db/client";
import { SYNCED_TABLES, UNPULLED, type SyncedTableName } from "../db/schema";
import { getSupabase } from "./supabase";
import { classifyRefreshFailure, completedSyncState, DEAD_LETTER_COUNT_SQL, useSyncStatus, type RefreshOutcome } from "./status";
import { tr } from "../i18n/tr";
import { SessionEpoch, SessionEpochCancelledError, runSessionEpochTask, type SessionEpochToken } from "./session-epoch";
import {
  cursorIsAtServerHead,
  cursorInstant,
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
import { reportUsage, type UsageUploadPort } from "../services/usage";
import { outboundPolicy, prepareOutboundBatch } from "./outbound-validation";
import { eraseDeviceAttachments, purgeRemoteAttachments, reconcileAttachments, unsentAttachments } from "./attachment-mirror";
import { isValidImportRow } from "../services/backup-validation";
import type { Database } from "./database.types";

type SyncedInsert = Database["public"]["Tables"][SyncedTableName]["Insert"];

const isAuthError = (raw: string) => /jwt|token|401|unauthorized|not authenticated/i.test(raw);

/** Map a raw PostgREST/network error to a short, friendly Turkish message. */
function friendlySyncError(raw: string): string {
  if (/row-level security|violates row-level|permission denied/i.test(raw)) return tr.sync.errRls;
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
const PULL_ORDER: readonly SyncedTableName[] = [
  "settings",
  ...(Object.keys(SYNCED_TABLES) as SyncedTableName[]).filter((table) => table !== "settings"),
];
const PUSH_BATCH = 200;

/** Columns needing type coercion between SQLite and Postgres. */
const NUMERIC_COLUMNS: Record<string, Set<string>> = {
  transactions: new Set(["fx_rate"]),
  fx_rates: new Set(["rate_try"]),
};

/** What a migration adding each column gives every row it finds: its default, or null. */
const EMPTY_VALUES = new Map<SyncedTableName, Map<string, unknown>>();
for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
  EMPTY_VALUES.set(table, new Map(Object.values(getTableColumns(SYNCED_TABLES[table])).map((c) => [c.name, c.default ?? null])));
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
  for (const col of outboundPolicy(table).booleanColumns) {
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

/** Ids bound per statement: five of 200 cost less to prepare than one 1000-placeholder string. */
const ID_CHUNK = 200;

/** The handle `getSqliteAsync` hands back, named so the helpers below can take it. */
type LocalDatabase = Awaited<ReturnType<typeof getSqliteAsync>>;

function* chunks<T>(values: readonly T[]): Generator<T[]> {
  for (let at = 0; at < values.length; at += ID_CHUNK) yield values.slice(at, at + ID_CHUNK);
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
  for (const chunk of chunks(ids)) {
    const rows = await sqlite.getAllAsync<{ id: string; updated_at: string; tombstone_version: number }>(
      `SELECT id, updated_at, tombstone_version FROM ${table} WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    for (const row of rows) state.set(row.id, row);
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
  for (const chunk of chunks(rowIds)) {
    const rows = await sqlite.getAllAsync<{ row_id: string; id: number }>(
      `SELECT row_id, MAX(id) AS id FROM outbox WHERE table_name = ? AND row_id IN (${chunk.map(() => "?").join(", ")})
       GROUP BY row_id`,
      [table, ...chunk],
    );
    for (const row of rows) newest.set(row.row_id, row.id);
  }
  return newest;
}

async function upsertLocal(
  table: SyncedTableName,
  remote: Record<string, unknown>,
  allowed: ReadonlySet<string>,
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

/** The columns of `table` a migration added before the pull after it, each with the value it gave every row. */
async function unpulledOf(sqlite: LocalDatabase, table: SyncedTableName): Promise<Map<string, unknown>> {
  const marked = await sqlite.getFirstAsync<{ last_pulled_at: string }>("SELECT last_pulled_at FROM sync_state WHERE table_name = ?", [UNPULLED + table]);
  return new Map((marked ? (JSON.parse(marked.last_pulled_at) as string[]) : []).map((column) => [column, EMPTY_VALUES.get(table)!.get(column) ?? null]));
}

/** Consecutive rows naming the same columns, in the batch's order. */
function runsOfOneShape(rows: readonly Record<string, unknown>[]): Record<string, unknown>[][] {
  const runs: Record<string, unknown>[][] = [];
  let runShape = "";
  for (const row of rows) {
    const shape = Object.keys(row).sort().join();
    if (runs.length > 0 && shape === runShape) runs.at(-1)!.push(row);
    else runs.push([row]);
    runShape = shape;
  }
  return runs;
}

/** A row generations ahead of the server (a delete undone and redone unsent) is resent at the server's generation; a live row onto a remote delete goes one below so that delete stands. */
async function atServerGeneration(
  table: SyncedTableName,
  run: Record<string, unknown>[],
  token: SessionEpochToken,
): Promise<Record<string, unknown>[] | null> {
  const { data, error } = await getSupabase()!
    .from(table)
    .select("id, tombstone_version, deleted_at")
    .in("id", run.map((row) => String(row.id)))
    .abortSignal(token.signal);
  if (error) throw new Error(`push ${table}: ${error.message}`);
  const held = new Map((data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
  let ahead = false;
  const level = run.map((row) => {
    const server = held.get(String(row.id));
    if (server == null) return row;
    const at = Number(server.tombstone_version);
    if (at >= Number(row.tombstone_version)) return row;
    ahead = true;
    // A delete this device never saw stands: one generation below, the server
    // answers with what it holds, and the device takes that.
    const behind = server.deleted_at != null && row.deleted_at == null ? 1 : 0;
    return { ...row, tombstone_version: at - behind };
  });
  return ahead ? level : null;
}

async function pushOutbox(userId: string, token: SessionEpochToken): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  // Tables refused per reason across the push: `sync_dead_letters` never leaves the device, so the incident log is the only way to know what is stuck.
  const quarantined = new Map<string, Set<string>>();
  // Push per table in FK-safe declaration order, oldest events first.
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    // Read with the table's first batch: only a migration writes the mark, and
    // only the pull after this push clears it.
    let unpulled: Map<string, unknown> | undefined;
    for (;;) {
      assertActive(token);
      const events = await sqlite.getAllAsync<{ id: number; payload: string; row_id: string }>(
        `SELECT id, payload, row_id FROM outbox WHERE table_name = ? ORDER BY id ASC LIMIT ${PUSH_BATCH}`,
        [table],
      );
      if (events.length === 0) break;
      unpulled ??= await unpulledOf(sqlite, table);
      // Keep only the newest event per row. Invalid/cross-account payloads are
      // quarantined below; they are never silently discarded or sent under the
      // wrong RLS identity.
      const { rejected, pushedEvents, rows } = prepareOutboundBatch(table, events, userId, {
        ...outboundPolicy(table),
        unpulled,
      });
      const acknowledged: Record<string, unknown>[] = [];
      // One statement gives every row the same columns, and PostgREST writes
      // null into one a row lacks, so a run of rows of one shape goes at a
      // time; runs keep the batch's order. Every row has one shape unless a
      // column is `unpulled`.
      const send = (run: Record<string, unknown>[]) =>
        supabase
          .from(table)
          // prepareOutboundBatch performs table-aware runtime validation. This
          // cast is the one dynamic-table bridge into generated Supabase types.
          .upsert(run as SyncedInsert[], { onConflict: "id" })
          .select("*")
          .abortSignal(token.signal);
      for (const run of runsOfOneShape(rows)) {
        assertActive(token);
        let { data, error } = await send(run);
        if (error?.code === "23514") {
          const level = await atServerGeneration(table, run, token);
          if (level) ({ data, error } = await send(level));
        }
        if (error) throw new Error(`push ${table}: ${error.message}`);
        const answered = (data ?? []) as Record<string, unknown>[];
        if (answered.length !== run.length) throw new Error(`push ${table}: incomplete acknowledgement`);
        acknowledged.push(...answered);
      }
      // A sign-out/account switch may have happened while PostgREST was in
      // flight. Never clear the local outbox for a stale session response.
      assertActive(token);
      const eventByRow = new Map<string, ParsedOutboxEvent>(pushedEvents.map((event) => [event.row_id, event]));
      const allowed = outboundPolicy(table).allowedColumns;
      await withTransaction(async () => {
        assertActive(token);
        const newestByRow = await newestOutboxIds(sqlite, table, pushedEvents.map((event) => event.row_id));
        for (const raw of acknowledged) {
          const remote = validatedRemoteRow(table, raw, userId);
          const pushed = eventByRow.get(remote.id as string);
          if (!pushed) throw new Error(`push ${table}: unknown acknowledgement`);
          if (shouldApplyServerAck(pushed.id, newestByRow.get(pushed.row_id) ?? null)) {
            await upsertLocal(table, remote, allowed);
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

/** Set when the server answers "no such function", so a sync does not rediscover it; not persisted, so the next launch sees an applied migration. */
let changeProbeUnavailable = false;

/** Each table's keyset head in one request; null (pull every table) when the probe is unusable. A table the answer omits is pulled too: the function's table list is a copy that can fall behind. */
async function fetchServerHeads(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  token: SessionEpochToken,
): Promise<Map<string, PullCursor | null> | null> {
  if (changeProbeUnavailable) return null;
  const { data, error } = await supabase.rpc("sync_cursors").abortSignal(token.signal);
  if (error) {
    // PGRST202 (no such function) alone degrades quietly; an auth or network error must reach `runSync` for the refresh and backoff.
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
  // One read for every cursor.
  const cursorRows = await sqlite.getAllAsync<{ table_name: string; last_pulled_at: string }>(
    `SELECT table_name, last_pulled_at FROM sync_state`,
    [],
  );
  const cursors = new Map(cursorRows.map((row) => [row.table_name, parsePullCursor(row.last_pulled_at)]));
  const cursorFor = (table: SyncedTableName): PullCursor => cursors.get(table) ?? parsePullCursor(null);

  assertActive(token);
  // A workspace that has never pulled has nothing to skip, so the probe would only add a round trip.
  const heads = PULL_ORDER.some((table) => cursorFor(table).ts !== PULL_EPOCH)
    ? await fetchServerHeads(supabase, token)
    : null;
  // Parents before children, `settings` first: its `onboarded` flag releases the first-pull wait. The local
  // schema has no foreign key, so the order only keeps a pull cut short from leaving a child ahead of its parent.
  const pending = PULL_ORDER.filter((table) =>
    !heads || !heads.has(table) || !cursorIsAtServerHead(cursorFor(table), heads.get(table) ?? null));

  // Cursor is a keyset on (updated_at, id) encoded as "ts|id"; a plain ISO
  // string is the legacy form (id empty). A composite cursor is required so a
  // page boundary that splits rows sharing one updated_at never skips them.
  const fetchPage = (table: SyncedTableName, { ts, id }: PullCursor) => {
    const query = supabase
      .from(table)
      .select("*")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PULL_PAGE);
    return Promise.resolve(
      (id
        ? query.or(`updated_at.gt.${ts},and(updated_at.eq.${ts},id.gt.${id})`)
        // A legacy cursor has no id tie-breaker. Include its timestamp once so
        // rows sharing that timestamp are recovered during the migration to
        // the composite cursor; the LWW merge makes the replay idempotent.
        : query.gte("updated_at", ts)
      ).abortSignal(token.signal),
    );
  };
  // Every first page is asked for at once and only the merge is ordered. A page never merged is
  // dropped without an unhandled rejection: PostgREST answers a failed or aborted fetch with `{ error }`.
  const firstPages = new Map(pending.map((table) => [table, fetchPage(table, cursorFor(table))] as const));

  for (const table of pending) {
    assertActive(token);
    const allowed = outboundPolicy(table).allowedColumns;
    let { ts: curTs, id: curId } = cursorFor(table);
    let next = firstPages.get(table)!;
    for (;;) {
      const { data, error } = await next;
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
          await upsertLocal(table, remote, allowed);
        }
        const last = remoteRows[remoteRows.length - 1];
        if (!last) throw new Error(`pull ${table}: empty validated page`);
        assertActive(token);
        curTs = cursorInstant(String((data[data.length - 1] as Record<string, unknown>).updated_at));
        curId = last.id as string;
        await sqlite.runAsync(
          `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
           ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
          [table, formatPullCursor({ ts: curTs, id: curId })],
        );
      });
      if (data.length < PULL_PAGE) break;
      next = fetchPage(table, { ts: curTs, id: curId });
    }
  }
  // Every row is now the server's, except one edited since, which the merge
  // kept, or refused and held to retry: its table stays unpulled until that
  // edit is sent or let go.
  await sqlite.runAsync(
    "DELETE FROM sync_state WHERE table_name LIKE ? AND substr(table_name, ?) NOT IN (SELECT table_name FROM outbox UNION SELECT table_name FROM sync_dead_letters)",
    [`${UNPULLED}%`, UNPULLED.length + 1],
  );
  return superseded;
}

let syncing = false;
let rerunRequestedFor: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
let inFlight: Promise<boolean> | null = null;
const sessionTasks = new Set<Promise<unknown>>();

function clearScheduledSync(): void {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  debounceTimer = undefined;
  retryTimer = undefined;
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

/** Screen counts go through a database function because deltas are added to what is there; an upsert would replace them. */
function usageUploadPort(): UsageUploadPort {
  return {
    async record(deltas) {
      const client = getSupabase();
      if (!client) throw new Error("unconfigured");
      const { error } = await client.rpc("record_usage", { events: deltas });
      if (error) throw new Error(error.message);
    },
  };
}

/** The only writer of `diagnostic_events`; `ignoreDuplicates` lets a device re-send its whole ring without failing the batch. */
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
    // Same piggyback, same contract: it reports nothing, it cannot fail this
    // sync, and a refused call simply leaves the counts for the next one.
    void reportUsage(usageUploadPort());
    // The retention window is enforced here: there is no scheduler, and the calls only reach rows already past it.
    // The rejection handler is for a transport that rejects, which would be recorded as a crash.
    void getSupabase()?.rpc("purge_expired_diagnostics").then(undefined, () => {});
    void getSupabase()?.rpc("purge_usage_counters").then(undefined, () => {});
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
        clearTimeout(retryTimer);
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
    clearTimeout(retryTimer);
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
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void syncNow(requestedUser), 250);
    }
  }
}

/** Re-exported so the auth layer reaches sync through this module alone: importing `attachment-mirror` directly loads the database layer its tests mock this module to avoid. */
export { eraseDeviceAttachments, purgeRemoteAttachments, reconcileAttachments, unsentAttachments };

/** Debounced trigger for after-write sync (UI never waits on this). */
export function scheduleSync(userId: string, delayMs = 1500): void {
  if (!sessionEpoch.capture(userId)) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(userId), delayMs);
}
