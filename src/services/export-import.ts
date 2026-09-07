/**
 * JSON export/import (backup) + the Excel workbook. Not an
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
  ExportTextBuilder,
  validateBundleRelationships,
  validateExportBundle,
  type ExistingImportIds,
} from "./backup-validation";
import { applyIdRemap, buildIdRemap } from "./backup-remap";
import { normalizedMonthlyLoadMinor } from "../domain/analytics";
import { isSupportedMinorAmount } from "../domain/money";
import { composeWorkbook } from "./workbook-export";
import { buildLedgerGrids } from "../domain/workbook-format";
import type { InvestmentRow, SubscriptionRow } from "../domain/workbook-format";
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

const str = (value: unknown): string => (value == null ? "" : String(value));
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value) || 0);

/**
 * The ledger as month grids — one sheet per year, the shape the app both SHOWS
 * and READS.
 *
 * The first version of this export was a flat list of transactions, and the
 * result was a file the app could not take back: the import wizard parses a
 * month grid, so it answered the export with "Ay adlarını bulamadık". A backup
 * you cannot restore is not a backup, and the owner asked for one they could
 * edit in Excel and re-import.
 *
 * A grid is not a compromise for that. Mali Tablo IS a month-by-item matrix on
 * screen, so this is the same table the owner already reads, written down.
 *
 * Three deliberate losses, none of them silent:
 *   - A month's cell is the category's TOTAL, so individual transactions, their
 *     notes and their dates do not survive. The JSON backup is what carries
 *     those, and `settings` says so.
 *   - Amounts are written positive. The importer decides income from the column
 *     HEADING, not the sign, and it shows that guess for review — so a category
 *     the hints do not recognise is corrected by a person rather than by a rule
 *     nobody can see.
 *   - Opening and closing balances are omitted. The importer excludes
 *     balance-like columns by default precisely because importing a sum of the
 *     columns beside it counts the month twice.
 */
async function ledgerGridsByYear(userId: string, signal?: AbortSignal): Promise<[year: number, grid: string[][]][]> {
  const sqlite = await getSqliteAsync();
  throwIfAborted(signal);
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT COALESCE(c.name, ?) AS item,
            substr(t.effective_date, 1, 7) AS month,
            SUM(ABS(t.amount_try_minor)) AS total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL
     GROUP BY item, month
     ORDER BY month`,
    [tr.cashflow.uncategorized, userId],
  );
  throwIfAborted(signal);
  return buildLedgerGrids(
    rows.map((row) => ({ item: str(row.item) || tr.cashflow.uncategorized, month: str(row.month), minor: num(row.total) })),
    tr.months,
  );
}

async function subscriptionRows(userId: string, signal?: AbortSignal): Promise<SubscriptionRow[]> {
  const sqlite = await getSqliteAsync();
  throwIfAborted(signal);
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT s.name, s.amount_minor, s.currency, s.amount_mode, s.cycle, s.interval_months,
            s.billing_day, s.next_due_date, s.trial_end_date, s.auto_pay, s.is_active,
            s.website_domain, c.name as category, ps.name as source, p.name as person
     FROM subscriptions s
     LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
     LEFT JOIN payment_sources ps ON ps.id = s.payment_source_id AND ps.user_id = s.user_id
     LEFT JOIN persons p ON p.id = s.person_id AND p.user_id = s.user_id
     WHERE s.user_id = ? AND s.deleted_at IS NULL
     ORDER BY s.is_active DESC, s.name`,
    [userId],
  );
  return rows.map((r) => {
    const amountMinor = num(r.amount_minor);
    const intervalMonths = num(r.interval_months) || 1;
    return {
      name: str(r.name),
      amountMinor,
      currency: str(r.currency),
      amountMode: str(r.amount_mode),
      cycle: str(r.cycle),
      intervalMonths,
      billingDay: num(r.billing_day),
      nextDueDate: str(r.next_due_date),
      trialEndDate: str(r.trial_end_date),
      category: str(r.category),
      source: str(r.source),
      person: str(r.person),
      autoPay: Boolean(r.auto_pay),
      isActive: Boolean(r.is_active),
      websiteDomain: str(r.website_domain),
      // A derived figure, so a stored amount the domain will not accept costs
      // this ONE cell rather than the whole export. `assertSupportedMinorAmount`
      // throws a bare `Error`, and letting that escape turned a single odd row
      // into "işlem başarısız" for a file the owner was told they could take.
      monthlyLoadMinor: isSupportedMinorAmount(amountMinor)
        ? normalizedMonthlyLoadMinor(amountMinor, intervalMonths)
        : 0,
    };
  });
}

async function investmentRows(userId: string, signal?: AbortSignal): Promise<InvestmentRow[]> {
  const sqlite = await getSqliteAsync();
  throwIfAborted(signal);
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT pr.name as product, pr.asset_type, pr.market_code, o.operation_date, o.kind,
            o.quantity, o.unit_price_minor, o.total_minor, o.note
     FROM investment_operations o
     JOIN investment_products pr ON pr.id = o.product_id AND pr.user_id = o.user_id
     WHERE o.user_id = ? AND o.deleted_at IS NULL AND pr.deleted_at IS NULL
     ORDER BY o.operation_date, pr.name`,
    [userId],
  );
  return rows.map((r) => ({
    product: str(r.product),
    assetType: str(r.asset_type),
    marketCode: str(r.market_code),
    operationDate: str(r.operation_date),
    kind: str(r.kind),
    quantity: str(r.quantity).replace(".", ","),
    unitPriceMinor: num(r.unit_price_minor),
    totalMinor: num(r.total_minor),
    note: str(r.note),
  }));
}


/** The owner's whole workspace as one `.xlsx`: Mali Tablo, Abonelikler, Yatırımlar. */
export async function buildWorkbookBytes(userId: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const [years, subscriptions, investments] = await Promise.all([
    ledgerGridsByYear(userId, signal),
    subscriptionRows(userId, signal),
    investmentRows(userId, signal),
  ]);
  throwIfAborted(signal);
  return composeWorkbook({ years, subscriptions, investments });
}

/**
 * Hand bytes to the platform: a download on the web, a shareable file natively.
 *
 * The text sibling in `export-import.ts` cannot be reused — a `Blob` of a
 * string and a `Blob` of bytes are different constructions, and `File.write`
 * takes one or the other. Returns the native path, or null on the web where
 * the browser has already taken the file.
 */
export async function saveBinaryFile(filename: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string | null> {
  if (Platform.OS === "web") {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return null;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}
