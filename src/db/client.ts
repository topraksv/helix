/**
 * Single DB entry point. Everything reads/writes through here so the driver
 * can be swapped (expo-sqlite native / wasm on web / sqlocal fallback)
 * without touching schema or queries.
 */

import { deleteDatabaseAsync, openDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { Platform } from "react-native";
import * as schema from "./schema";

export const DB_NAME = "helix.db";

/**
 * Web only — must resolve before the first getSqlite() call. The sync API's
 * worker bridge busy-waits a bounded number of spins for the response; on a
 * cold load the worker (JS + wasm) isn't booted yet, so the first sync call
 * throws "Sync operation timeout". Opening through the async API first boots
 * the worker, after which sync opens respond within the spin budget.
 */
export async function warmupDb(): Promise<void> {
  if (Platform.OS !== "web") return;
  try {
    const handle = await openDatabaseAsync(DB_NAME);
    await handle.closeAsync();
  } catch (e) {
    // "not a database" = the OPFS file was left with a corrupt header (e.g. a
    // page reload killed the worker mid-create). There is nothing readable to
    // save — recreate the file once instead of bricking the app forever.
    if (!String(e).includes("not a database")) throw e;
    await deleteDatabaseAsync(DB_NAME);
    const handle = await openDatabaseAsync(DB_NAME);
    await handle.closeAsync();
  }
}

let sqlite: SQLiteDatabase | null = null;
let database: ReturnType<typeof createDb> | null = null;

function createDb(handle: SQLiteDatabase) {
  return drizzle(handle, { schema });
}

export function getSqlite(): SQLiteDatabase {
  if (!sqlite) {
    sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
    // WAL needs the shared-memory VFS hooks that wa-sqlite's OPFS backend
    // doesn't provide — only ask for it on native.
    if (Platform.OS !== "web") sqlite.execSync("PRAGMA journal_mode = WAL;");
    sqlite.execSync("PRAGMA foreign_keys = ON;");
  }
  return sqlite;
}

export function getDb() {
  if (!database) database = createDb(getSqlite());
  return database;
}

export type Db = ReturnType<typeof getDb>;
