/**
 * JSON export/import (backup) + CSV export of transactions. Not an
 * integration: manual backup/restore only (user decision — history is
 * entered in-app, these are safety valves).
 */

import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { getSqliteAsync } from "../db/client";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { fromDbShape, writeRowBatchesAtomically } from "../db/mutations";
import {
  csvCell,
  ExportTextBuilder,
  validateBundleRelationships,
  validateExportBundle,
  type ExistingImportIds,
} from "./backup-validation";
export { MAX_BACKUP_BYTES, parseExportBundleText } from "./backup-validation";

/**
 * Build a restorable JSON file one table at a time. This never retains all
 * SQLite row arrays alongside the final string. The output is rejected if this
 * app could not safely import it back.
 */
export async function buildExportText(userId: string): Promise<string> {
  const sqlite = await getSqliteAsync();
  const exportedAt = new Date().toISOString();
  const builder = new ExportTextBuilder(exportedAt);
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const rows = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    builder.addTable(table, rows);
  }
  return builder.finish();
}

export async function buildTransactionsCsv(userId: string): Promise<string> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT t.purchase_date, t.effective_date, t.entry_date, t.type, t.status, t.amount_minor, t.currency, t.amount_try_minor,
            c.name as category, ps.name as source, p.name as person, t.installment_no, t.is_aggregate, t.note,
            cs.period_month, cs.statement_date
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN payment_sources ps ON ps.id = t.payment_source_id
     LEFT JOIN persons p ON p.id = t.person_id
     LEFT JOIN credit_card_statements cs ON cs.id = t.card_statement_id AND cs.deleted_at IS NULL
     WHERE t.user_id = ? AND t.deleted_at IS NULL
     ORDER BY t.effective_date`,
    [userId],
  );
  const header = "harcama_tarihi;odeme_tarihi;ekstre_donemi;ekstre_kesim_tarihi;giris_tarihi;tur;durum;tutar;para_birimi;tutar_try;kategori;kaynak;kisi;taksit_no;toplu;not";
  const lines = rows.map((r) =>
    [
      r.purchase_date ?? "",
      r.effective_date,
      r.period_month ?? "",
      r.statement_date ?? "",
      r.entry_date,
      r.type,
      r.status,
      ((r.amount_minor as number) / 100).toFixed(2).replace(".", ","),
      r.currency,
      ((r.amount_try_minor as number) / 100).toFixed(2).replace(".", ","),
      csvCell(r.category),
      csvCell(r.source),
      csvCell(r.person),
      r.installment_no ?? "",
      r.is_aggregate ? "evet" : "",
      csvCell(r.note),
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
 * Import a JSON bundle: newer rows win per id (same LWW rule as sync), so a
 * restore never clobbers fresher local edits. The entire bundle is validated
 * before the first write and then committed in one SQLite transaction.
 */
export async function importBundle(userId: string, input: unknown): Promise<{ imported: number; skipped: number }> {
  const bundle = validateExportBundle(input);
  const sqlite = await getSqliteAsync();
  let imported = 0;
  let skipped = 0;
  const localState = {} as Record<SyncedTableName, { updatedAt: Map<string, number>; ids: Set<string> }>;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const localRows = await sqlite.getAllAsync<{ id: string; updated_at: string }>(
      `SELECT id, updated_at FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    localState[table] = {
      updatedAt: new Map(localRows.map((row) => [row.id, Date.parse(row.updated_at)])),
      ids: new Set(localRows.map((row) => row.id)),
    };
  }
  validateBundleRelationships(
    bundle,
    Object.fromEntries(Object.entries(localState).map(([table, state]) => [table, state.ids])) as ExistingImportIds,
  );
  const legacyTransferCategoryIds = new Set(
    (bundle.tables.transactions ?? [])
      .filter((row) => row.type === "transfer" && typeof row.category_id === "string")
      .map((row) => String(row.category_id)),
  );
  function* restoreBatches(): Generator<{ table: SyncedTableName; row: Record<string, unknown> }[]> {
    let batch: { table: SyncedTableName; row: Record<string, unknown> }[] = [];
    for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
      const rows = bundle.tables[table];
      if (!Array.isArray(rows)) continue;
      for (const raw of rows) {
        const incoming = Date.parse(String(raw.updated_at));
        const local = localState[table].updatedAt.get(String(raw.id));
        if (local != null && local >= incoming) {
          skipped += 1;
          continue;
        }
        const row: Record<string, unknown> = { ...fromDbShape(table, raw as Record<string, unknown>), userId };
        if (table === "categories" && !("is_transfer" in raw)) {
          const legacyInvestmentName = typeof raw.name === "string" && raw.name.toLocaleLowerCase("tr-TR").includes("yatırım");
          row.isTransfer = raw.kind === "expense" && (legacyTransferCategoryIds.has(String(raw.id)) || legacyInvestmentName);
        }
        batch.push({ table, row });
        imported += 1;
        if (batch.length === 400) {
          yield batch;
          batch = [];
        }
      }
    }
    if (batch.length > 0) yield batch;
  }
  // One transaction for every table: a malformed/out-of-space restore can no
  // longer leave half the backup applied.
  await writeRowBatchesAtomically(userId, restoreBatches(), false);
  return { imported, skipped };
}
