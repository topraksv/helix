/**
 * JSON export/import (backup) + CSV export of transactions. Not an
 * integration: manual backup/restore only (user decision — history is
 * entered in-app, these are safety valves).
 */

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { getSqlite } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { writeRows } from "../db/mutations";
import { tr } from "../i18n/tr";
import { fromDbShape } from "../db/mutations";

const EXPORT_VERSION = 1;

export interface ExportBundle {
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function buildExportBundle(userId: string): ExportBundle {
  const sqlite = getSqlite();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    tables[table] = sqlite.getAllSync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [userId] as never[],
    );
  }
  return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), tables };
}

export function buildTransactionsCsv(userId: string): string {
  const rows = getSqlite().getAllSync<Record<string, unknown>>(
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
      r.category ?? "",
      r.source ?? "",
      r.person ?? "",
      r.installment_no ?? "",
      r.is_aggregate ? "evet" : "",
      String(r.note ?? "").replace(/[\n;]/g, " "),
    ].join(";"),
  );
  return [header, ...lines].join("\n");
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
 * Import a JSON bundle: newer rows win per id (same LWW rule as sync), so a
 * restore never clobbers fresher local edits.
 */
export async function importBundle(userId: string, bundle: ExportBundle): Promise<{ imported: number }> {
  if (bundle.version !== EXPORT_VERSION || typeof bundle.tables !== "object") {
    throw new Error(tr.errors.invalidBackupFile);
  }
  const sqlite = getSqlite();
  let imported = 0;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const rows = bundle.tables[table];
    if (!Array.isArray(rows)) continue;
    const writes = [] as { table: SyncedTableName; row: Record<string, unknown> }[];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || typeof raw.id !== "string") continue;
      const local = sqlite.getFirstSync<{ updated_at: string }>(
        `SELECT updated_at FROM ${table} WHERE id = ?`,
        [raw.id] as never[],
      );
      const incoming = Date.parse(String(raw.updated_at ?? 0));
      if (local && Date.parse(local.updated_at) >= incoming) continue;
      writes.push({ table, row: { ...fromDbShape(table, raw), userId } });
      imported++;
    }
    if (writes.length > 0) await writeRows(userId, writes, false);
  }
  return { imported };
}
