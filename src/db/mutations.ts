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
import type { SQLiteBindValue, SQLiteDatabase } from "expo-sqlite";
import { getSqliteAsync, withTransaction } from "./client";
import { SYNCED_TABLES, type SyncedTableName } from "./schema";
import type { AnySettingKey } from "../domain/settings";
import { deterministicId, naturalKeys } from "./ids";
import { convertOutboundRow } from "../sync/outbound-validation";
import { resolveTombstoneVersion } from "../sync/tombstone-policy";

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

/**
 * Columns an upsert may never rewrite on the UPDATE branch.
 *
 * `created_at` is insert-only by definition, but it used to be in the
 * `DO UPDATE SET` list. Combined with the `createdAt: row.createdAt ?? timestamp`
 * stamp below, that meant every builder which constructs a row LITERAL rather
 * than spreading `fromDbShape(previous)` silently reset the row's creation time
 * on each edit — budgets, subscription/income rules, expected-payment confirms
 * and the maintenance re-upserts all did. `transactions.ts` worked around it by
 * reading and re-supplying `created_at`, which is a per-caller fix for a
 * property of the write layer.
 *
 * Excluding it here fixes every caller at once, and makes the value truthful
 * for `maintenance.ts`'s `ORDER BY created_at ASC` duplicate-self repair. `id`
 * is excluded for the obvious reason: it is the conflict target.
 */
const UPSERT_IMMUTABLE_COLUMNS = new Set(["id", "created_at"]);

export function upsertSql(table: SyncedTableName, dbRow: Record<string, unknown>): { sql: string; args: SQLiteBindValue[] } {
  const keys = Object.keys(dbRow);
  const placeholders = keys.map(() => "?").join(", ");
  const updates = keys
    .filter((k) => !UPSERT_IMMUTABLE_COLUMNS.has(k))
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");
  return {
    // A route/form may hold a stale row across an account boundary. Stamping
    // `user_id` is not enough: without this conflict predicate, the upsert
    // would turn an existing A row with the same id into a B row before RLS
    // ever sees it. The zero-change result is treated as an ownership error by
    // `persist` below.
    sql: `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates} WHERE ${table}.user_id = excluded.user_id`,
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
  await writeRowBatchesAtomically(userId, [writes], isUserEntry);
}

type WriteRowsValidator = (sqlite: SQLiteDatabase) => Promise<void>;

/**
 * An edit may race a remote delete while its form is open. Keep that stale
 * snapshot from reviving a tombstone; explicit restore flows use `restoreRow`
 * and remain the only way to bring a deleted record back.
 */
export async function assertLiveRow(
  sqlite: SQLiteDatabase,
  table: SyncedTableName,
  userId: string,
  id: string,
): Promise<void> {
  const row = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId],
  );
  if (!row) throw new Error(`Cannot edit missing ${table} row`);
}

/**
 * Explicit undo is allowed to clear only a tombstone owned by this session.
 * A snapshot can outlive its screen or arrive from a stale callback; letting
 * `writeRows` stamp it with the caller's user id would otherwise insert a
 * missing row (or overwrite a later row with the same id) as a new restore.
 */
export async function assertRestorableRows(
  sqlite: SQLiteDatabase,
  userId: string,
  writes: readonly RowWrite[],
): Promise<void> {
  for (const write of writes) {
    const id = write.row.id;
    if (typeof id !== "string" || id === "" || write.row.userId !== userId) {
      throw new Error(`Cannot restore ${write.table} row from another account`);
    }
    const existing = await sqlite.getFirstAsync<{ user_id: string; deleted_at: string | null }>(
      `SELECT user_id, deleted_at FROM ${write.table} WHERE id = ?`,
      [id],
    );
    if (!existing || existing.user_id !== userId || existing.deleted_at == null) {
      throw new Error(`Cannot restore ${write.table} row without its tombstone`);
    }
  }
}

/** Run a domain invariant check inside the same serialized transaction that
 * persists the proposed rows. No competing local write can land between the
 * check and the outbox-backed commit. */
export async function writeRowsValidated(
  userId: string,
  writes: RowWrite[],
  validate: WriteRowsValidator,
  isUserEntry = true,
): Promise<void> {
  await writeRowBatchesAtomically(userId, [writes], isUserEntry, validate);
}

/** Restore one semantic undo unit only after every target passes the restore boundary. */
export async function restoreRows(
  userId: string,
  writes: RowWrite[],
  validate?: WriteRowsValidator,
): Promise<void> {
  await writeRowsValidated(userId, writes, async (sqlite) => {
    await assertRestorableRows(sqlite, userId, writes);
    await validate?.(sqlite);
  });
}

/**
 * Consume bounded batches inside one transaction. Large restores therefore do
 * not allocate a second full stamped/write-plan copy, while preserving the
 * all-or-nothing row + outbox contract.
 */
export async function writeRowBatchesAtomically(
  userId: string,
  batches: Iterable<readonly RowWrite[]>,
  isUserEntry = true,
  validate?: WriteRowsValidator,
  validateAfter?: WriteRowsValidator,
): Promise<void> {
  const lastEntryId = isUserEntry
    ? await deterministicId(naturalKeys.setting(userId, "last_entry_at"))
    : null;
  const sqlite = await getSqliteAsync();
  await withTransaction(async () => {
    if (validate) await validate(sqlite);
    interface ExistingRowState {
      userId: string;
      deletedAt: string | null;
      tombstoneVersion: number;
    }
    const stateKey = (table: SyncedTableName, id: string) => `${table}\u0000${id}`;
    const loadBatchState = async (batch: readonly RowWrite[]): Promise<Map<string, ExistingRowState>> => {
      const state = new Map<string, ExistingRowState>();
      const idsByTable = new Map<SyncedTableName, string[]>();
      for (const write of batch) {
        if (typeof write.row.id !== "string" || write.row.id === "") {
          throw new Error(`Write row id is invalid in ${write.table}`);
        }
        const ids = idsByTable.get(write.table) ?? [];
        ids.push(write.row.id);
        idsByTable.set(write.table, ids);
      }
      for (const [table, rawIds] of idsByTable) {
        const ids = [...new Set(rawIds)];
        for (let offset = 0; offset < ids.length; offset += 400) {
          const chunk = ids.slice(offset, offset + 400);
          const rows = await sqlite.getAllAsync<{
            id: string;
            user_id: string;
            deleted_at: string | null;
            tombstone_version: number;
          }>(
            `SELECT id, user_id, deleted_at, tombstone_version FROM ${table}
             WHERE id IN (${chunk.map(() => "?").join(", ")})`,
            chunk,
          );
          for (const existing of rows) {
            state.set(stateKey(table, existing.id), {
              userId: existing.user_id,
              deletedAt: existing.deleted_at,
              tombstoneVersion: existing.tombstone_version,
            });
          }
        }
      }
      return state;
    };
    const persist = async (
      table: SyncedTableName,
      row: Record<string, unknown>,
      states: Map<string, ExistingRowState>,
    ) => {
      const timestamp = nowIso();
      const id = String(row.id);
      const key = stateKey(table, id);
      const existing = states.get(key);
      if (existing && existing.userId !== userId) {
        throw new Error(`Write ownership conflict in ${table}`);
      }
      const requestedDeletedAt = "deletedAt" in row
        ? (row.deletedAt == null ? null : String(row.deletedAt))
        : (existing?.deletedAt ?? null);
      const requestedVersion = Number.isSafeInteger(row.tombstoneVersion) && Number(row.tombstoneVersion) >= 0
        ? Number(row.tombstoneVersion)
        : 0;
      const tombstoneVersion = resolveTombstoneVersion(existing ?? null, requestedDeletedAt, requestedVersion);
      const dbRow = toDbShape(table, {
        ...row,
        updatedAt: timestamp,
        createdAt: row.createdAt ?? timestamp,
        userId,
        deletedAt: requestedDeletedAt,
        tombstoneVersion,
      });
      const { sql, args } = upsertSql(table, dbRow);
      const result = await sqlite.runAsync(sql, args);
      if (result.changes !== 1) throw new Error(`Write ownership conflict in ${table}`);
      // On an idempotency-key collision (two writes to the same row within the
      // same millisecond) the payload must be REPLACED, not ignored — otherwise
      // the stale first snapshot gets pushed and LWW echoes it back over the
      // newer local value.
      //
      // The key carries the table because the unique index on it is global.
      // Without that prefix, two rows in different tables sharing an id and a
      // millisecond collapse into one event and the second row silently never
      // syncs. Ordinary writes cannot produce such a pair — `deterministicId`
      // namespaces every natural key and everything else is uuidv7 — but a
      // restore writes ids taken from the backup file, so the collision is
      // reachable from input this process does not control.
      await sqlite.runAsync(
        `INSERT INTO outbox (table_name, row_id, op, payload, idempotency_key, created_at)
         VALUES (?, ?, 'upsert', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
        [table, String(dbRow.id), JSON.stringify(dbRow), `${table}:${dbRow.id}:${dbRow.updated_at}`, nowIso()],
      );
      states.set(key, { userId, deletedAt: requestedDeletedAt, tombstoneVersion });
    };
    for (const batch of batches) {
      const states = await loadBatchState(batch);
      for (const write of batch) await persist(write.table, write.row, states);
    }
    if (lastEntryId) {
      const lastEntryBatch: RowWrite[] = [{
        table: "settings",
        row: {
          id: lastEntryId,
          createdAt: nowIso(),
          deletedAt: null,
          key: "last_entry_at",
          value: JSON.stringify(nowIso()),
        },
      }];
      const states = await loadBatchState(lastEntryBatch);
      const timestamp = nowIso();
      await persist("settings", {
        id: lastEntryId,
        createdAt: timestamp,
        deletedAt: null,
        key: "last_entry_at",
        value: JSON.stringify(timestamp),
      }, states);
    }
    if (validateAfter) await validateAfter(sqlite);
  });
}

/** Rows still waiting to be pushed to the cloud (sign-out safety check). */
export async function pendingOutboxCount(): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`, []);
  return row?.n ?? 0;
}

/**
 * What a retry can honestly report.
 *
 * `unrepairable` is the outcome this used to be missing, and its absence is
 * why the owner could press "Yeniden Dene" for ever and watch the same rows
 * come back. A quarantine says the row the server saw was invalid; retrying
 * queued THE SAME LOCAL ROW again, the next push found it invalid for the same
 * reason, and quarantined it again. The button was a loop with a spinner on it.
 */
export type DeadLetterRetry = "requeued" | "missing" | "unsupported" | "unrepairable";

/**
 * The outbound rules for one table, derived from the schema this build has.
 *
 * The same two sets `sync/engine.ts` builds for its push, so the check here and
 * the check that will actually run cannot disagree — a retry that says "this
 * will be accepted" and then is not would be worse than no check at all.
 */
function outboundPolicy(table: SyncedTableName): { allowedColumns: Set<string>; booleanColumns: Set<string> } {
  const allowedColumns = new Set<string>();
  const booleanColumns = new Set<string>();
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    allowedColumns.add(column.name);
    if (column.columnType === "SQLiteBoolean") booleanColumns.add(column.name);
  }
  return { allowedColumns, booleanColumns };
}

/**
 * Requeue the current local version of a quarantined row (spec §5).
 *
 * The dead letter stores the rejected snapshot for forensics, not as an
 * editable source of truth. Retrying that raw payload would repeat the same
 * validation failure, so this reads the current owned row and lets the normal
 * write boundary create a fresh outbox event. A missing row keeps its dead
 * letter: dropping the only local recovery clue would be data loss.
 *
 * And it now checks BEFORE it queues. `convertOutboundRow` is the same gate the
 * push runs, so if the current row would fail it again, nothing is queued and
 * the caller is told the row itself needs changing — which is a thing a person
 * can actually do, unlike pressing the same button a fourth time.
 */
export async function requeueSyncDeadLetter(
  userId: string,
  deadLetterId: number,
): Promise<DeadLetterRetry> {
  const sqlite = await getSqliteAsync();
  const dead = await sqlite.getFirstAsync<{ table_name: string; row_id: string }>(
    `SELECT table_name, row_id FROM sync_dead_letters WHERE id = ?`,
    [deadLetterId],
  );
  if (!dead) return "missing";
  if (!Object.prototype.hasOwnProperty.call(SYNCED_TABLES, dead.table_name)) return "unsupported";
  const table = dead.table_name as SyncedTableName;
  const current = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND user_id = ?`,
    [dead.row_id, userId],
  );
  if (!current) return "missing";
  // Checked against a COPY: `convertOutboundRow` coerces the row it is handed,
  // and the local row must not be edited by a question about it.
  if (!convertOutboundRow(table, { ...current }, outboundPolicy(table)).ok) return "unrepairable";

  // Keep the original quarantine until the new outbox write succeeds. If the
  // local database changes between these two operations, the next retry uses
  // the newest snapshot and the old clue remains harmlessly visible.
  await writeRows(userId, [{ table, row: fromDbShape(table, current) }], false);
  await withTransaction(async () => {
    await sqlite.runAsync(`DELETE FROM sync_dead_letters WHERE id = ?`, [deadLetterId]);
  });
  return "requeued";
}

/**
 * Forget one quarantine, without touching the row it points at.
 *
 * The only exit a dead letter had was a retry that could succeed, so a
 * quarantine whose local row no longer exists — the common case after a delete,
 * and every case after a payload from another account — was permanent. It sat
 * on the settings screen for ever, said something alarming about data, and had
 * no button that could make it true again.
 *
 * This deletes the CLUE, never the record: the local row, if there still is
 * one, is untouched and still on the device. Returns whether there was
 * anything to forget, so a caller cannot report success for a no-op.
 */
export async function discardSyncDeadLetter(deadLetterId: number): Promise<boolean> {
  const sqlite = await getSqliteAsync();
  const result = await sqlite.runAsync(`DELETE FROM sync_dead_letters WHERE id = ?`, [deadLetterId]);
  return result.changes > 0;
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
  await restoreRows(userId, [{ table, row: { ...fromDbShape(table, snapshot), deletedAt: null } }]);
}

/** snake_case DB row → camelCase Drizzle shape. */
export function fromDbShape(table: SyncedTableName, dbRow: object): Record<string, unknown> {
  // `object`, not `Record<string, unknown>`: a typed `SELECT` result is an
  // interface, and TypeScript refuses those to an index signature. Every call
  // site therefore carried an `as unknown as` — the strongest cast the
  // language has, spent on a technicality, in the write paths where a real one
  // would be most expensive to miss. The one narrowing lives here instead.
  const source = dbRow as Record<string, unknown>;
  const columns = getTableColumns(SYNCED_TABLES[table]);
  const out: Record<string, unknown> = {};
  for (const [tsKey, column] of Object.entries(columns)) {
    if (column.name in source) out[tsKey] = source[column.name];
  }
  return out;
}

/** Read a setting value (JSON-decoded) or null. */
export async function readSetting<T>(userId: string, key: AnySettingKey): Promise<T | null> {
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

/**
 * One settings row, ready for `writeRows`. Exposed so callers that write
 * SEVERAL settings which are a single semantic unit can put them in one
 * transaction instead of chaining `writeSetting` calls — a failure between two
 * such calls leaves the pair half-applied.
 */
export async function settingRow(userId: string, key: string, value: unknown): Promise<RowWrite> {
  const id = await deterministicId(naturalKeys.setting(userId, key));
  return { table: "settings", row: { id, key, value: JSON.stringify(value), deletedAt: null } };
}

export async function writeSetting(userId: string, key: AnySettingKey, value: unknown, isUserEntry = false): Promise<void> {
  await writeRows(userId, [await settingRow(userId, key, value)], isUserEntry);
}
