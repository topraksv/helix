/**
 * Outbox sync engine (spec §2.2): push → pull → merge, single instance,
 * last-write-wins on server-normalized `updated_at`. Errors surface in the
 * status store (never swallowed) and retry with exponential backoff.
 */

import { getTableColumns } from "drizzle-orm";
import { getSqliteAsync } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { getSupabase } from "./supabase";
import { useSyncStatus } from "./status";
import { tr } from "../i18n/tr";

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
    if (out[key]) out[key] = new Date(out[key] as string).toISOString();
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

async function pushOutbox(userId: string): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  // Push per table in FK-safe declaration order, oldest events first.
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    for (;;) {
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
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "id" });
        if (error) throw new Error(`push ${table}: ${error.message}`);
      }
      // Clear the whole batch (own rows pushed, foreign rows discarded).
      const maxId = events[events.length - 1].id;
      await sqlite.runAsync(`DELETE FROM outbox WHERE table_name = ? AND id <= ?`, [table, maxId] as never[]);
    }
  }
}

async function pullAndMerge(userId: string): Promise<void> {
  const supabase = getSupabase()!;
  const sqlite = await getSqliteAsync();
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const cursorRow = await sqlite.getFirstAsync<{ last_pulled_at: string }>(
      `SELECT last_pulled_at FROM sync_state WHERE table_name = ?`,
      [table] as never[],
    );
    let cursor = cursorRow?.last_pulled_at ?? "1970-01-01T00:00:00.000Z";
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .gt("updated_at", cursor)
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(PULL_PAGE);
      if (error) throw new Error(`pull ${table}: ${error.message}`);
      if (!data || data.length === 0) break;

      await sqlite.withTransactionAsync(async () => {
        for (const remoteRaw of data) {
          const remote = toLocal(table, remoteRaw as Record<string, unknown>);
          const local = await sqlite.getFirstAsync<{ updated_at: string }>(
            `SELECT updated_at FROM ${table} WHERE id = ?`,
            [remote.id] as never[],
          );
          const remoteWins = !local || Date.parse(remote.updated_at as string) >= Date.parse(local.updated_at);
          if (!remoteWins) continue;
          const keys = Object.keys(remote);
          await sqlite.runAsync(
            `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
             ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`,
            keys.map((k) => (remote[k] === undefined ? null : remote[k])) as never[],
          );
        }
        cursor = new Date((data[data.length - 1] as { updated_at: string }).updated_at).toISOString();
        await sqlite.runAsync(
          `INSERT INTO sync_state (table_name, last_pulled_at) VALUES (?, ?)
           ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
          [table, cursor] as never[],
        );
      });
      if (data.length < PULL_PAGE) break;
    }
  }
  void userId; // RLS scopes the pull; kept for signature clarity
}

let syncing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

export async function syncNow(userId: string, allowRefresh = true): Promise<void> {
  const status = useSyncStatus.getState();
  if (!getSupabase()) {
    status.set({ state: "unconfigured" });
    return;
  }
  if (syncing) return; // single-instance guard
  syncing = true;
  status.set({ state: "syncing" });
  try {
    await pushOutbox(userId);
    await pullAndMerge(userId);
    retryAttempt = 0;
    status.set({ state: "idle", lastSyncAt: new Date().toISOString(), error: null });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[sync]", raw);
    // Expired token → refresh once and retry immediately, no user action.
    if (allowRefresh && isAuthError(raw) && (await tryRefreshSession())) {
      status.set({ state: "syncing" });
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void syncNow(userId, false), 0);
      return;
    }
    status.set({ state: "error", error: friendlySyncError(raw) });
    // Exponential backoff retry: 5s, 10s, 20s… capped at 5 min.
    const delay = Math.min(5000 * 2 ** retryAttempt, 300_000);
    retryAttempt += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void syncNow(userId), delay);
  } finally {
    syncing = false;
  }
}

/** Debounced trigger for after-write sync (UI never waits on this). */
export function scheduleSync(userId: string, delayMs = 1500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(userId), delayMs);
}
