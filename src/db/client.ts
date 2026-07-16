/**
 * Single DB entry point — async-only access on every platform.
 *
 * Web rationale: expo-sqlite's synchronous bridge needs SharedArrayBuffer
 * (COOP/COEP headers, a service-worker reload) and busy-waits on the main
 * thread, which froze or white-screened phones. The async API is plain
 * message passing: no isolation requirements, no main-thread spinning, works
 * in every mobile browser. Native simply gets a non-blocking driver.
 *
 * Drizzle connects through the generic sqlite-proxy driver, so queries stay
 * type-safe while executing over the async API.
 */

import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteBindParams, type SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as schema from "./schema";

const DB_NAME = "helix.db";

let handle: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DB_NAME, { enableChangeListener: true });
  // WAL needs shared-memory VFS hooks that wa-sqlite's OPFS backend lacks.
  if (Platform.OS !== "web") await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");
  return db;
}

/**
 * Move a corrupt database aside instead of deleting it. On native the file is
 * renamed (`helix.corrupt-<ts>.db`) so the data can still be recovered by
 * hand — a permanent loss otherwise in local-only (unsynced) mode. Orphan
 * WAL/SHM files are removed so they can't attach to the fresh database. Web's
 * OPFS backend exposes no rename here, so delete remains the only option
 * (sync re-hydrates from the cloud on the next pull).
 */
async function setAsideCorruptDb(): Promise<void> {
  if (Platform.OS === "web") {
    await deleteDatabaseAsync(DB_NAME);
    return;
  }
  try {
    const dir = new Directory(Paths.document, "SQLite");
    const main = new File(dir, DB_NAME);
    if (main.exists) main.move(new File(dir, `helix.corrupt-${Date.now()}.db`));
    for (const suffix of ["-wal", "-shm"]) {
      const side = new File(dir, `${DB_NAME}${suffix}`);
      if (side.exists) side.delete();
    }
  } catch {
    await deleteDatabaseAsync(DB_NAME); // fall back to the old behavior
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Open the database, tolerating two transient failure modes seen at launch:
 *   • "not a database" — a corrupt header; move it aside once and recreate.
 *   • an OPFS access-handle still held by the *previous* page's sqlite worker
 *     on web (the exclusive SyncAccessHandle hasn't been released yet). This
 *     surfaced as the intermittent "Tekrar dene" screen that a plain refresh
 *     often couldn't clear ("only got in by luck"). Back off briefly and retry
 *     a few times before giving up so the lock has time to release.
 */
async function openWithRetry(): Promise<SQLiteDatabase> {
  const maxAttempts = 6;
  let lastErr: unknown;
  let recoveredCorrupt = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await open();
    } catch (e) {
      lastErr = e;
      if (String(e).includes("not a database") && !recoveredCorrupt) {
        recoveredCorrupt = true;
        await setAsideCorruptDb();
        continue; // retry immediately after moving the corrupt file aside
      }
      await delay(150 * (attempt + 1)); // ~150ms → ~750ms backoff for a held lock
    }
  }
  throw lastErr;
}

export function getSqliteAsync(): Promise<SQLiteDatabase> {
  if (!handle) {
    handle = openWithRetry();
    handle.catch(() => {
      handle = null; // allow a later retry instead of caching the failure
    });
  }
  return handle;
}

// Web: release the OPFS access handle when the page goes away so the next load
// (or a refresh) can immediately re-acquire it instead of racing a still-open
// worker. Best-effort — the page is unloading, so we don't await.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const closeDb = () => {
    const current = handle;
    handle = null;
    void current?.then((db) => db.closeAsync()).catch(() => {});
  };
  window.addEventListener("pagehide", closeDb);
  window.addEventListener("beforeunload", closeDb);
}

/**
 * Serialize every DB transaction through one queue. expo-sqlite's async driver
 * shares a single connection, and two overlapping `withTransactionAsync` calls
 * issue nested BEGINs → "cannot start a transaction within a transaction",
 * which wedged the worker (this surfaced as an infinite re-render / white
 * screen right after sign-in, when maintenance + the initial sync pull ran at
 * once). Callers MUST route transactions through here rather than calling
 * `db.withTransactionAsync` directly. Tasks never nest (no task opens another
 * transaction), so this can't deadlock.
 */
let txChain: Promise<void> = Promise.resolve();
export async function withTransaction(task: () => Promise<void>): Promise<void> {
  const prev = txChain;
  let release!: () => void;
  txChain = new Promise<void>((resolve) => (release = resolve));
  try {
    await prev;
    const db = await getSqliteAsync();
    await db.withTransactionAsync(task);
  } finally {
    release();
  }
}

/** sqlite-proxy expects raw value arrays; expo-sqlite provides them directly. */
async function exec(
  sql: string,
  params: unknown[],
  method: "run" | "all" | "get" | "values",
): Promise<{ rows: unknown[] }> {
  const db = await getSqliteAsync();
  if (method === "run") {
    await db.runAsync(sql, params as SQLiteBindParams);
    return { rows: [] };
  }
  const statement = await db.prepareAsync(sql);
  try {
    const result = await statement.executeForRawResultAsync(params as SQLiteBindParams);
    const rows = await result.getAllAsync();
    return { rows: method === "get" ? (rows[0] ?? []) : rows };
  } finally {
    await statement.finalizeAsync();
  }
}

const database = drizzle(exec, { schema });

export function getDb() {
  return database;
}
