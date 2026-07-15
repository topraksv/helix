import { getTableColumns } from "drizzle-orm";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { tr } from "../i18n/tr";

export const EXPORT_VERSION = 1;
export const MAX_BACKUP_BYTES = 15 * 1024 * 1024;
const MAX_BACKUP_ROWS = 100_000;

export interface ExportBundle {
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

const DATE_COLUMNS = new Set([
  "entry_date",
  "effective_date",
  "next_due_date",
  "canceled_at",
  "trial_end_date",
  "effective_from",
  "due_date",
  "paid_at",
  "date",
  "rate_date",
]);

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isMonthKey(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Validate a restore row completely before any database write begins. */
export function isValidImportRow(table: SyncedTableName, raw: Record<string, unknown>): boolean {
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 200) return false;
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    const value = raw[column.name];
    if (value == null) {
      if (column.notNull) return false;
      continue;
    }
    if (column.columnType === "SQLiteInteger" && !Number.isSafeInteger(value)) return false;
    if (column.columnType === "SQLiteBoolean" && value !== 0 && value !== 1 && typeof value !== "boolean") return false;
    if (column.dataType === "string" && typeof value !== "string") return false;
    if (column.enumValues && !column.enumValues.includes(value as never)) return false;
    if (typeof value === "string" && value.length > 50_000) return false;
  }
  if (!isIsoTimestamp(raw.created_at) || !isIsoTimestamp(raw.updated_at)) return false;
  if (raw.deleted_at != null && !isIsoTimestamp(raw.deleted_at)) return false;
  for (const key of DATE_COLUMNS) {
    if (key in raw && raw[key] != null && !isIsoDate(raw[key])) return false;
  }
  if ("start_month" in raw && !isMonthKey(raw.start_month)) return false;
  if ("month" in raw && !isMonthKey(raw.month)) return false;
  for (const key of ["due_day", "statement_day", "billing_day", "pay_day"]) {
    const value = raw[key];
    if (value != null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31)) return false;
  }
  if (table === "settings") {
    try {
      JSON.parse(String(raw.value));
    } catch {
      return false;
    }
  }
  return true;
}

export function validateExportBundle(raw: unknown): ExportBundle {
  if (!raw || typeof raw !== "object") throw new Error(tr.errors.invalidBackupFile);
  const bundle = raw as Partial<ExportBundle>;
  if (
    bundle.version !== EXPORT_VERSION ||
    !bundle.tables ||
    typeof bundle.tables !== "object" ||
    !isIsoTimestamp(bundle.exportedAt)
  ) {
    throw new Error(tr.errors.invalidBackupFile);
  }
  let totalRows = 0;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const rows = bundle.tables[table];
    if (rows == null) continue;
    if (!Array.isArray(rows)) throw new Error(tr.errors.invalidBackupFile);
    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS) throw new Error(tr.errors.backupTooLarge);
    if (rows.some((row) => !row || typeof row !== "object" || !isValidImportRow(table, row))) {
      throw new Error(tr.errors.invalidBackupFile);
    }
  }
  return bundle as ExportBundle;
}

/** Parse a picked backup with a hard pre-JSON size bound. */
export function parseExportBundleText(content: string): ExportBundle {
  if (content.length > MAX_BACKUP_BYTES) throw new Error(tr.errors.backupTooLarge);
  try {
    return validateExportBundle(JSON.parse(content));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === tr.errors.backupTooLarge || error.message === tr.errors.invalidBackupFile)
    ) {
      throw error;
    }
    throw new Error(tr.errors.invalidBackupFile);
  }
}
