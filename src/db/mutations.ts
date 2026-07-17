/**
 * Write layer. EVERY user-initiated mutation goes through `writeRows` so
 * that, atomically (single SQLite transaction):
 *   1. the row is upserted locally (UI reacts instantly — never waits on net)
 *   2. an outbox event is queued for sync (idempotency key = rowId:updatedAt)
 *   3. settings.last_entry_at advances (catch-up banner source)
 * Deletes are tombstones (`deleted_at`), never hard deletes, which also
 * powers undo.
 */

import { getTableColumns } from "drizzle-orm";
import type { SQLiteBindValue } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "./client";
import { SYNCED_TABLES, type SyncedTableName } from "./schema";
import { deterministicId, naturalKeys } from "./ids";

export interface RowWrite {
  table: SyncedTableName;
  /** Full row in Drizzle (camelCase) shape, including id/userId/timestamps. */
  row: Record<string, unknown>;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Wipe every synced table + the outbox + sync cursors. Used when a *different*
 * account signs in on this device: the cloud (RLS-scoped) is the source of
 * truth, so clearing local state prevents the previous account's rows from
 * being pushed under the new session (which would violate row-level security).
 */
export async function resetLocalWorkspace(): Promise<void> {
  const sqlite = await getSqliteAsync();
  await withTransaction(async () => {
    for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
      await sqlite.runAsync(`DELETE FROM ${table}`, []);
    }
    await sqlite.runAsync(`DELETE FROM outbox`, []);
    await sqlite.runAsync(`DELETE FROM sync_dead_letters`, []);
    await sqlite.runAsync(`DELETE FROM sync_state`, []);
  });
}

/** camelCase Drizzle row → snake_case DB/remote payload. */
function toDbShape(table: SyncedTableName, row: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(SYNCED_TABLES[table]);
  const out: Record<string, unknown> = {};
  for (const [tsKey, column] of Object.entries(columns)) {
    if (tsKey in row) out[column.name] = row[tsKey] ?? null;
  }
  return out;
}

function upsertSql(table: SyncedTableName, dbRow: Record<string, unknown>): { sql: string; args: SQLiteBindValue[] } {
  const keys = Object.keys(dbRow);
  const placeholders = keys.map(() => "?").join(", ");
  const updates = keys
    .filter((k) => k !== "id")
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");
  return {
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    args: keys.map((k) => normalizeForSqlite(dbRow[k])),
  };
}

/** The one dynamic-row boundary where values arrive as `unknown` (drizzle-
 *  shaped rows are string/number/null after this normalization) — the single
 *  narrow cast that replaced the old blanket `as never[]` on every SQL call. */
function normalizeForSqlite(value: unknown): SQLiteBindValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value as SQLiteBindValue;
}

/**
 * Atomic multi-row write + outbox + last_entry_at bump.
 * `isUserEntry=false` for machine writes (fx cache, sync merges are separate).
 */
export async function writeRows(userId: string, writes: RowWrite[], isUserEntry = true): Promise<void> {
  const stamped = writes.map(({ table, row }) => ({
    table,
    row: { ...row, updatedAt: nowIso(), createdAt: row.createdAt ?? nowIso(), userId },
  }));

  const entries: { table: SyncedTableName; dbRow: Record<string, unknown> }[] = stamped.map((w) => ({
    table: w.table,
    dbRow: toDbShape(w.table, w.row),
  }));

  if (isUserEntry) {
    const id = await deterministicId(naturalKeys.setting(userId, "last_entry_at"));
    entries.push({
      table: "settings",
      dbRow: toDbShape("settings", {
        id,
        userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
        key: "last_entry_at",
        value: JSON.stringify(nowIso()),
      }),
    });
  }

  const sqlite = await getSqliteAsync();
  await withTransaction(async () => {
    for (const { table, dbRow } of entries) {
      const { sql, args } = upsertSql(table, dbRow);
      await sqlite.runAsync(sql, args);
      // On an idempotency-key collision (two writes to the same row within the
      // same millisecond) the payload must be REPLACED, not ignored — otherwise
      // the stale first snapshot gets pushed and LWW echoes it back over the
      // newer local value.
      await sqlite.runAsync(
        `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES (?, ?, 'upsert', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
        [table, String(dbRow.id), JSON.stringify(dbRow), `${dbRow.id}:${dbRow.updated_at}`, nowIso()],
      );
    }
  });
}

/** Rows still waiting to be pushed to the cloud (sign-out safety check). */
export async function pendingOutboxCount(): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`, []);
  return row?.n ?? 0;
}

/** Tombstone delete. Returns the previous row snapshot for undo. */
export async function softDelete(
  userId: string,
  table: SyncedTableName,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sqlite = await getSqliteAsync();
  const previous = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!previous) return null;
  const row = { ...fromDbShape(table, previous), deletedAt: nowIso() };
  await writeRows(userId, [{ table, row }]);
  return previous;
}

/** Restore a snapshot captured before delete/edit (undo). */
export async function restoreRow(
  userId: string,
  table: SyncedTableName,
  snapshot: Record<string, unknown>,
): Promise<void> {
  await writeRows(userId, [{ table, row: { ...fromDbShape(table, snapshot), deletedAt: null } }]);
}

/** snake_case DB row → camelCase Drizzle shape. */
export function fromDbShape(table: SyncedTableName, dbRow: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(SYNCED_TABLES[table]);
  const out: Record<string, unknown> = {};
  for (const [tsKey, column] of Object.entries(columns)) {
    if (column.name in dbRow) out[tsKey] = dbRow[column.name];
  }
  return out;
}

/** Read a setting value (JSON-decoded) or null. */
export async function readSetting<T>(userId: string, key: string): Promise<T | null> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL`,
    [userId, key],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function writeSetting(userId: string, key: string, value: unknown, isUserEntry = false): Promise<void> {
  const id = await deterministicId(naturalKeys.setting(userId, key));
  await writeRows(
    userId,
    [
      {
        table: "settings",
        row: { id, key, value: JSON.stringify(value), deletedAt: null },
      },
    ],
    isUserEntry,
  );
}
