/**
 * Single DB entry point. Everything reads/writes through here so the driver
 * can be swapped (expo-sqlite native / wasm on web / sqlocal fallback)
 * without touching schema or queries.
 */

import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema";

export const DB_NAME = "helix.db";

let sqlite: SQLiteDatabase | null = null;
let database: ReturnType<typeof createDb> | null = null;

function createDb(handle: SQLiteDatabase) {
  return drizzle(handle, { schema });
}

export function getSqlite(): SQLiteDatabase {
  if (!sqlite) {
    sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
    sqlite.execSync("PRAGMA journal_mode = WAL;");
    sqlite.execSync("PRAGMA foreign_keys = ON;");
  }
  return sqlite;
}

export function getDb() {
  if (!database) database = createDb(getSqlite());
  return database;
}

export type Db = ReturnType<typeof getDb>;
