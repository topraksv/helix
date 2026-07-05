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
import { getDb, getSqlite } from "./client";
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

/** camelCase Drizzle row → snake_case DB/remote payload. */
export function toDbShape(table: SyncedTableName, row: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(SYNCED_TABLES[table]);
  const out: Record<string, unknown> = {};
  for (const [tsKey, column] of Object.entries(columns)) {
    if (tsKey in row) out[column.name] = row[tsKey] ?? null;
  }
  return out;
}

function upsertSql(table: SyncedTableName, dbRow: Record<string, unknown>): { sql: string; args: unknown[] } {
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

function normalizeForSqlite(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
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

  const sqlite = getSqlite();
  sqlite.withTransactionSync(() => {
    for (const { table, dbRow } of entries) {
      const { sql, args } = upsertSql(table, dbRow);
      sqlite.runSync(sql, args as never[]);
      sqlite.runSync(
        `INSERT OR IGNORE INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES (?, ?, 'upsert', ?, ?, ?)`,
        [table, String(dbRow.id), JSON.stringify(dbRow), `${dbRow.id}:${dbRow.updated_at}`, nowIso()] as never[],
      );
    }
  });
}

/** Tombstone delete. Returns the previous row snapshot for undo. */
export async function softDelete(
  userId: string,
  table: SyncedTableName,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sqlite = getSqlite();
  const previous = sqlite.getFirstSync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND user_id = ?`,
    [id, userId] as never[],
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
export function readSetting<T>(userId: string, key: string): T | null {
  const row = getSqlite().getFirstSync<{ value: string }>(
    `SELECT value FROM settings WHERE user_id = ? AND key = ? AND deleted_at IS NULL`,
    [userId, key] as never[],
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

export { getDb };
