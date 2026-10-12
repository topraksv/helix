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
 * `tests/services/backup-round-trip.test.ts` for the executable proof.
 */

import { deterministicId, naturalKeys } from "../db/ids";
import { declaredMonthOf } from "../domain/balance-declaration";
import { isISODate } from "../domain/dates";
import type { SyncedTableName } from "../db/schema";
import type { ExportBundle } from "./backup-validation";

/** `deterministicId` forces the UUID version nibble (index 14) to "8"; `uuidv7` always writes "7" there. */
export function isDeterministicId(id: unknown): id is string {
  return typeof id === "string" && id.length === 36 && id[14] === "8";
}

/**
 * Every natural-key constructor must have one remap resolver. Keeping this
 * exhaustive map beside the algorithm makes adding a new deterministic id a
 * compile-time event instead of a silent restore regression.
 *
 * @public
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
  monthOpeningDeclaration: "balance_adjustments",
  planPayoff: "transactions",
  investmentProfile: "investment_profiles",
  importSource: "payment_sources",
  importInstallmentPlan: "installment_plans",
  ccColumn: "computed_columns",
  matrixColor: "matrix_colors",
  statementTx: "transactions",
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

type Row = Record<string, unknown>;
/**
 * A row's natural key under `userId`, or null when the row cannot carry this
 * template. `ref` reads a referenced id: as stored on the source side, through
 * the map on the target side, so a parent table must be resolved first.
 */
type Template = (userId: string, row: Row, ref: (value: unknown) => string) => string | null;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function remappedOrSame(idMap: ReadonlyMap<string, string>, value: unknown): string {
  const id = String(value ?? "");
  return idMap.get(id) ?? id;
}

function deterministicRows(bundle: ExportBundle, table: SyncedTableName): Row[] {
  return (bundle.tables[table] ?? []).filter((row) => isDeterministicId(row.id));
}

function record(idMap: Map<string, string>, id: string, targetHash: string): void {
  if (targetHash !== id) idMap.set(id, targetHash);
}

/**
 * Each row takes the first template, tried in order, that proves its id; the
 * rows none proves are returned. Templates are tried per row rather than per
 * pass so a later row's `ref` sees exactly the map entries it always saw.
 */
async function resolveTemplates(
  rows: Row[],
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
  templates: Template[],
): Promise<Row[]> {
  const sourceRef = (value: unknown) => String(value ?? "");
  const targetRef = (value: unknown) => remappedOrSame(idMap, value);
  const unresolved: Row[] = [];
  for (const row of rows) {
    const id = row.id as string;
    let proved = false;
    for (const template of templates) {
      const sourceKey = template(sourceUserId, row, sourceRef);
      if (sourceKey == null || (await deterministicId(sourceKey)) !== id) continue;
      record(idMap, id, await deterministicId(template(targetUserId, row, targetRef) as string));
      proved = true;
      break;
    }
    if (!proved) unresolved.push(row);
  }
  return unresolved;
}

/** Precomputes source→target hash pairs for every index once, so resolving N
 *  rows costs O(cap), not O(cap × N). */
async function resolveByIndex(
  rows: Row[],
  template: (userId: string, index: number) => string,
  sourceUserId: string,
  targetUserId: string,
  idMap: Map<string, string>,
): Promise<void> {
  if (rows.length === 0) return;
  const targetBySource = new Map<string, string>();
  for (let index = 0; index < ONBOARDING_INDEX_CAP; index++) {
    const sourceHash = await deterministicId(template(sourceUserId, index));
    const targetHash = await deterministicId(template(targetUserId, index));
    targetBySource.set(sourceHash, targetHash);
  }
  for (const row of rows) {
    const id = row.id as string;
    const targetHash = targetBySource.get(id);
    if (targetHash != null) record(idMap, id, targetHash);
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
  const resolve = (table: SyncedTableName, ...templates: Template[]) =>
    resolveTemplates(deterministicRows(bundle, table), sourceUserId, targetUserId, idMap, templates);
  const resolveRest = (rows: Row[], template: (userId: string, index: number) => string) =>
    resolveByIndex(rows, template, sourceUserId, targetUserId, idMap);

  await resolveRest(await resolve("persons", (userId) => naturalKeys.selfPerson(userId)), naturalKeys.onboardingPerson);
  await resolve("categories", (userId, row) => naturalKeys.seedCategory(userId, text(row.name)));
  await resolveRest(
    await resolve("payment_sources", (userId, row) => naturalKeys.importSource(userId, text(row.name))),
    naturalKeys.onboardingSource,
  );
  await resolve("fx_rates", (userId, row) => naturalKeys.fxRate(userId, text(row.currency), text(row.rate_date)));
  await resolve("settings", (userId, row) => naturalKeys.setting(userId, text(row.key)));
  await resolve("investment_profiles", (userId) => naturalKeys.investmentProfile(userId));
  await resolve("installment_plans", (userId, row) => naturalKeys.importInstallmentPlan(
    userId,
    text(row.title),
    typeof row.monthly_amount_minor === "number" ? row.monthly_amount_minor : NaN,
    typeof row.installment_count === "number" ? row.installment_count : NaN,
    text(row.start_month),
  ));
  // The one auto-created "KK Taksit" computed column, tombstoned on sight in newer builds.
  await resolve("computed_columns", (userId) => naturalKeys.ccColumn(userId));
  await resolve(
    "balance_adjustments",
    (userId, row) => naturalKeys.balanceAdjustment(userId, text(row.date)),
    // A declaration sits on the last day of the month before the one it
    // opens, so its month is read back off that date.
    (userId, row) => {
      const date = text(row.date);
      return isISODate(date) ? naturalKeys.monthOpeningDeclaration(userId, declaredMonthOf(date)) : null;
    },
  );
  await resolve("category_budgets", (userId, row, ref) =>
    naturalKeys.categoryBudget(userId, text(row.month), ref(row.category_id)));
  await resolve("cell_notes", (userId, row, ref) => naturalKeys.cellNote(userId, text(row.month), ref(row.category_id)));
  // `item_key` is a category id for row/cell marks; `remapRow` rewrites the
  // column and the id has to be recomputed from the SAME rewritten value or
  // the two disagree and a second device creates a duplicate mark.
  await resolve("matrix_colors", (userId, row, ref) =>
    naturalKeys.matrixColor(userId, String(row.scope ?? ""), ref(row.item_key), String(row.month ?? "")));
  // A statement line's own identity carries no other row's id, so it has no
  // ordering constraint.
  await resolve("transactions", (userId, row) => {
    const importKey = String(row.import_key ?? "");
    return importKey === "" ? null : naturalKeys.statementTx(userId, importKey);
  });
  await resolve("credit_card_statements", (userId, row, ref) =>
    naturalKeys.cardStatement(userId, ref(row.payment_source_id), text(row.period_month)));
  // Active kinds point at a subscription or recurring income, neither of which
  // carries a deterministic id; retired installment/loan tombstones still
  // remap here so an old backup remains lossless.
  await resolve("expected_payments", (userId, row, ref) =>
    naturalKeys.expected(userId, text(row.kind), ref(row.ref_id), text(row.due_date)));

  // `installmentTx`, `planPayoff` and `confirmTx` carry no userId. `confirmTx`'s
  // `expectedId` is not a column on the transaction row; it is recovered from
  // the one `expected_payments` row (if any) whose `transaction_id` names this
  // transaction — "the transaction created by confirming this expected item".
  const expectedIdByTransactionId = new Map<string, string>();
  for (const row of bundle.tables.expected_payments ?? []) {
    if (typeof row.transaction_id === "string" && typeof row.id === "string") {
      expectedIdByTransactionId.set(row.transaction_id, row.id);
    }
  }
  await resolve(
    "transactions",
    (_userId, row, ref) => typeof row.installment_plan_id === "string" && typeof row.installment_no === "number"
      ? naturalKeys.installmentTx(ref(row.installment_plan_id), row.installment_no)
      : null,
    (_userId, row, ref) => typeof row.installment_plan_id === "string" && row.installment_no == null
      ? naturalKeys.planPayoff(ref(row.installment_plan_id))
      : null,
    (_userId, row, ref) => {
      const expectedId = expectedIdByTransactionId.get(row.id as string);
      return expectedId == null ? null : naturalKeys.confirmTx(ref(expectedId));
    },
  );
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
      for (const field of ["transactions", "cellNotes", "installmentPlans"]) {
        if (field in batch) out[field] = remapIdArray(batch[field], idMap);
      }
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
    for (const field of ["categoryIds", "plusCategoryIds", "minusCategoryIds"]) {
      if (field in definition) out[field] = remapIdArray(definition[field], idMap);
    }
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
    //
    // `matrix_colors.item_key` is a category id for a row/cell mark and a
    // computed-column key otherwise, so it is a foreign key the `*_id` rule
    // cannot see. Without it, restoring into another account leaves every
    // colour pointing at the source account's categories — the marks survive
    // and silently stop matching anything.
    const isIdColumn = key === "id" || key.endsWith("_id") || (table === "matrix_colors" && key === "item_key");
    if (isIdColumn && typeof value === "string" && idMap.has(value)) {
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
 * `matrix_colors.item_key`, and the ids embedded in JSON
 * (`computed_columns.definition`, `settings.value` for
 * `column_years`/`computed_columns_hidden`/`import_batch:*`).
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
