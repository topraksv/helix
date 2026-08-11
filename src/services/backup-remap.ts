/**
 * Cross-account backup id remap.
 *
 * A backup restored into a DIFFERENT account than the one that exported it
 * keeps every row's original id. Most ids are plain uuidv7 (globally unique,
 * carry no account identity — `src/db/ids.ts`'s `newId()`) and need no
 * change. A large minority are DETERMINISTIC ids — SHA-256(natural key)
 * folded into a UUID shape, `deterministicId()` — and most natural keys
 * embed the exporting account's userId (`src/db/ids.ts`'s `naturalKeys`).
 * Restored under a second account they either collide with that account's
 * own rows (same natural key, same id, different data) or simply stop
 * matching what the new account's own future writes derive.
 *
 * SHA-256 cannot be inverted, so a deterministic id cannot be "read" back
 * into its natural key. Instead every row is asked to PROVE which natural
 * key produced its id: reconstruct each candidate natural key from the
 * row's own columns plus the SOURCE account id, hash it, and compare to the
 * row's actual id. An exact match proves the template; recomputing the same
 * template with the TARGET account id gives the row's new id. A row that
 * proves no template is left untouched — an unproven guess must never
 * rewrite a primary key.
 *
 * Safety property (not argued, structural): when sourceUserId === targetUserId,
 * every candidate's source-hash and target-hash are computed from IDENTICAL
 * inputs (same userId, and any referenced id looked up through a map that —
 * inductively — never gained an entry either), so `targetHash !== id` is
 * false for every row, every table, every call. The remap is therefore the
 * empty map by construction, not by a special case. See
 * `tests/backup-round-trip.test.ts` for the executable proof.
 */

import { deterministicId, naturalKeys } from "../db/ids";
import type { SyncedTableName } from "../db/schema";
import type { ExportBundle } from "./backup-validation";

/**
 * `deterministicId` forces the UUID version nibble ("M" in
 * `xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx") to "8"; `uuidv7` always produces
 * "7" there. Measured empirically (not just by spec): 20000 uuidv7 samples,
 * zero with a version nibble other than "7". Index 14 is that character's
 * offset in the canonical 36-char hyphenated string.
 */
export function isDeterministicId(id: unknown): id is string {
  return typeof id === "string" && id.length === 36 && id[14] === "8";
}

/**
 * Every natural-key constructor must have one remap resolver. Keeping this
 * exhaustive map beside the algorithm makes adding a new deterministic id a
 * compile-time and test-time event instead of a silent restore regression.
 */
export const REMAPPED_NATURAL_KEY_COVERAGE = {
  setting: "settings",
  selfPerson: "persons",
  onboardingPerson: "persons",
  onboardingSource: "payment_sources",
  seedCategory: "categories",
  fxRate: "fx_rates",
  expected: "expected_payments",
  installmentTx: "transactions",
  cardStatement: "credit_card_statements",
  confirmTx: "transactions",
  cellNote: "cell_notes",
  categoryBudget: "category_budgets",
  balanceAdjustment: "balance_adjustments",
  investmentProfile: "investment_profiles",
  importSource: "payment_sources",
  importInstallmentPlan: "installment_plans",
  ccColumn: "computed_columns",
} as const satisfies Record<keyof typeof naturalKeys, SyncedTableName>;

/**
 * `onboardingPerson`/`onboardingSource` fold an array INDEX into the hash,
 * and that index is not stored on the row — it has to be brute-forced.
 * `seedWorkspace` seeds at most a handful of persons/sources in one call (the
 * onboarding UI offers no path to enter hundreds), so 200 is two orders of
 * magnitude beyond anything the product ever creates while keeping the
 * brute-force cost bounded even against a hand-crafted backup.
 */
const ONBOARDING_INDEX_CAP = 200;

function remappedOrSame(idMap: ReadonlyMap<string, string>, value: unknown): string {
  const id = String(value ?? "");
  return idMap.get(id) ?? id;
}

/** Precompute source→target hash pairs for every brute-forced index once per
 *  table, so resolving N unexplained rows costs O(cap), not O(cap × N). */
async function bruteForceIndexMap(
  template: (userId: string, index: number) => string,
  sourceUserId: string,
  targetUserId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let index = 0; index < ONBOARDING_INDEX_CAP; index++) {
    const sourceHash = await deterministicId(template(sourceUserId, index));
    const targetHash = await deterministicId(template(targetUserId, index));
    map.set(sourceHash, targetHash);
  }
  return map;
}

function deterministicRows(bundle: ExportBundle, table: SyncedTableName): Record<string, unknown>[] {
  return (bundle.tables[table] ?? []).filter((row) => isDeterministicId(row.id));
}

function record(idMap: Map<string, string>, id: string, targetHash: string): void {
  if (targetHash !== id) idMap.set(id, targetHash);
}

// ---------------------------------------------------------------------------
// Per-table resolvers, in dependency order (see `buildIdRemap` below for why
// this order — a table only appears after every table its templates read a
// referenced id from).
// ---------------------------------------------------------------------------

/** `selfPerson(userId)` — exactly one row, `is_self`. `onboardingPerson(userId, index)` — the rest. */
async function resolvePersons(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  const rows = deterministicRows(bundle, "persons");
  if (rows.length === 0) return;
  const selfSourceHash = await deterministicId(naturalKeys.selfPerson(sourceUserId));
  const selfTargetHash = await deterministicId(naturalKeys.selfPerson(targetUserId));
  const unresolved: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = row.id as string;
    if (id === selfSourceHash) record(idMap, id, selfTargetHash);
    else unresolved.push(row);
  }
  if (unresolved.length === 0) return;
  const onboardingMap = await bruteForceIndexMap(naturalKeys.onboardingPerson, sourceUserId, targetUserId);
  for (const row of unresolved) {
    const id = row.id as string;
    const targetHash = onboardingMap.get(id);
    if (targetHash != null) record(idMap, id, targetHash);
  }
}

/** `seedCategory(userId, name)` — the only deterministic template for categories. */
async function resolveCategories(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "categories")) {
    const id = row.id as string;
    const name = typeof row.name === "string" ? row.name : "";
    const sourceHash = await deterministicId(naturalKeys.seedCategory(sourceUserId, name));
    if (sourceHash !== id) continue;
    record(idMap, id, await deterministicId(naturalKeys.seedCategory(targetUserId, name)));
  }
}

/** `importSource(userId, name)` (spreadsheet import) then `onboardingSource(userId, index)`. */
async function resolvePaymentSources(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  const rows = deterministicRows(bundle, "payment_sources");
  if (rows.length === 0) return;
  const unresolved: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = row.id as string;
    const name = typeof row.name === "string" ? row.name : "";
    const sourceHash = await deterministicId(naturalKeys.importSource(sourceUserId, name));
    if (sourceHash === id) {
      record(idMap, id, await deterministicId(naturalKeys.importSource(targetUserId, name)));
    } else {
      unresolved.push(row);
    }
  }
  if (unresolved.length === 0) return;
  const onboardingMap = await bruteForceIndexMap(naturalKeys.onboardingSource, sourceUserId, targetUserId);
  for (const row of unresolved) {
    const id = row.id as string;
    const targetHash = onboardingMap.get(id);
    if (targetHash != null) record(idMap, id, targetHash);
  }
}

/** `fxRate(userId, currency, rateDate)`. */
async function resolveFxRates(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "fx_rates")) {
    const id = row.id as string;
    const currency = typeof row.currency === "string" ? row.currency : "";
    const rateDate = typeof row.rate_date === "string" ? row.rate_date : "";
    const sourceHash = await deterministicId(naturalKeys.fxRate(sourceUserId, currency, rateDate));
    if (sourceHash !== id) continue;
    record(idMap, id, await deterministicId(naturalKeys.fxRate(targetUserId, currency, rateDate)));
  }
}

/** `setting(userId, key)` — every settings row's id (`last_entry_at`, `import_batch:*`, …). */
async function resolveSettings(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "settings")) {
    const id = row.id as string;
    const key = typeof row.key === "string" ? row.key : "";
    const sourceHash = await deterministicId(naturalKeys.setting(sourceUserId, key));
    if (sourceHash !== id) continue;
    record(idMap, id, await deterministicId(naturalKeys.setting(targetUserId, key)));
  }
}

/** `investmentProfile(userId)` — exactly one row. */
async function resolveInvestmentProfiles(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  const sourceHash = await deterministicId(naturalKeys.investmentProfile(sourceUserId));
  const targetHash = await deterministicId(naturalKeys.investmentProfile(targetUserId));
  for (const row of deterministicRows(bundle, "investment_profiles")) {
    const id = row.id as string;
    if (sourceHash !== id) continue;
    record(idMap, id, targetHash);
  }
}

/** `importInstallmentPlan(userId, name, monthlyMinor, total, startMonth)` (spreadsheet-reconstructed plans only). */
async function resolveInstallmentPlans(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "installment_plans")) {
    const id = row.id as string;
    const title = typeof row.title === "string" ? row.title : "";
    const monthly = typeof row.monthly_amount_minor === "number" ? row.monthly_amount_minor : NaN;
    const count = typeof row.installment_count === "number" ? row.installment_count : NaN;
    const startMonth = typeof row.start_month === "string" ? row.start_month : "";
    const sourceHash = await deterministicId(
      naturalKeys.importInstallmentPlan(sourceUserId, title, monthly, count, startMonth),
    );
    if (sourceHash !== id) continue;
    record(idMap, id, await deterministicId(
      naturalKeys.importInstallmentPlan(targetUserId, title, monthly, count, startMonth),
    ));
  }
}

/** `ccColumn(userId)` — the one auto-created "KK Taksit" computed column, tombstoned on sight in newer builds. */
async function resolveComputedColumns(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  const sourceHash = await deterministicId(naturalKeys.ccColumn(sourceUserId));
  const targetHash = await deterministicId(naturalKeys.ccColumn(targetUserId));
  for (const row of deterministicRows(bundle, "computed_columns")) {
    const id = row.id as string;
    if (sourceHash !== id) continue;
    record(idMap, id, targetHash);
  }
}

/** `balanceAdjustment(userId, date)`. */
async function resolveBalanceAdjustments(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "balance_adjustments")) {
    const id = row.id as string;
    const date = typeof row.date === "string" ? row.date : "";
    const sourceHash = await deterministicId(naturalKeys.balanceAdjustment(sourceUserId, date));
    if (sourceHash !== id) continue;
    record(idMap, id, await deterministicId(naturalKeys.balanceAdjustment(targetUserId, date)));
  }
}

/** `categoryBudget(userId, month, categoryId)` — needs `categories` resolved first. */
async function resolveCategoryBudgets(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "category_budgets")) {
    const id = row.id as string;
    const month = typeof row.month === "string" ? row.month : "";
    const categoryId = String(row.category_id ?? "");
    const sourceHash = await deterministicId(naturalKeys.categoryBudget(sourceUserId, month, categoryId));
    if (sourceHash !== id) continue;
    const remappedCategoryId = remappedOrSame(idMap, categoryId);
    record(idMap, id, await deterministicId(naturalKeys.categoryBudget(targetUserId, month, remappedCategoryId)));
  }
}

/** `cellNote(userId, month, categoryId)` — needs `categories` resolved first. */
async function resolveCellNotes(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "cell_notes")) {
    const id = row.id as string;
    const month = typeof row.month === "string" ? row.month : "";
    const categoryId = String(row.category_id ?? "");
    const sourceHash = await deterministicId(naturalKeys.cellNote(sourceUserId, month, categoryId));
    if (sourceHash !== id) continue;
    const remappedCategoryId = remappedOrSame(idMap, categoryId);
    record(idMap, id, await deterministicId(naturalKeys.cellNote(targetUserId, month, remappedCategoryId)));
  }
}

/** `cardStatement(userId, sourceId, periodMonth)` — needs `payment_sources` resolved first. */
async function resolveCreditCardStatements(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "credit_card_statements")) {
    const id = row.id as string;
    const periodMonth = typeof row.period_month === "string" ? row.period_month : "";
    const sourceId = String(row.payment_source_id ?? "");
    const sourceHash = await deterministicId(naturalKeys.cardStatement(sourceUserId, sourceId, periodMonth));
    if (sourceHash !== id) continue;
    const remappedSourceId = remappedOrSame(idMap, sourceId);
    record(idMap, id, await deterministicId(naturalKeys.cardStatement(targetUserId, remappedSourceId, periodMonth)));
  }
}

/**
 * `expected(userId, kind, refId, dueDate)` — active kinds point at a
 * subscription or recurring income, neither of which carries a deterministic
 * id. Retired installment/loan tombstones can still be remapped generically
 * so an old backup remains lossless.
 */
async function resolveExpectedPayments(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  for (const row of deterministicRows(bundle, "expected_payments")) {
    const id = row.id as string;
    const kind = typeof row.kind === "string" ? row.kind : "";
    const dueDate = typeof row.due_date === "string" ? row.due_date : "";
    const refId = String(row.ref_id ?? "");
    const sourceHash = await deterministicId(naturalKeys.expected(sourceUserId, kind, refId, dueDate));
    if (sourceHash !== id) continue;
    const remappedRefId = remappedOrSame(idMap, refId);
    record(idMap, id, await deterministicId(naturalKeys.expected(targetUserId, kind, remappedRefId, dueDate)));
  }
}

/**
 * `installmentTx(planId, installmentNo)` and `confirmTx(expectedId)` — the
 * only two templates with no userId at all, both living in `transactions`.
 * Needs `installment_plans` and `expected_payments` resolved first.
 * `confirmTx`'s `expectedId` is not a column on the transaction row; it is
 * recovered from the one `expected_payments` row (if any) whose
 * `transaction_id` names this transaction — "the transaction created by
 * confirming this expected item".
 */
async function resolveTransactions(
  bundle: ExportBundle,
  idMap: Map<string, string>,
): Promise<void> {
  const expectedIdByTransactionId = new Map<string, string>();
  for (const row of bundle.tables.expected_payments ?? []) {
    if (typeof row.transaction_id === "string" && typeof row.id === "string") {
      expectedIdByTransactionId.set(row.transaction_id, row.id);
    }
  }
  for (const row of deterministicRows(bundle, "transactions")) {
    const id = row.id as string;
    if (typeof row.installment_plan_id === "string" && typeof row.installment_no === "number") {
      const planId = row.installment_plan_id;
      const sourceHash = await deterministicId(naturalKeys.installmentTx(planId, row.installment_no));
      if (sourceHash === id) {
        const remappedPlanId = remappedOrSame(idMap, planId);
        record(idMap, id, await deterministicId(naturalKeys.installmentTx(remappedPlanId, row.installment_no)));
        continue;
      }
    }
    const expectedId = expectedIdByTransactionId.get(id);
    if (expectedId == null) continue;
    const sourceHash = await deterministicId(naturalKeys.confirmTx(expectedId));
    if (sourceHash !== id) continue;
    const remappedExpectedId = remappedOrSame(idMap, expectedId);
    record(idMap, id, await deterministicId(naturalKeys.confirmTx(remappedExpectedId)));
  }
}

/**
 * Build the old-id → new-id map for restoring `bundle` (exported by
 * `sourceUserId`) into `targetUserId`. Tables are resolved in dependency
 * order: a table whose natural key embeds another table's id is resolved
 * only after that table, so the referenced id is already in `idMap` by the
 * time it is looked up. `investment_products`, `subscriptions`,
 * `recurring_incomes`, `price_history` and `investment_operations` have no
 * deterministic-id template at all (`src/db/ids.ts`'s `naturalKeys` has no
 * entry for them) — every row in those tables is a plain uuidv7 and is
 * never a source of a map entry, so they are not resolved here.
 */
export async function buildIdRemap(
  bundle: ExportBundle,
  sourceUserId: string,
  targetUserId: string,
): Promise<ReadonlyMap<string, string>> {
  const idMap = new Map<string, string>();
  await resolvePersons(bundle, sourceUserId, targetUserId, idMap);
  await resolveCategories(bundle, sourceUserId, targetUserId, idMap);
  await resolvePaymentSources(bundle, sourceUserId, targetUserId, idMap);
  await resolveFxRates(bundle, sourceUserId, targetUserId, idMap);
  await resolveSettings(bundle, sourceUserId, targetUserId, idMap);
  await resolveInvestmentProfiles(bundle, sourceUserId, targetUserId, idMap);
  await resolveInstallmentPlans(bundle, sourceUserId, targetUserId, idMap);
  await resolveComputedColumns(bundle, sourceUserId, targetUserId, idMap);
  await resolveBalanceAdjustments(bundle, sourceUserId, targetUserId, idMap);
  await resolveCategoryBudgets(bundle, sourceUserId, targetUserId, idMap);
  await resolveCellNotes(bundle, sourceUserId, targetUserId, idMap);
  await resolveCreditCardStatements(bundle, sourceUserId, targetUserId, idMap);
  await resolveExpectedPayments(bundle, sourceUserId, targetUserId, idMap);
  await resolveTransactions(bundle, idMap);
  return idMap;
}

const IMPORT_BATCH_KEY_RE = /^import_batch:\d+$/;

function remapIdArray(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => (typeof entry === "string" ? idMap.get(entry) ?? entry : entry));
}

/**
 * Rewrite the ids embedded inside a `settings.value` JSON payload.
 * `column_years` (`src/domain/settings.ts`) holds category ids; the
 * `computed-columns.tsx` screen persists `computed_columns_hidden` as
 * computed-column ids under the same key name (also decoded there); and
 * `import_batch:<year>` (`src/data/repo/imports.ts`, NOT one of the fixed
 * `SettingKey`s decoded in `domain/settings.ts` — it is read as a raw JSON
 * blob) holds transaction/cell-note/installment-plan ids from that year's
 * spreadsheet import. A malformed value is left untouched: the existing
 * validator already rejects it, downstream, on its own terms.
 */
function remapSettingsValue(key: string, value: string, idMap: ReadonlyMap<string, string>): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (key === "column_years") {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return value;
      const out: Record<string, unknown> = {};
      for (const [year, ids] of Object.entries(parsed as Record<string, unknown>)) out[year] = remapIdArray(ids, idMap);
      return JSON.stringify(out);
    }
    if (key === "computed_columns_hidden") {
      if (!Array.isArray(parsed)) return value;
      return JSON.stringify(remapIdArray(parsed, idMap));
    }
    if (IMPORT_BATCH_KEY_RE.test(key)) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return value;
      const batch = parsed as Record<string, unknown>;
      const out: Record<string, unknown> = { ...batch };
      if ("transactions" in batch) out.transactions = remapIdArray(batch.transactions, idMap);
      if ("cellNotes" in batch) out.cellNotes = remapIdArray(batch.cellNotes, idMap);
      if ("installmentPlans" in batch) out.installmentPlans = remapIdArray(batch.installmentPlans, idMap);
      return JSON.stringify(out);
    }
    return value;
  } catch {
    return value;
  }
}

/**
 * Rewrite the category ids embedded inside a `computed_columns.definition`
 * JSON payload (`sum`/`difference` ops list category ids; see
 * `src/domain/computed-columns.ts`). Malformed JSON is left untouched —
 * `isValidImportRow` rejects it downstream on its own terms.
 */
function remapComputedColumnDefinition(value: string, idMap: ReadonlyMap<string, string>): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return value;
    const definition = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = { ...definition };
    if ("categoryIds" in definition) out.categoryIds = remapIdArray(definition.categoryIds, idMap);
    if ("plusCategoryIds" in definition) out.plusCategoryIds = remapIdArray(definition.plusCategoryIds, idMap);
    if ("minusCategoryIds" in definition) out.minusCategoryIds = remapIdArray(definition.minusCategoryIds, idMap);
    return JSON.stringify(out);
  } catch {
    return value;
  }
}

function remapRow(
  table: SyncedTableName,
  row: Record<string, unknown>,
  idMap: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    // Every foreign-key-shaped column, not a hand-listed subset: `isValidImportRow`
    // already treats `id` and every `*_id` column as an id for validation, and
    // that same generic rule is what guarantees this remap cannot miss one
    // (a hand-list is exactly how a column gets missed).
    if ((key === "id" || key.endsWith("_id")) && typeof value === "string" && idMap.has(value)) {
      out[key] = idMap.get(value);
      continue;
    }
    if (table === "settings" && key === "value" && typeof value === "string") {
      out[key] = remapSettingsValue(String(row.key ?? ""), value, idMap);
      continue;
    }
    if (table === "computed_columns" && key === "definition" && typeof value === "string") {
      out[key] = remapComputedColumnDefinition(value, idMap);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Apply `idMap` to every row of `bundle`: its own `id`, every `*_id` column,
 * and the ids embedded in JSON (`computed_columns.definition`,
 * `settings.value` for `column_years`/`computed_columns_hidden`/`import_batch:*`).
 * An empty map returns `bundle` itself unchanged — the same-account restore
 * path this guarantees never touches a row.
 */
export function applyIdRemap(bundle: ExportBundle, idMap: ReadonlyMap<string, string>): ExportBundle {
  if (idMap.size === 0) return bundle;
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(bundle.tables)) {
    tables[table] = rows.map((row) => remapRow(table as SyncedTableName, row, idMap));
  }
  return { ...bundle, tables };
}
