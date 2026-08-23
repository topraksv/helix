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
import { assertInvestmentWrites } from "../data/repo/investment-validation";
import { InvestmentDomainError } from "../domain/investments";
import { UserFacingError } from "../domain/user-error";
import { tr } from "../i18n/tr";
import {
  bundleSourceUserId,
  csvCell,
  ExportTextBuilder,
  validateBundleRelationships,
  validateExportBundle,
  type ExistingImportIds,
} from "./backup-validation";
import { applyIdRemap, buildIdRemap } from "./backup-remap";
import { normalizeMatrixColorToken } from "../domain/matrix-colors";
export { MAX_BACKUP_BYTES, parseExportBundleText } from "./backup-validation";

interface RestoreOperationOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

const RESTORE_PHASE_COUNT = 3;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Operation cancelled");
}

/**
 * Build a restorable JSON file one table at a time. This never retains all
 * SQLite row arrays alongside the final string. The output is rejected if this
 * app could not safely import it back.
 */
export async function buildExportText(userId: string, signal?: AbortSignal): Promise<string> {
  const sqlite = await getSqliteAsync();
  const exportedAt = new Date().toISOString();
  const builder = new ExportTextBuilder(exportedAt);
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    throwIfAborted(signal);
    const rows = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    throwIfAborted(signal);
    builder.addTable(table, rows);
  }
  return builder.finish();
}

export async function buildTransactionsCsv(userId: string, signal?: AbortSignal): Promise<string> {
  const sqlite = await getSqliteAsync();
  throwIfAborted(signal);
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT t.purchase_date, t.effective_date, t.entry_date, t.type, t.status, t.amount_minor, t.currency, t.amount_try_minor,
            c.name as category, ps.name as source, p.name as person, t.installment_no, t.is_aggregate, t.note,
            cs.period_month, cs.statement_date
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN payment_sources ps ON ps.id = t.payment_source_id AND ps.user_id = t.user_id
     LEFT JOIN persons p ON p.id = t.person_id AND p.user_id = t.user_id
     LEFT JOIN credit_card_statements cs ON cs.id = t.card_statement_id AND cs.user_id = t.user_id AND cs.deleted_at IS NULL
     WHERE t.user_id = ? AND t.deleted_at IS NULL
     ORDER BY t.effective_date`,
    [userId],
  );
  throwIfAborted(signal);
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
export async function importBundle(
  userId: string,
  input: unknown,
  options?: RestoreOperationOptions,
): Promise<{ imported: number; skipped: number }> {
  throwIfAborted(options?.signal);
  const parsedBundle = validateExportBundle(input);
  // Restore keeps every row's original id, and a large share of those ids are
  // derived from the account that made them. Pointed at a second account they
  // would collide with that account's own rows on a shared device, or simply
  // stop matching what the new account's own future writes derive. Re-derive
  // every provably-deterministic id under the importing account before this
  // account ever sees the original ones — see `backup-remap.ts` for how a
  // row's id is proven to come from a specific natural-key template instead
  // of guessed at.
  const sourceUserId = bundleSourceUserId(parsedBundle);
  const idMap = sourceUserId != null && sourceUserId !== userId
    ? await buildIdRemap(parsedBundle, sourceUserId, userId)
    : new Map<string, string>();
  throwIfAborted(options?.signal);
  const bundle = applyIdRemap(parsedBundle, idMap);
  const sqlite = await getSqliteAsync();
  let imported = 0;
  let skipped = 0;
  const localState = {} as Record<SyncedTableName, { updatedAt: Map<string, number>; ids: Set<string> }>;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    throwIfAborted(options?.signal);
    const localRows = await sqlite.getAllAsync<{ id: string; updated_at: string }>(
      `SELECT id, updated_at FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    localState[table] = {
      updatedAt: new Map(localRows.map((row) => [row.id, Date.parse(row.updated_at)])),
      ids: new Set(localRows.map((row) => row.id)),
    };
  }
  options?.onProgress?.(1, RESTORE_PHASE_COUNT);
  validateBundleRelationships(
    bundle,
    Object.fromEntries(Object.entries(localState).map(([table, state]) => [table, state.ids])) as ExistingImportIds,
  );
  const legacyTransferCategoryIds = new Set(
    (bundle.tables.transactions ?? [])
      .filter((row) => row.type === "transfer" && typeof row.category_id === "string")
      .map((row) => String(row.category_id)),
  );
  options?.onProgress?.(2, RESTORE_PHASE_COUNT);
  function* restoreBatches(): Generator<{ table: SyncedTableName; row: Record<string, unknown> }[]> {
    let batch: { table: SyncedTableName; row: Record<string, unknown> }[] = [];
    for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
      const rows = bundle.tables[table];
      if (!Array.isArray(rows)) continue;
      for (const raw of rows) {
        throwIfAborted(options?.signal);
        const incoming = Date.parse(String(raw.updated_at));
        const local = localState[table].updatedAt.get(String(raw.id));
        if (local != null && local >= incoming) {
          skipped += 1;
          continue;
        }
        const row: Record<string, unknown> = { ...fromDbShape(table, raw as Record<string, unknown>), userId };
        // A mark written under the retired vocabulary becomes its current
        // slot on the way in. Validation accepts the old name so the file
        // restores at all; storing it would push a token the server's check
        // constraint refuses, and the row would land in sync quarantine.
        if (table === "matrix_colors") {
          row.token = normalizeMatrixColorToken(raw.token) ?? "yellow";
        }
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
  try {
    await writeRowBatchesAtomically(
      userId,
      restoreBatches(),
      false,
      undefined,
      (db) => assertInvestmentWrites(db, userId, [], true).then(() => undefined),
    );
  } catch (error) {
    if (error instanceof InvestmentDomainError) {
      // The investment wallet is replayed as a whole, so this failure has no
      // single row to point at — but it does have a section, and that alone
      // is the difference between "your backup is broken" and "look at the
      // investment operations". Finding this one by bisecting the file took
      // five restores; naming the section costs nothing.
      throw new UserFacingError(
        `${tr.errors.invalidBackupFile}: ${tr.backupTables.investment_operations} — ${tr.errors.invalidBackupReason.investments}.`,
      );
    }
    throw error;
  }
  options?.onProgress?.(3, RESTORE_PHASE_COUNT);
  return { imported, skipped };
}
