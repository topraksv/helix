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
import * as schema from "./schema";

export const DB_NAME = "helix.db";

let handle: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DB_NAME, { enableChangeListener: true });
  // WAL needs shared-memory VFS hooks that wa-sqlite's OPFS backend lacks.
  if (Platform.OS !== "web") await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");
  return db;
}

export function getSqliteAsync(): Promise<SQLiteDatabase> {
  if (!handle) {
    handle = (async () => {
      try {
        return await open();
      } catch (e) {
        // "not a database" = corrupt OPFS header (e.g. an old build's reload
        // killed the worker mid-create). Nothing readable to save — recreate.
        if (!String(e).includes("not a database")) throw e;
        await deleteDatabaseAsync(DB_NAME);
        return open();
      }
    })();
    handle.catch(() => {
      handle = null; // allow a later retry instead of caching the failure
    });
  }
  return handle;
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

export type Db = ReturnType<typeof getDb>;
