import { getTableColumns } from "drizzle-orm";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { parseDefinition, type ComputedColumnDefinition } from "../domain/computed-columns";
import { resolveInvestmentQuote } from "../domain/investments";
import { isSupportedMinorAmount } from "../domain/money";
import { MAX_INSTALLMENT_COUNT } from "../domain/installments";
import { isValidCardCycle } from "../domain/card-statements";
import { isMonthKey, todayISO } from "../domain/dates";
import { isSupportedCurrency } from "../domain/fx-provider";
import { tr } from "../i18n/tr";
import { LOCAL_ONLY_USER_ID } from "../domain/user-id";
import { UserFacingError, userMessage } from "../domain/user-error";
import { textLength, utf8ByteLength } from "../domain/input";
import { MAX_SUBSCRIPTION_INTERVAL_MONTHS } from "../domain/recurrence";
import { LEGACY_EXPECTED_PAYMENT_KINDS, type ExpectedKind } from "../domain/types";
import { RELATIONS } from "../db/relations";

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
    if (this.totalRows > MAX_BACKUP_ROWS) throw new UserFacingError(tr.errors.backupTooLarge);
    this.parts.push(`${JSON.stringify(table)}:${JSON.stringify(rows)}`);
  }

  finish(): string {
    const content = `{"version":${EXPORT_VERSION},"exportedAt":${JSON.stringify(this.exportedAt)},"tables":{${this.parts.join(",")}}}`;
    if (utf8ByteLength(content) > MAX_BACKUP_BYTES) throw new UserFacingError(tr.errors.backupTooLarge);
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
  "anchor_date",
  "started_on",
  "operation_date",
]);

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "deleted_at", "canceled_at", "paid_at"]);

export type ExistingImportIds = Partial<Record<SyncedTableName, ReadonlySet<string>>>;

function invalidBackup(): never {
  throw new UserFacingError(tr.errors.invalidBackupFile);
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

function isSupportedMoney(value: unknown, allowZero = true): value is number {
  return typeof value === "number" && isSupportedMinorAmount(value, allowZero);
}

function isPositiveMoney(value: unknown): value is number {
  return isSupportedMoney(value, false) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isSupportedRate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1_000_000;
}

function requiredText(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim() !== "" && textLength(value) <= max;
}

function optionalText(value: unknown, max: number): boolean {
  return value == null || (typeof value === "string" && textLength(value) <= max);
}

function optionalNonEmptyText(value: unknown, max: number): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const length = textLength(value);
  return length >= 1 && length <= max;
}

/** Validate a restore row completely before any database write begins. */
export function isValidImportRow(
  table: SyncedTableName,
  raw: Record<string, unknown>,
  options: { enforceInputLimits?: boolean } = {},
): boolean {
  const today = todayISO();
  // A tombstone must remain pushable even when it was created from a legacy
  // row that predates today's input caps. Its payload has no live product
  // effect; quarantining it would instead keep the old cloud row alive.
  const enforceInputLimits = options.enforceInputLimits === true && raw.deleted_at == null;
  if (typeof raw.id !== "string" || !UUID_RE.test(raw.id)) return false;
  for (const column of Object.values(getTableColumns(SYNCED_TABLES[table]))) {
    const value = raw[column.name];
    if (value == null) {
      // Backups written before delete generations existed are generation zero;
      // the write layer upgrades an imported tombstone to generation one.
      if (column.name === "tombstone_version" && !(column.name in raw)) continue;
      // Version-1 backups produced before cadence support have no recurrence
      // key. SQLite/Postgres both default those legacy rows to monthly.
      if (table === "recurring_incomes" && column.name === "recurrence" && !(column.name in raw)) continue;
      // Backups created before persisted transfer semantics default ordinary
      // categories to false; legacy "Yatırım" rows are backfilled by migration.
      if (table === "categories" && column.name === "is_transfer" && !(column.name in raw)) continue;
      // Variable subscription support is additive. Older exports have no mode
      // or per-occurrence estimate flag; the database defaults them to the
      // pre-feature fixed/known semantics during restore.
      if (table === "subscriptions" && column.name === "amount_mode" && !(column.name in raw)) continue;
      if (table === "expected_payments" && column.name === "amount_is_estimated" && !(column.name in raw)) continue;
      if (column.notNull) return false;
      continue;
    }
    if (column.columnType === "SQLiteInteger" && !Number.isSafeInteger(value)) return false;
    if (column.columnType === "SQLiteBoolean" && value !== 0 && value !== 1 && typeof value !== "boolean") return false;
    if (column.dataType === "string" && typeof value !== "string") return false;
    if (column.enumValues && !column.enumValues.includes(value as never)) {
      const legacyExpectedKind = table === "expected_payments"
        && column.name === "kind"
        && raw.deleted_at != null
        && typeof value === "string"
        && LEGACY_EXPECTED_PAYMENT_KINDS.includes(value as (typeof LEGACY_EXPECTED_PAYMENT_KINDS)[number]);
      if (!legacyExpectedKind) return false;
    }
    if (typeof value === "string" && textLength(value) > 50_000) return false;
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
  if ("currency" in raw && !isSupportedCurrency(raw.currency)) return false;
  if (
    "tombstone_version" in raw &&
    (!Number.isSafeInteger(raw.tombstone_version) || Number(raw.tombstone_version) < 0)
  ) return false;
  for (const key of ["due_day", "statement_day", "billing_day", "pay_day"]) {
    const value = raw[key];
    if (value != null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31)) return false;
  }
  if (table === "settings") {
    if (enforceInputLimits && (!requiredText(raw.key, 120) || !optionalText(raw.value, 50_000))) return false;
    try {
      JSON.parse(String(raw.value));
    } catch {
      return false;
    }
  }
  if (table === "computed_columns") {
    if (enforceInputLimits && !requiredText(raw.name, 120)) return false;
    try {
      const definition = parseDefinition(JSON.parse(String(raw.definition)));
      if (definitionCategoryIds(definition).some((id) => !UUID_RE.test(id))) return false;
    } catch {
      return false;
    }
  }
  if (table === "transactions") {
    if (
      !isSupportedMoney(raw.amount_minor, false)
      || !isSupportedMoney(raw.amount_try_minor, false)
      || Math.sign(raw.amount_minor) !== Math.sign(raw.amount_try_minor)
      || (raw.installment_no != null && (!Number.isInteger(raw.installment_no) || Number(raw.installment_no) < 1))
      || (enforceInputLimits && !optionalText(raw.note, 1_000))
    ) return false;
    if (raw.fx_rate != null) {
      const rate = Number(raw.fx_rate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) return false;
    }
  }
  if (table === "subscriptions") {
    // A variable bill (electricity, gas) may legitimately carry no estimate
    // yet, and 0 is that sentinel. Fixed subscriptions still name a real
    // recurring charge, so zero stays invalid there.
    const allowsUnknownAmount = raw.amount_mode === "variable";
    if (
      !(allowsUnknownAmount ? isSupportedMoney(raw.amount_minor) && Number(raw.amount_minor) >= 0 : isPositiveMoney(raw.amount_minor))
      || !isPositiveInteger(raw.interval_months)
      || raw.interval_months > MAX_SUBSCRIPTION_INTERVAL_MONTHS
      || (enforceInputLimits && (
        !requiredText(raw.name, 120)
        || !optionalText(raw.website_domain, 512)
        || !optionalText(raw.logo_ref, 512)
        || !optionalText(raw.note, 1_000)
      ))
    ) return false;
  }
  if (table === "price_history" && !isPositiveMoney(raw.amount_minor)) return false;
  if (table === "recurring_incomes" && !isPositiveMoney(raw.default_amount_minor)) return false;
  // A still-estimated occurrence of a variable bill carries 0 until the user
  // enters the invoice; a known occurrence always names a real amount.
  if (table === "expected_payments") {
    const estimated = raw.amount_is_estimated === true || raw.amount_is_estimated === 1;
    const amountValid = estimated
      ? isSupportedMoney(raw.amount_minor) && Number(raw.amount_minor) >= 0
      : isPositiveMoney(raw.amount_minor);
    if (!amountValid) return false;
  }
  if (table === "balance_adjustments" && !isSupportedMoney(raw.amount_minor)) return false;
  if (table === "category_budgets" && !isPositiveMoney(raw.amount_minor)) return false;
  if (table === "fx_rates" && !isSupportedRate(raw.rate_try)) return false;
  if (table === "payment_sources" && raw.type === "credit_card" && !isValidCardCycle({
    statementDay: typeof raw.statement_day === "number" ? raw.statement_day : null,
    dueDay: typeof raw.due_day === "number" ? raw.due_day : null,
  })) return false;
  if (
    table === "credit_card_statements"
    && typeof raw.statement_date === "string"
    && typeof raw.due_date === "string"
    && raw.due_date < raw.statement_date
  ) return false;
  if (table === "installment_plans") {
    if (
      !isPositiveInteger(raw.installment_count)
      || raw.installment_count > MAX_INSTALLMENT_COUNT
      || (enforceInputLimits && (
        !requiredText(raw.title, 120)
        || !optionalText(raw.note, 1_000)
      ))
    ) {
      return false;
    }
    const hasTotal = raw.total_amount_minor != null;
    const hasMonthly = raw.monthly_amount_minor != null;
    if (!hasTotal && !hasMonthly) return false;
    if (raw.kind === "card_installment" && typeof raw.payment_source_id !== "string") return false;
    if (hasTotal && !isPositiveMoney(raw.total_amount_minor)) return false;
    if (hasMonthly && !isPositiveMoney(raw.monthly_amount_minor)) return false;
  }
  if (table === "investment_profiles") {
    if (
      typeof raw.started_on !== "string"
      || raw.started_on > today
      || typeof raw.opening_cash_minor !== "number"
      || raw.opening_cash_minor < 0
      || !isSupportedMinorAmount(raw.opening_cash_minor)
    ) return false;
  }
  if (table === "investment_products") {
    if (
      !["metal", "currency", "equity", "fund", "crypto", "pension"].includes(String(raw.asset_type))
      || typeof raw.name !== "string"
      || raw.name.trim() === ""
      || textLength(raw.name) > 120
      || !optionalNonEmptyText(raw.market_code, 40)
      || !optionalText(raw.note, 2_000)
    ) return false;
  }
  if (table === "investment_operations") {
    if (
      !["existing", "buy", "sell", "contribution"].includes(String(raw.kind))
      || typeof raw.operation_date !== "string"
      || raw.operation_date > today
      || typeof raw.total_minor !== "number"
      || raw.total_minor <= 0
      || typeof raw.cost_basis_minor !== "number"
      || typeof raw.realized_profit_loss_minor !== "number"
      || !isSupportedMinorAmount(raw.total_minor, false)
      || !isSupportedMinorAmount(raw.cost_basis_minor)
      || !isSupportedMinorAmount(raw.realized_profit_loss_minor)
      || !optionalText(raw.note, 2_000)
      || !optionalNonEmptyText(raw.import_key, 240)
    ) return false;
    if (raw.quantity == null) {
      if (raw.kind !== "contribution" || raw.unit_price_minor != null) return false;
    } else if (
      typeof raw.quantity !== "string"
      || !/^[0-9]+(\.[0-9]{1,8})?$/.test(raw.quantity)
      || typeof raw.unit_price_minor !== "number"
      || raw.unit_price_minor <= 0
    ) return false;
    if (raw.quantity != null) {
      try {
        resolveInvestmentQuote({
          quantity: raw.quantity,
          unitPriceMinor: raw.unit_price_minor,
          totalMinor: raw.total_minor,
        });
      } catch {
        return false;
      }
    }
  }
  if (table === "categories" && raw.is_transfer != null) {
    const transfer = raw.is_transfer === true || raw.is_transfer === 1;
    if (transfer && raw.kind !== "expense") return false;
  }
  if (enforceInputLimits && table === "persons" && !requiredText(raw.name, 120)) return false;
  if (enforceInputLimits && table === "payment_sources" && (
    !requiredText(raw.name, 120)
    || !optionalText(raw.color, 64)
    || !optionalText(raw.logo_ref, 512)
  )) return false;
  if (enforceInputLimits && table === "categories" && (
    !requiredText(raw.name, 120)
    || !optionalText(raw.icon, 64)
    || !optionalText(raw.color, 64)
  )) return false;
  if (enforceInputLimits && table === "recurring_incomes" && (
    !requiredText(raw.name, 120)
    || !optionalText(raw.note, 1_000)
  )) return false;
  if (enforceInputLimits && table === "balance_adjustments" && !optionalText(raw.note, 1_000)) return false;
  if (enforceInputLimits && table === "cell_notes" && !optionalText(raw.body, 1_000)) return false;
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

  const expectedTargets: Record<ExpectedKind, SyncedTableName> = {
    subscription: "subscriptions",
    recurring_income: "recurring_incomes",
  };
  for (const row of bundle.tables.expected_payments ?? []) {
    // Legacy installment/loan rows can remain as tombstones for sync and
    // backup recovery. They have no live meaning and must not be allowed back
    // into the active expected-payment graph.
    if (row.deleted_at != null) continue;
    const target = expectedTargets[String(row.kind) as ExpectedKind];
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
  if (!raw || typeof raw !== "object") throw new UserFacingError(tr.errors.invalidBackupFile);
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
    if (totalRows > MAX_BACKUP_ROWS) throw new UserFacingError(tr.errors.backupTooLarge);
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

/**
 * Which account a bundle was written from, or null for an empty backup.
 *
 * Restore rebinds rows to the importing account but keeps their original
 * ids, and many of those ids are DERIVED from the account they were made in
 * (`naturalKeys.setting`, `cellNote`, `categoryBudget`, `expected`, …). Into
 * a different account they would collide with the source account's rows on a
 * shared device, and where they did not collide they would no longer match
 * what that account's own writes derive — one settings key would end up with
 * two rows. Callers use this to refuse that restore in words rather than to
 * half-apply it.
 */
export function bundleSourceUserId(bundle: ExportBundle): string | null {
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    for (const row of bundle.tables[table] ?? []) {
      if (typeof row.user_id === "string") return row.user_id;
    }
  }
  return null;
}

/** Parse a picked backup with a hard pre-JSON size bound. */
export function parseExportBundleText(content: string): ExportBundle {
  if (utf8ByteLength(content) > MAX_BACKUP_BYTES) throw new UserFacingError(tr.errors.backupTooLarge);
  try {
    return validateExportBundle(JSON.parse(content));
  } catch (error) {
    // A message authored for the user (size, shape) survives; a parser or
    // engine failure becomes the one thing the user can act on.
    throw new UserFacingError(userMessage(error, tr.errors.invalidBackupFile));
  }
}

/**
 * Neutralise one user-entered value for the CSV export.
 *
 * Two separate hazards, both driven by note/category/person text that can also
 * arrive from a synced device:
 *   1. Structure forgery — a `;`, quote or line break inside a cell could
 *      forge an extra column or row.
 *   2. Formula injection — Excel and Sheets evaluate a cell whose first
 *      NON-BLANK character is `=`, `+`, `-` or `@`, so the guard has to look
 *      past leading whitespace (a plain `^` test was bypassed by " =1+1").
 *
 * Hazard 1 is solved by RFC 4180 quoting, NOT by deleting characters: the
 * export is re-importable (the import wizard accepts `text/csv`), so a note
 * reading `Yemek; İçecek` or spanning two lines has to survive the round trip
 * intact. Only the formula guard adds a character, and it adds a leading
 * apostrophe — the conventional spreadsheet "this is text" marker.
 *
 * Callers must NOT route app-generated numeric or enumerated columns through
 * this: a negative amount legitimately starts with `-` and would be turned
 * into text. Exported so the security boundary itself is unit-tested — its
 * previous home (`export-import.ts`) imports React Native and cannot load
 * under Vitest at all, which is how the earlier bypasses survived.
 */
export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const neutralized = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return /[";\r\n]/.test(neutralized) ? `"${neutralized.replace(/"/g, '""')}"` : neutralized;
}
