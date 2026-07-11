/**
 * JSON export/import (backup) + CSV export of transactions. Not an
 * integration: manual backup/restore only (user decision — history is
 * entered in-app, these are safety valves).
 */

import { Platform } from "react-native";
import { getTableColumns } from "drizzle-orm";
import { File, Paths } from "expo-file-system";
import { getSqliteAsync } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { fromDbShape, writeRows } from "../db/mutations";
import { tr } from "../i18n/tr";

const EXPORT_VERSION = 1;

export interface ExportBundle {
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function buildExportBundle(userId: string): Promise<ExportBundle> {
  const sqlite = await getSqliteAsync();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    tables[table] = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [userId] as never[],
    );
  }
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), tables };
}

export async function buildTransactionsCsv(userId: string): Promise<string> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT t.effective_date, t.entry_date, t.type, t.status, t.amount_minor, t.currency, t.amount_try_minor,
            c.name as category, ps.name as source, p.name as person, t.installment_no, t.is_aggregate, t.note
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN payment_sources ps ON ps.id = t.payment_source_id
     LEFT JOIN persons p ON p.id = t.person_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL
     ORDER BY t.effective_date`,
    [userId] as never[],
  );
  // User-entered text cells are sanitized against CSV formula injection
  // (a leading = + @ or tab would execute when opened in Excel).
  const safeCell = (v: unknown) => {
    const s = String(v ?? "").replace(/[\n;]/g, " ");
    return /^[=+@\t-]/.test(s) ? `'${s}` : s;
  };
  const header = "tarih;giris_tarihi;tur;durum;tutar;para_birimi;tutar_try;kategori;kaynak;kisi;taksit_no;toplu;not";
  const lines = rows.map((r) =>
    [
      r.effective_date,
      r.entry_date,
      r.type,
      r.status,
      ((r.amount_minor as number) / 100).toFixed(2).replace(".", ","),
      r.currency,
      ((r.amount_try_minor as number) / 100).toFixed(2).replace(".", ","),
      safeCell(r.category),
      safeCell(r.source),
      safeCell(r.person),
      r.installment_no ?? "",
      r.is_aggregate ? "evet" : "",
      safeCell(r.note),
    ].join(";"),
  );
  // UTF-8 BOM: without it, Excel on Windows opens the file as ANSI and mangles
  // Turkish characters (ğ/ş/İ…) in category and person names.
  return "\ufeff" + [header, ...lines].join("\n");
}

/** Write content to a shareable file (native) or trigger a download (web). Returns the file path or null on web. */
export async function saveTextFile(filename: string, content: string, mime: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return null;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
}

/**
 * A restore file is untrusted input (hand-edited or from an old/other build).
 * Reject a row whose integer columns aren't safe integers — otherwise a value
 * like `amount_minor: "abc"` or `NaN` is written verbatim and later throws in
 * `assertMinor`/`formatMinor` at render time, crashing the screen.
 */
function isValidImportRow(table: SyncedTableName, raw: Record<string, unknown>): boolean {
  if (typeof raw.id !== "string" || raw.id.length === 0) return false;
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    const value = raw[column.name];
    if (value == null) continue;
    if (column.columnType === "SQLiteInteger" && !Number.isSafeInteger(value)) return false;
  }
  return true;
}

/**
 * Import a JSON bundle: newer rows win per id (same LWW rule as sync), so a
 * restore never clobbers fresher local edits. Rows that fail validation are
 * skipped (and counted) rather than written, so a corrupt backup can't crash
 * the app on the next render.
 */
export async function importBundle(userId: string, bundle: ExportBundle): Promise<{ imported: number; skipped: number }> {
  if (bundle.version !== EXPORT_VERSION || typeof bundle.tables !== "object") {
    throw new Error(tr.errors.invalidBackupFile);
  }
  const sqlite = await getSqliteAsync();
  let imported = 0;
  let skipped = 0;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const rows = bundle.tables[table];
    if (!Array.isArray(rows)) continue;
    const writes = [] as { table: SyncedTableName; row: Record<string, unknown> }[];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      if (!isValidImportRow(table, raw as Record<string, unknown>)) {
        skipped++;
        continue;
      }
      const local = await sqlite.getFirstAsync<{ updated_at: string }>(
        `SELECT updated_at FROM ${table} WHERE id = ?`,
        [(raw as { id: string }).id] as never[],
      );
      const incoming = Date.parse(String((raw as { updated_at?: unknown }).updated_at ?? 0));
      if (local && Date.parse(local.updated_at) >= incoming) continue;
      writes.push({ table, row: { ...fromDbShape(table, raw as Record<string, unknown>), userId } });
      imported++;
    }
    if (writes.length > 0) await writeRows(userId, writes, false);
  }
  return { imported, skipped };
}
