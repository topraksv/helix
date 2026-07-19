import { getTableColumns } from "drizzle-orm";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { parseDefinition, type ComputedColumnDefinition } from "../domain/computed-columns";
import { tr } from "../i18n/tr";
import { LOCAL_ONLY_USER_ID } from "../domain/user-id";

const EXPORT_VERSION = 1;
export const MAX_BACKUP_BYTES = 15 * 1024 * 1024;
export const MAX_BACKUP_ROWS = 100_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ExportBundle {
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Bounded, one-table-at-a-time JSON envelope used by device exports. */
export class ExportTextBuilder {
  private readonly parts: string[] = [];
  private totalRows = 0;

  constructor(private readonly exportedAt: string) {}

  addTable(table: SyncedTableName, rows: readonly Record<string, unknown>[]): void {
    this.totalRows += rows.length;
    if (this.totalRows > MAX_BACKUP_ROWS) throw new Error(tr.errors.backupTooLarge);
    this.parts.push(`${JSON.stringify(table)}:${JSON.stringify(rows)}`);
  }

  finish(): string {
    const content = `{"version":${EXPORT_VERSION},"exportedAt":${JSON.stringify(this.exportedAt)},"tables":{${this.parts.join(",")}}}`;
    if (utf8ByteLength(content) > MAX_BACKUP_BYTES) throw new Error(tr.errors.backupTooLarge);
    return content;
  }
}

const DATE_COLUMNS = new Set([
  "entry_date",
  "effective_date",
  "purchase_date",
  "statement_date",
  "next_due_date",
  "trial_end_date",
  "effective_from",
  "due_date",
  "date",
  "rate_date",
]);

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "deleted_at", "canceled_at", "paid_at"]);

const RELATIONS = [
  ["payment_sources", "person_id", "persons"],
  ["installment_plans", "payment_source_id", "payment_sources"],
  ["installment_plans", "person_id", "persons"],
  ["installment_plans", "category_id", "categories"],
  ["credit_card_statements", "payment_source_id", "payment_sources"],
  ["transactions", "category_id", "categories"],
  ["transactions", "payment_source_id", "payment_sources"],
  ["transactions", "person_id", "persons"],
  ["transactions", "installment_plan_id", "installment_plans"],
  ["transactions", "card_statement_id", "credit_card_statements"],
  ["transactions", "subscription_id", "subscriptions"],
  ["subscriptions", "payment_source_id", "payment_sources"],
  ["subscriptions", "category_id", "categories"],
  ["subscriptions", "person_id", "persons"],
  ["price_history", "subscription_id", "subscriptions"],
  ["recurring_incomes", "person_id", "persons"],
  ["recurring_incomes", "category_id", "categories"],
  ["category_budgets", "category_id", "categories"],
  ["expected_payments", "transaction_id", "transactions"],
  ["cell_notes", "category_id", "categories"],
] as const satisfies readonly (readonly [SyncedTableName, string, SyncedTableName])[];

export type ExistingImportIds = Partial<Record<SyncedTableName, ReadonlySet<string>>>;

function invalidBackup(): never {
  throw new Error(tr.errors.invalidBackupFile);
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year == null || month == null || day == null) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isMonthKey(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Validate a restore row completely before any database write begins. */
export function isValidImportRow(table: SyncedTableName, raw: Record<string, unknown>): boolean {
  if (typeof raw.id !== "string" || !UUID_RE.test(raw.id)) return false;
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    const value = raw[column.name];
    if (value == null) {
      // Version-1 backups produced before cadence support have no recurrence
      // key. SQLite/Postgres both default those legacy rows to monthly.
      if (table === "recurring_incomes" && column.name === "recurrence" && !(column.name in raw)) continue;
      if (column.notNull) return false;
      continue;
    }
    if (column.columnType === "SQLiteInteger" && !Number.isSafeInteger(value)) return false;
    if (column.columnType === "SQLiteBoolean" && value !== 0 && value !== 1 && typeof value !== "boolean") return false;
    if (column.dataType === "string" && typeof value !== "string") return false;
    if (column.enumValues && !column.enumValues.includes(value as never)) return false;
    if (typeof value === "string" && value.length > 50_000) return false;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key === "user_id" && value === LOCAL_ONLY_USER_ID) continue;
    if ((key === "id" || key.endsWith("_id")) && value != null && (typeof value !== "string" || !UUID_RE.test(value))) return false;
  }
  for (const key of TIMESTAMP_COLUMNS) {
    if (key in raw && raw[key] != null && !isIsoTimestamp(raw[key])) return false;
  }
  for (const key of DATE_COLUMNS) {
    if (key in raw && raw[key] != null && !isIsoDate(raw[key])) return false;
  }
  if ("start_month" in raw && !isMonthKey(raw.start_month)) return false;
  if ("month" in raw && !isMonthKey(raw.month)) return false;
  if ("period_month" in raw && !isMonthKey(raw.period_month)) return false;
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
  if (table === "computed_columns") {
    try {
      const definition = parseDefinition(JSON.parse(String(raw.definition)));
      if (definitionCategoryIds(definition).some((id) => !UUID_RE.test(id))) return false;
    } catch {
      return false;
    }
  }
  if (table === "category_budgets" && (typeof raw.amount_minor !== "number" || raw.amount_minor <= 0)) return false;
  if (table === "recurring_incomes") {
    const recurrence = raw.recurrence ?? "monthly";
    if ((recurrence === "weekly" || recurrence === "biweekly") && !isIsoDate(raw.anchor_date)) return false;
  }
  return true;
}

function definitionCategoryIds(definition: ComputedColumnDefinition): string[] {
  if (definition.op === "sum") return definition.categoryIds;
  if (definition.op === "difference") return [...definition.plusCategoryIds, ...definition.minusCategoryIds];
  return [];
}

/**
 * Validate foreign-key-like references against the backup plus the current
 * account. SQLite intentionally has no hard FKs because tombstones must sync,
 * so restore performs this check before its single atomic write instead.
 */
export function validateBundleRelationships(bundle: ExportBundle, existing: ExistingImportIds = {}): void {
  const available = {} as Record<SyncedTableName, Set<string>>;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    available[table] = new Set(existing[table] ?? []);
    for (const row of bundle.tables[table] ?? []) available[table].add(String(row.id));
  }

  for (const [table, column, target] of RELATIONS) {
    for (const row of bundle.tables[table] ?? []) {
      const id = row[column];
      if (id != null && !available[target].has(String(id))) invalidBackup();
    }
  }

  const expectedTargets: Record<string, SyncedTableName> = {
    subscription: "subscriptions",
    installment: "installment_plans",
    loan: "installment_plans",
    recurring_income: "recurring_incomes",
  };
  for (const row of bundle.tables.expected_payments ?? []) {
    const target = expectedTargets[String(row.kind)];
    if (!target || !available[target].has(String(row.ref_id))) invalidBackup();
  }

  for (const row of bundle.tables.computed_columns ?? []) {
    let definition: ComputedColumnDefinition;
    try {
      definition = parseDefinition(JSON.parse(String(row.definition)));
    } catch {
      invalidBackup();
    }
    if (definitionCategoryIds(definition).some((id) => !available.categories.has(id))) invalidBackup();
  }
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
    invalidBackup();
  }
  const tableNames = new Set(Object.keys(SYNCED_TABLES));
  if (Object.keys(bundle.tables).some((table) => !tableNames.has(table))) invalidBackup();
  let totalRows = 0;
  const sourceUsers = new Set<string>();
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const rows = bundle.tables[table];
    if (rows == null) continue;
    if (!Array.isArray(rows)) invalidBackup();
    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS) throw new Error(tr.errors.backupTooLarge);
    const ids = new Set<string>();
    if (rows.some((row) => {
      if (!row || typeof row !== "object" || !isValidImportRow(table, row)) return true;
      if (ids.has(String(row.id))) return true;
      ids.add(String(row.id));
      sourceUsers.add(String(row.user_id));
      return false;
    })) {
      invalidBackup();
    }
  }
  if (sourceUsers.size > 1) invalidBackup();
  return bundle as ExportBundle;
}

/** Parse a picked backup with a hard pre-JSON size bound. */
export function parseExportBundleText(content: string): ExportBundle {
  if (utf8ByteLength(content) > MAX_BACKUP_BYTES) throw new Error(tr.errors.backupTooLarge);
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

/** Cross-platform UTF-8 byte count without allocating another encoded copy. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
