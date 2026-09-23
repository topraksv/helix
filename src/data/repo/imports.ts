import { getSqliteAsync } from "../../db/client";
import { tr } from "../../i18n/tr";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { fromDbShape, nowIso, readSetting, writeRowsValidated, type RowWrite } from "../../db/mutations";
import type { ImportBatchKey } from "../../domain/settings";
import { addMonthsToKey, lastDayOf, monthKeyOf, todayISO, yearOf, type ISODate, type MonthKey } from "../../domain/dates";
import type { PaymentSourceType } from "../../domain/types";
import type { Minor } from "../../domain/money";
import { isValidCardCycle, type CardCycle } from "../../domain/card-statements";
import { planForSighting } from "../../domain/installments";
import { collectInstallmentPlans, type ParsedSheet, type WorkbookRecords } from "../../services/spreadsheet-import";
import {
  folded,
  quantityKey,
  recordKey,
  SUBSCRIPTION_HEADERS,
  WORKBOOK_SHEETS,
  type InvestmentRecord,
  type RecordProblem,
  type SubscriptionRecord,
} from "../../domain/workbook-format";
import { suggestCategoryIcon } from "../../domain/category-icons";
import { nameMentions } from "../../domain/logo-domain";
import { ImportBatchUnreadableError } from "./errors";
import { buildPlanRows, linkDueRowsToCardStatements } from "./installments";
import { buildSpreadsheetImportPlan, importCategoryKey } from "./import-plan";
import { assertInvestmentWrites } from "./investment-validation";
import { addInvestmentOperation, saveInvestmentProduct, updateInvestmentOperation } from "./investments";
import { ensureSubscriptionCategory, upsertSubscription, type SubscriptionInput } from "./rules";

// ---------------------------------------------------------------------------
// Spreadsheet import (faithful, multi-year, per-year columns)
// ---------------------------------------------------------------------------

interface ImportBatch {
  version?: 2;
  transactions: string[];
  cellNotes: string[];
  installmentPlans?: string[];
  /** Re-anchor rows written where the workbook restarts its own balance. */
  adjustments?: string[];
}

export interface ImportRequest {
  /** Sheets the user chose to import (already picked from the workbook). */
  sheets: ParsedSheet[];
  /** Column labels to skip (by label, case-sensitive to the parsed label). */
  excludedLabels: string[];
  /** Only import months in these years; omit to import every year found. */
  selectedYears?: number[];
  /** Which balance column holds the month-opening figure, when the owner said. */
  openingColumnLabel?: string | null;
  selfId: string;
  /** How to treat a year that was already imported before. */
  mode: "replace" | "add";
  /** Card/section names flagged "ℹ️ informational" in the workbook — their
   *  installments are skipped (they must not hit the balance). */
  informationalCards?: string[];
  /** Explicit cycles for cards reconstructed from installment comments. Keys
   *  are card names; existing configured cards win. */
  cardCycles?: Record<string, CardCycle>;
  /**
   * Adopt the workbook's own opening-balance cell as the ledger anchor even
   * when an anchor already exists at that month or earlier.
   *
   * The default is not to: a second import must not quietly move the anchor a
   * first one established. But the default also meant the FIRST import's answer
   * was permanent — re-importing a corrected workbook could never put a wrong
   * opening balance right, and the whole chained ledger hangs off it. The
   * importer states which figure it read and lets the owner say.
   */
  adoptOpeningBalance?: boolean;
}

const importBatchKey = (year: number): ImportBatchKey => `import_batch:${year}`;
const COLUMN_YEARS_KEY = "column_years";

function parseImportBatch(value: string): ImportBatch | null {
  try {
    const parsed = JSON.parse(value) as Partial<ImportBatch>;
    if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.cellNotes)) return null;
    return {
      version: parsed.version === 2 ? 2 : undefined,
      transactions: parsed.transactions.filter((id): id is string => typeof id === "string"),
      cellNotes: parsed.cellNotes.filter((id): id is string => typeof id === "string"),
      installmentPlans: Array.isArray(parsed.installmentPlans)
        ? parsed.installmentPlans.filter((id): id is string => typeof id === "string")
        : [],
      adjustments: Array.isArray(parsed.adjustments)
        ? parsed.adjustments.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return null;
  }
}

interface ImportBatchIndex {
  batches: Map<number, ImportBatch>;
  /** Years whose batch record exists but could not be parsed. */
  unreadableYears: Set<number>;
}

async function importBatchMap(userId: string): Promise<ImportBatchIndex> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE user_id = ? AND key LIKE 'import_batch:%' AND deleted_at IS NULL`,
    [userId],
  );
  const result = new Map<number, ImportBatch>();
  const unreadableYears = new Set<number>();
  for (const row of rows) {
    const year = Number(row.key.slice("import_batch:".length));
    if (!Number.isInteger(year)) continue;
    const batch = parseImportBatch(row.value);
    // "Absent" and "present but unreadable" are different facts: the first
    // means nothing was imported for that year, the second means we cannot
    // tell what to replace.
    if (batch) result.set(year, batch);
    else unreadableYears.add(year);
  }
  // Batch v1 did not record reconstructed plans or their generated rows. A
  // deterministic-id check identifies those legacy imported plans without
  // ever touching user-created UUIDv7 plans, then reconstructs ownership so a
  // first v2 replacement can clean them safely.
  if ([...result.values()].some((batch) => batch.version !== 2)) {
    const plans = await sqlite.getAllAsync<{
      id: string;
      title: string;
      monthly_amount_minor: number | null;
      installment_count: number;
      start_month: MonthKey;
    }>(
      `SELECT id, title, monthly_amount_minor, installment_count, start_month
       FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`,
      [userId],
    );
    const importedPlanIds = new Set<string>();
    // The SHA-256 digests are independent — compute them in parallel instead
    // of awaiting one per plan.
    const expectedIds = await Promise.all(
      plans.map((plan) =>
        plan.monthly_amount_minor == null
          ? null
          : deterministicId(
              naturalKeys.importInstallmentPlan(userId, plan.title, plan.monthly_amount_minor, plan.installment_count, plan.start_month),
            ),
      ),
    );
    plans.forEach((plan, index) => {
      if (expectedIds[index] !== plan.id) return;
      importedPlanIds.add(plan.id);
      const startYear = yearOf(plan.start_month);
      const endYear = yearOf(addMonthsToKey(plan.start_month, plan.installment_count - 1));
      for (const [year, batch] of result) {
        if (year >= startYear && year <= endYear) batch.installmentPlans = [...new Set([...(batch.installmentPlans ?? []), plan.id])];
      }
    });
    if (importedPlanIds.size > 0) {
      // The plan's GENERATED instalments, and only those. A refund recorded
      // against an imported purchase is linked to the same plan but typed by
      // hand, and replacing a batch leaves what a person entered alone.
      const generated = await sqlite.getAllAsync<{ id: string; installment_plan_id: string }>(
        `SELECT id, installment_plan_id FROM transactions
         WHERE user_id = ? AND installment_plan_id IS NOT NULL AND installment_no IS NOT NULL
           AND deleted_at IS NULL`,
        [userId],
      );
      const byPlan = new Map<string, string[]>();
      for (const row of generated) {
        if (!importedPlanIds.has(row.installment_plan_id)) continue;
        const ids = byPlan.get(row.installment_plan_id) ?? [];
        ids.push(row.id);
        byPlan.set(row.installment_plan_id, ids);
      }
      for (const batch of result.values()) {
        const ids = (batch.installmentPlans ?? []).flatMap((planId) => byPlan.get(planId) ?? []);
        batch.transactions = [...new Set([...batch.transactions, ...ids])];
      }
    }
  }
  return { batches: result, unreadableYears };
}

async function settingWrite(userId: string, key: string, value: unknown): Promise<RowWrite> {
  return {
    table: "settings",
    row: {
      id: await deterministicId(naturalKeys.setting(userId, key)),
      key,
      value: JSON.stringify(value),
      deletedAt: null,
    },
  };
}

async function tombstoneImportRows(
  userId: string,
  table: "transactions" | "cell_notes" | "installment_plans" | "balance_adjustments",
  ids: Iterable<string>,
): Promise<RowWrite[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const chunk = uniqueIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    // Live rows only. One already deleted keeps its own moment, and undoing a
    // loan closure restores exactly the rows that share the closure's.
    const rows = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
      [userId, ...chunk],
    );
    writes.push(...rows.map((row) => ({ table, row: { ...fromDbShape(table, row), deletedAt: nowIso() } })));
  }
  return writes;
}

interface ImportedPlanClosure { closed_on: string; installment_count: number; kind: string }

/**
 * A closed plan's rows as its closure left them: nothing due after the closing
 * day, the count it ended on, and the loan the owner turned it into — which is
 * what keeps the closure undoable on its screen.
 */
function withinClosure(rows: RowWrite[], closure: ImportedPlanClosure | undefined): RowWrite[] {
  if (!closure) return rows;
  return rows
    .filter((write) => write.table !== "transactions" || String(write.row.effectiveDate) <= closure.closed_on)
    .map((write) => (write.table === "installment_plans"
      ? { ...write, row: { ...write.row, kind: closure.kind, installmentCount: closure.installment_count } }
      : write));
}

/** Years (of the given set) that already carry a prior import batch. */
export async function importedYears(userId: string, years: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const year of [...new Set(years)]) {
    const prev = await readSetting<ImportBatch>(userId, importBatchKey(year));
    if (prev && (prev.transactions?.length || prev.cellNotes?.length || prev.installmentPlans?.length || prev.adjustments?.length)) out.push(year);
  }
  return out;
}

/**
 * True when a spreadsheet import has written at least one year's batch. Read
 * from persisted settings (not a live query) so onboarding can decide — at the
 * exact moment it commits — whether the workbook already governs the columns,
 * without racing the reactive `import_batch` live query.
 */
export async function hasImportedData(userId: string): Promise<boolean> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM settings WHERE user_id = ? AND key LIKE 'import_batch:%' AND deleted_at IS NULL`,
    [userId],
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Import parsed sheets 1:1 into the ledger (spec §3.1e). Categories are matched
 * by name (or created as columns), each year records its own ordered column set
 * (`column_years`), formula/comment breakdowns become itemized rows or a cell
 * note (see `planImportCell`), and the earliest month's opening balance seeds
 * the ledger anchor. Re-importing a year either replaces its prior batch or
 * adds on top. Everything is additive elsewhere — existing manual rows are
 * never touched.
 */
type CategoryRow = { id: string; name: string; kind: "expense" | "income"; sort_order: number; is_transfer: number; [key: string]: unknown };
type SourceRow = { id: string; name: string; type: PaymentSourceType; statement_day: number | null; due_day: number | null; [key: string]: unknown };
type PlanSpec = ReturnType<typeof collectInstallmentPlans>[number];
type BatchFor = (year: number) => ImportBatch;

const normalizedName = (name: string) => name.trim().toLocaleLowerCase("tr-TR");
const emptyBatch = (): ImportBatch => ({ version: 2, transactions: [], cellNotes: [], installmentPlans: [], adjustments: [] });
const cycleOf = (source: SourceRow | undefined): CardCycle | null => {
  const cycle = { statementDay: source?.statement_day, dueDay: source?.due_day };
  return isValidCardCycle(cycle) ? { statementDay: cycle.statementDay!, dueDay: cycle.dueDay! } : null;
};

/**
 * Everything the import reads, read before it writes: the whole import flushes
 * in one write, and a read issued after a multi-thousand-row write starved the
 * SQLite worker and hung.
 */
async function importWorkspace(userId: string, selfId: string) {
  const sqlite = await getSqliteAsync();
  // `selfId` crosses the UI boundary and owns every imported row: a stale or
  // crafted one would queue the whole import for an RLS failure.
  const self = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM persons WHERE id = ? AND user_id = ? AND is_self = 1 AND deleted_at IS NULL`,
    [selfId, userId],
  );
  if (!self) throw new Error("Import owner must be the live self person");
  const [otherPersons, categories, sources, closed] = await Promise.all([
    sqlite.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM persons WHERE user_id = ? AND is_self = 0 AND deleted_at IS NULL`, [userId]),
    sqlite.getAllAsync<CategoryRow>(`SELECT * FROM categories WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
    sqlite.getAllAsync<SourceRow>(`SELECT * FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`, [userId]),
    // A loan closed in the app stays closed through a re-import (owner decision, 2026-09-14).
    sqlite.getAllAsync<ImportedPlanClosure & { id: string }>(
      `SELECT id, closed_on, installment_count, kind FROM installment_plans WHERE user_id = ? AND closed_on IS NOT NULL`,
      [userId],
    ),
  ]);
  return { otherPersons, categories, sources, closures: new Map(closed.map((plan) => [plan.id, plan])) };
}

/** The table each kind of row a batch records lives in. */
const BATCH_TABLES = { transactions: "transactions", cellNotes: "cell_notes", installmentPlans: "installment_plans", adjustments: "balance_adjustments" } as const;
const BATCH_KINDS = Object.keys(BATCH_TABLES) as (keyof typeof BATCH_TABLES)[];

/** What a replace takes back: the rows of every year it re-imports that no untouched year's batch still owns. */
async function replacedBatchRows(userId: string, affectedYears: number[], priorBatches: Map<number, ImportBatch>) {
  const affected = new Set(affectedYears);
  const writes: RowWrite[] = [];
  const replaced = new Set<string>();
  for (const kind of BATCH_KINDS) {
    const kept = new Set([...priorBatches].filter(([year]) => !affected.has(year)).flatMap(([, batch]) => batch[kind] ?? []));
    const taken = affectedYears.flatMap((year) => priorBatches.get(year)?.[kind] ?? []).filter((id) => !kept.has(id));
    writes.push(...(await tombstoneImportRows(userId, BATCH_TABLES[kind], taken)));
    if (kind === "transactions") taken.forEach((id) => replaced.add(id));
  }
  return { writes, replaced };
}

/** Column categories: found by name and kind, created once otherwise; an investment column is a transfer. */
function columnCategories(existing: CategoryRow[]) {
  const idByNameAndKind = new Map(existing.map((category) => [importCategoryKey(category.name, category.kind), category.id]));
  const byId = new Map(existing.map((category) => [category.id, category]));
  const writes: RowWrite[] = [];
  let sortOrder = existing.reduce((highest, category) => Math.max(highest, category.sort_order), -1) + 1;
  const ensure = (label: string, kind: "expense" | "income", isTransfer: boolean) => {
    const name = label.trim();
    const key = importCategoryKey(name, kind);
    const id = idByNameAndKind.get(key);
    const known = id ? byId.get(id) : undefined;
    if (!id) {
      const created = newId();
      idByNameAndKind.set(key, created);
      writes.push({
        table: "categories",
        row: { id: created, name, kind, icon: suggestCategoryIcon(name, kind), color: null, sortOrder: sortOrder++, isColumn: true, isTransfer: kind === "expense" && isTransfer, deletedAt: null },
      });
    } else if (known && kind === "expense" && isTransfer && known.is_transfer !== 1) {
      known.is_transfer = 1;
      writes.push({ table: "categories", row: { ...fromDbShape("categories", known), isTransfer: true } });
    }
  };
  return { ensure, idByNameAndKind, writes };
}

/**
 * What the workbook states for a column in a month, by `${month}|${label}`: a
 * figure, null for a column left empty, and absent where the sheet lacks the
 * column. The plan rules below turn on which of the three it is.
 */
function statedCellsOf(req: ImportRequest, yearAllowed: (year: number) => boolean) {
  const cells = new Map<string, Minor | null>();
  const months = new Set<MonthKey>();
  for (const sheet of req.sheets) {
    sheet.columns.forEach((column, index) => {
      if (req.excludedLabels.includes(column.label)) return;
      sheet.months.forEach((month, row) => {
        if (!yearAllowed(yearOf(month))) return;
        const value = sheet.cells[row]?.[index]?.valueMinor ?? null;
        cells.set(`${month}|${column.label}`, value);
        if (value != null) months.add(month);
      });
    });
  }
  return { cells, months };
}

/** A row per cell item, a note per annotated cell, and what each month does to the balance. */
async function cellWrites(userId: string, plan: ReturnType<typeof buildSpreadsheetImportPlan>, selfId: string, today: ISODate, batchFor: BatchFor) {
  const writes: RowWrite[] = [];
  const net = new Map<MonthKey, Minor>();
  let count = 0;
  for (const cell of plan.cells) {
    const batch = batchFor(cell.year);
    for (const item of cell.items) {
      const id = newId();
      writes.push({
        table: "transactions",
        row: {
          // Reversals stay signed in their own category rather than becoming income.
          id, type: cell.type, amountMinor: item.amountMinor, currency: "TRY", fxRate: null, amountTryMinor: item.amountMinor,
          entryDate: today, purchaseDate: null, effectiveDate: cell.effectiveDate, status: cell.status, categoryId: cell.categoryId,
          paymentSourceId: null, personId: selfId, installmentPlanId: null, installmentNo: null, cardStatementId: null, subscriptionId: null,
          // Month-level, never an upcoming payment.
          isAggregate: true,
          note: item.note,
          origin: "spreadsheet",
          // The batch record is the identity; a cell has no stable line to key on.
          importKey: null,
          deletedAt: null,
        },
      });
      net.set(cell.month, (net.get(cell.month) ?? 0) + (cell.type === "income" ? item.amountMinor : -item.amountMinor));
      batch.transactions.push(id);
      count += 1;
    }
    if (cell.cellNote) {
      const noteId = await deterministicId(naturalKeys.cellNote(userId, cell.month, cell.categoryId));
      writes.push({ table: "cell_notes", row: { id: noteId, month: cell.month, categoryId: cell.categoryId, body: cell.cellNote, deletedAt: null } });
      batch.cellNotes.push(noteId);
    }
  }
  return { writes, net, count };
}

/**
 * A payment source for every card a plan names: matched by name, created
 * otherwise. The cycle is optional — a workbook names partners' and shop cards
 * too, and without one an instalment falls on its own month like every other row.
 */
async function cardSources(
  userId: string,
  specs: PlanSpec[],
  sources: SourceRow[],
  requested: ImportRequest["cardCycles"],
  ownerOf: (card: string) => { id: string; isSelf: boolean },
) {
  const byName = new Map(sources.map((source) => [normalizedName(source.name), source]));
  const cardIdByName = new Map(sources.filter((source) => source.type === "credit_card").map((source) => [normalizedName(source.name), source.id]));
  const requestedByName = new Map(Object.entries(requested ?? {}).map(([name, cycle]) => [normalizedName(name), cycle]));
  const cycleByName = new Map<string, CardCycle>();
  const writes: RowWrite[] = [];
  for (const spec of specs) {
    const key = normalizedName(spec.card);
    const existing = byName.get(key);
    const asked = requestedByName.get(key);
    const cycle = cycleOf(existing) ?? (asked && isValidCardCycle(asked) ? asked : null);
    if (cycle) cycleByName.set(key, cycle);
    if (cardIdByName.has(key)) {
      if (cycle && existing && !cycleOf(existing)) writes.push({ table: "payment_sources", row: { ...fromDbShape("payment_sources", existing), statementDay: cycle.statementDay, dueDay: cycle.dueDay } });
      continue;
    }
    const id = await deterministicId(naturalKeys.importSource(userId, spec.card));
    cardIdByName.set(key, id);
    writes.push({
      table: "payment_sources",
      row: {
        id, name: spec.card, type: "credit_card", personId: ownerOf(spec.card).id, dueDay: cycle?.dueDay ?? null, statementDay: cycle?.statementDay ?? null,
        color: null, logoSource: "initials", logoRef: null, isActive: true, deletedAt: null,
      },
    });
  }
  return { writes, cardIdByName, cycleByName };
}

/** The openings a workbook states for its months, and the typed balance an import moved the anchor away from. */
function openingTargets(req: ImportRequest, yearAllowed: (year: number) => boolean, today: ISODate, kept: { month: MonthKey; minor: Minor } | null) {
  const columnLabel = req.openingColumnLabel ?? null;
  const targets = new Map(
    [...statedOpenings(req.sheets, yearAllowed, columnLabel), ...statedMonthOpenings(req.sheets, yearAllowed, columnLabel, monthKeyOf(today))]
      .filter((entry) => entry.minor != null)
      .map((entry) => [entry.month, entry.minor!]),
  );
  if (kept) targets.set(kept.month, kept.minor);
  return targets;
}

/** Where the workbook restates its running balance, or the owner declared one, the ledger holds the month to it. */
async function openingDeclarations(input: {
  userId: string;
  req: ImportRequest;
  yearAllowed: (year: number) => boolean;
  today: ISODate;
  anchor: Awaited<ReturnType<typeof anchorFromImport>>;
  net: Map<MonthKey, Minor>;
  priorBatches: Map<number, ImportBatch>;
  batchFor: BatchFor;
}): Promise<RowWrite[]> {
  const { userId, anchor, net, batchFor } = input;
  // Only an import the anchor belongs to may restate along the way; owning it is
  // not the same as having just written it, or every second import dropped them.
  if (anchor.anchorMonth == null) return [];
  const kept = anchor.preservedOpening;
  const targets = openingTargets(input.req, input.yearAllowed, input.today, kept);
  // An opening the owner already declared holds its month; without it a second
  // import restated nothing after a kept balance and dropped what the first did.
  const held = await ownerDeclarations(userId, input.priorBatches);
  const writes: RowWrite[] = [];
  let running = anchor.anchorMinor;
  for (const month of [...new Set([...net.keys(), ...targets.keys(), ...held.keys()])].sort()) {
    const target = held.get(month) ?? targets.get(month);
    if (target != null && !held.has(month) && month !== anchor.anchorMonth && target !== running) {
      const id = await deterministicId(naturalKeys.monthOpeningDeclaration(userId, month));
      const note = month === kept?.month ? tr.importer.openingKept : tr.importer.openingRestated;
      // Dated the last day before, so the month opens on the figure; `amountMinor` is for clients older than declarations.
      writes.push({ table: "balance_adjustments", row: { id, date: lastDayOf(addMonthsToKey(month, -1)), amountMinor: target - running, declaredMinor: target, note, deletedAt: null } });
      // The typed balance is the owner's and outlives this file.
      if (month !== kept?.month) batchFor(yearOf(month)).adjustments!.push(id);
    }
    running = (target ?? running) + (net.get(month) ?? 0);
  }
  return writes;
}

/** Column membership and the batch records for the imported years; add mode keeps what earlier imports owned. */
async function importMetadata(userId: string, req: ImportRequest, affectedYears: number[], priorBatches: Map<number, ImportBatch>, batches: Map<number, ImportBatch>, columnYearsUpdates: Map<number, string[]>) {
  const columnYears = (await readSetting<Record<string, string[]>>(userId, COLUMN_YEARS_KEY)) ?? {};
  for (const [year, ids] of columnYearsUpdates) {
    columnYears[String(year)] = req.mode === "add" ? [...new Set([...(columnYears[String(year)] ?? []), ...ids])] : ids;
  }
  const writes = [await settingWrite(userId, COLUMN_YEARS_KEY, columnYears)];
  for (const year of affectedYears) {
    const batch = batches.get(year) ?? emptyBatch();
    const prior = req.mode === "add" ? priorBatches.get(year) : undefined;
    const merged = { version: 2, ...Object.fromEntries(BATCH_KINDS.map((kind) => [kind, [...new Set([...(prior?.[kind] ?? []), ...(batch[kind] ?? [])])]])) };
    writes.push(await settingWrite(userId, importBatchKey(year), merged));
  }
  return writes;
}

/** What the owner's own plans put into each `${month}|${column}` cell. */
function planTotalsByCell(specs: PlanSpec[]): Map<string, Minor> {
  const totals = new Map<string, Minor>();
  for (const spec of specs) {
    for (let index = 0; index < spec.total; index += 1) {
      const key = `${addMonthsToKey(spec.startMonth, index)}|${spec.columnLabel}`;
      totals.set(key, (totals.get(key) ?? 0) + spec.monthlyMinor);
    }
  }
  return totals;
}

/** Plan rows into the batches of the years they span, and the owner's into each month's net. */
function recordPlanRows(planned: Awaited<ReturnType<typeof planRows>>, affectedYears: number[], batchFor: BatchFor, net: Map<MonthKey, Minor>): void {
  for (const built of planned) {
    const rows = built.rows.filter((write) => write.table === "transactions");
    // A watched card's rows are never counted, so they do not move the re-anchor arithmetic.
    for (const row of built.isSelf ? rows : []) {
      const month = String(row.row.effectiveDate).slice(0, 7) as MonthKey;
      net.set(month, (net.get(month) ?? 0) - Number(row.row.amountTryMinor));
    }
    const [startYear, endYear] = [yearOf(built.spec.startMonth), yearOf(addMonthsToKey(built.spec.startMonth, built.spec.total - 1))];
    for (const year of affectedYears.filter((candidate) => candidate >= startYear && candidate <= endYear)) {
      if (!built.adopted) batchFor(year).installmentPlans!.push(built.planId);
      batchFor(year).transactions.push(...rows.map((row) => String(row.row.id)));
    }
  }
}

export async function importSheets(userId: string, req: ImportRequest): Promise<{ imported: number; plans: number }> {
  const workspace = await importWorkspace(userId, req.selfId);
  const today = todayISO();
  const selectedYears = req.selectedYears ? new Set(req.selectedYears) : null;
  const yearAllowed = (year: number) => !selectedYears || selectedYears.has(year);
  const affectedYears = [...new Set(req.sheets.flatMap((sheet) => sheet.months.map(yearOf)))].filter(yearAllowed);
  const { batches: priorBatches, unreadableYears } = await importBatchMap(userId);
  // Both modes rewrite an affected year's batch; one that cannot be read can be neither replaced nor extended.
  const blocked = affectedYears.filter((year) => unreadableYears.has(year));
  if (blocked.length > 0) throw new ImportBatchUnreadableError(blocked.sort((a, b) => a - b));
  const cleanup = req.mode === "replace" ? await replacedBatchRows(userId, affectedYears, priorBatches) : { writes: [], replaced: new Set<string>() };

  const categories = columnCategories(workspace.categories);
  for (const sheet of req.sheets.filter((candidate) => candidate.months.some((month) => yearAllowed(yearOf(month))))) {
    for (const column of sheet.columns.filter((candidate) => !req.excludedLabels.includes(candidate.label))) {
      categories.ensure(column.label, column.kindGuess, column.isInvestment);
    }
  }
  const batches = new Map<number, ImportBatch>();
  const batchFor: BatchFor = (year) => batches.get(year) ?? batches.set(year, emptyBatch()).get(year)!;
  const stated = statedCellsOf(req, yearAllowed);

  /**
   * Whose card a reconstructed section is: the person it names (whole word, three
   * letters or more), whose rows are recorded and never counted — the owner's file
   * keeps a partner's cards under her name — and otherwise the owner's.
   */
  const cardOwner = (card: string) => {
    const person = workspace.otherPersons.find((entry) => entry.name.trim().length >= 3 && nameMentions(card, entry.name));
    return person ? { id: person.id, isSelf: false } : { id: req.selfId, isSelf: true };
  };
  // Collected before the cells: a cell its instalments add up to is written AS them.
  const plans = collectInstallmentPlans(req.sheets, { excludedLabels: req.excludedLabels, informationalCards: req.informationalCards, yearAllowed });
  const planTotals = planTotalsByCell(plans.filter((spec) => cardOwner(spec.card).isSelf));
  const sheetPlan = buildSpreadsheetImportPlan({
    sheets: req.sheets,
    excludedLabels: new Set(req.excludedLabels),
    selectedYears,
    categoryIds: categories.idByNameAndKind,
    today,
    // The cell writes what its instalments leave, possibly negative (a column kept
    // net of the one beside it). Only a cell carrying a figure is reduced: blank is
    // the workbook not having got there, not zero.
    instalmentTotal: (month, label) => (stated.cells.get(`${month}|${label}`) ? planTotals.get(`${month}|${label}`) ?? 0 : 0),
    remainderNote: tr.importer.columnRemainder,
  });
  const cells = await cellWrites(userId, sheetPlan, req.selfId, today, batchFor);

  /**
   * The months a plan may write: not one whose sheet lacks the plan's column
   * (that money sits in another column with nothing to take it back out of),
   * not an unselected year; a watched card's plan keeps its whole schedule.
   */
  const openMonths = (spec: PlanSpec) => {
    const watched = !cardOwner(spec.card).isSelf;
    return Array.from({ length: spec.total }, (_, index) => addMonthsToKey(spec.startMonth, index))
      .filter((month) => yearAllowed(yearOf(month)) && (watched || !stated.months.has(month) || stated.cells.has(`${month}|${spec.columnLabel}`)));
  };
  const planSpecs = plans.filter((spec) => openMonths(spec).length > 0);
  const sources = await cardSources(userId, planSpecs, workspace.sources, req.cardCycles, cardOwner);
  const planned = await planRows({ userId, req, today, specs: planSpecs, workspace, sources, categoryIds: categories.idByNameAndKind, replaced: cleanup.replaced, cardOwner, openMonths });
  recordPlanRows(planned, affectedYears, batchFor, cells.net);

  const anchor = await anchorFromImport(userId, req.sheets, yearAllowed, req.adoptOpeningBalance === true, req.openingColumnLabel ?? null, priorBatches.size > 0);
  const declarations = await openingDeclarations({ userId, req, yearAllowed, today, anchor, net: cells.net, priorBatches, batchFor });
  // Settings share the write with the tombstones, so a batch record never claims a half-import.
  const metadata = await importMetadata(userId, req, affectedYears, priorBatches, batches, sheetPlan.columnYears);
  const writes = [
    ...cleanup.writes,
    ...categories.writes,
    ...sources.writes,
    ...cells.writes,
    ...planned.flatMap((built) => built.rows),
    ...declarations,
    ...metadata,
    ...anchor.writes,
  ];
  // Never empty: the metadata always restates the column years.
  await writeRowsValidated(userId, writes, (db) => assertInvestmentWrites(db, userId, writes).then(() => undefined));
  return { imported: cells.count + planSpecs.length, plans: planSpecs.length };
}

type PlanTarget = { owner: { id: string; isSelf: boolean }; sourceId: string; cycle: CardCycle | null };

/** Where a plan the owner already holds writes: its own person, and its own card when it has one. */
function heldPlanTarget(plan: { person_id: string; payment_source_id: string | null }, selfId: string, sources: SourceRow[], workbook: PlanTarget): PlanTarget {
  const owner = { id: plan.person_id, isSelf: plan.person_id === selfId };
  const sourceId = plan.payment_source_id;
  return sourceId ? { owner, sourceId, cycle: cycleOf(sources.find((source) => source.id === sourceId)) } : { ...workbook, owner };
}

/** Where a workbook's own plan writes: the card its section names, and whoever that card belongs to. */
function workbookPlanTarget(spec: PlanSpec, sources: Awaited<ReturnType<typeof cardSources>>, cardOwner: (card: string) => { id: string; isSelf: boolean }): PlanTarget {
  // `cardSources` named a card for every plan it was given.
  const sourceId = sources.cardIdByName.get(normalizedName(spec.card))!;
  return { owner: cardOwner(spec.card), sourceId, cycle: sources.cycleByName.get(normalizedName(spec.card)) ?? null };
}

/**
 * Each plan's rows, written into the plan the owner already holds when there is
 * one (`plansAlreadyHeld`), limited to its open months and to what a closure left.
 */
async function planRows(input: {
  userId: string;
  req: ImportRequest;
  today: ISODate;
  specs: PlanSpec[];
  workspace: Awaited<ReturnType<typeof importWorkspace>>;
  sources: Awaited<ReturnType<typeof cardSources>>;
  categoryIds: Map<string, string>;
  replaced: ReadonlySet<string>;
  cardOwner: (card: string) => { id: string; isSelf: boolean };
  openMonths: (spec: PlanSpec) => MonthKey[];
}) {
  const { userId, req, today, specs, workspace, sources, categoryIds, replaced, cardOwner, openMonths } = input;
  const specIds = await Promise.all(specs.map((spec) =>
    deterministicId(naturalKeys.importInstallmentPlan(userId, spec.name, spec.monthlyMinor, spec.total, spec.startMonth))));
  const adoptions = await plansAlreadyHeld(userId, specs, new Set(specIds), replaced);
  return Promise.all(specs.map(async (spec, index) => {
    const adopted = adoptions[index];
    const planId = adopted?.plan.id ?? specIds[index]!;
    const workbook = workbookPlanTarget(spec, sources, cardOwner);
    const { owner, sourceId, cycle } = adopted ? heldPlanTarget(adopted.plan, req.selfId, workspace.sources, workbook) : workbook;
    const built = await buildPlanRows(planId, {
      title: spec.name, kind: "card_installment", totalAmountMinor: null, monthlyAmountMinor: spec.monthlyMinor, installmentCount: spec.total,
      currency: "TRY", fxRate: null, startMonth: spec.startMonth, dueDay: cycle?.dueDay ?? null, paymentSourceId: sourceId,
      personId: owner.id, personIsSelf: owner.isSelf,
      categoryId: adopted?.plan.category_id ?? categoryIds.get(importCategoryKey(spec.columnLabel, "expense")) ?? categoryIds.get(importCategoryKey(spec.columnLabel, "income")) ?? null,
      note: null, tryFactor: 1,
    }, today);
    const open = new Set(openMonths(spec));
    // A plan the owner holds keeps its own row and instalments; the workbook adds the months it lacks.
    const rows = built.rows.filter((row) => row.table === "transactions"
      ? open.has(String(row.row.effectiveDate).slice(0, 7)) && !adopted?.written.has(Number(row.row.installmentNo))
      : !adopted);
    const linked = cycle ? await linkDueRowsToCardStatements(userId, sourceId, cycle, rows) : rows;
    return { rows: withinClosure(linked, workspace.closures.get(planId)), planId, spec, adopted: adopted != null, isSelf: owner.isSelf };
  }));
}

/** Openings the owner declared, by the month each holds, that no import batch owns. */
async function ownerDeclarations(userId: string, batches: ReadonlyMap<number, ImportBatch>): Promise<Map<MonthKey, Minor>> {
  const owned = new Set([...batches.values()].flatMap((batch) => batch.adjustments ?? []));
  const declared = await (await getSqliteAsync()).getAllAsync<{ id: string; date: ISODate; declared_minor: Minor }>(
    `SELECT id, date, declared_minor FROM balance_adjustments WHERE user_id = ? AND declared_minor IS NOT NULL AND deleted_at IS NULL`,
    [userId],
  );
  return new Map(declared.filter((row) => !owned.has(row.id)).map((row) => [addMonthsToKey(monthKeyOf(row.date), 1), row.declared_minor]));
}

/**
 * The live plan each workbook plan already is — entered by hand or opened by a
 * statement under another name — found by schedule (§3.2), card-blind because a
 * workbook renames cards as it renames purchases, with the instalments it holds
 * beyond the rows this import replaces.
 */
async function plansAlreadyHeld(
  userId: string,
  specs: ReturnType<typeof collectInstallmentPlans>,
  workbookIds: ReadonlySet<string>,
  replaced: ReadonlySet<string>,
) {
  const sqlite = await getSqliteAsync();
  const plans = (await sqlite.getAllAsync<{
    id: string; start_month: MonthKey; installment_count: number; total_amount_minor: number | null; monthly_amount_minor: number | null;
    currency: string; payment_source_id: string | null; person_id: string; category_id: string | null;
  }>(`SELECT * FROM installment_plans WHERE user_id = ? AND deleted_at IS NULL`, [userId]))
    .filter((plan) => !workbookIds.has(plan.id))
    .map((plan) => ({
      ...plan,
      startMonth: plan.start_month,
      installmentCount: plan.installment_count,
      totalAmountMinor: plan.total_amount_minor,
      monthlyAmountMinor: plan.monthly_amount_minor,
      paymentSourceId: plan.payment_source_id,
    }));
  const instalments = await sqlite.getAllAsync<{ id: string; installment_plan_id: string; installment_no: number }>(
    `SELECT id, installment_plan_id, installment_no FROM transactions
     WHERE user_id = ? AND installment_plan_id IS NOT NULL AND installment_no IS NOT NULL AND deleted_at IS NULL`,
    [userId],
  );
  const claimed = new Set<string>();
  return specs.map((spec) => {
    const endMonth = addMonthsToKey(spec.startMonth, spec.total - 1);
    const match = planForSighting({ month: spec.startMonth, amountMinor: spec.monthlyMinor, endMonth, startMonth: spec.startMonth, paymentSourceId: null }, plans, claimed);
    if (!match) return null;
    claimed.add(match.plan.id);
    const written = new Set(instalments
      .filter((row) => row.installment_plan_id === match.plan.id && !replaced.has(row.id))
      .map((row) => row.installment_no));
    return { plan: match.plan, written };
  });
}

/**
 * The month-opening figure each imported sheet states for its own first month,
 * earliest first. `minor` is null when no column states one there.
 *
 * A workbook kept by hand does not chain across its sheets: the file this was
 * measured against restarts the running balance in Ağustos 2022 and again in
 * Ocak 2024, because the owner reconciled against the bank and typed what was
 * really there. Those figures are the most reliable data in the file and the
 * only place it admits the arithmetic drifted, so the importer reproduces them
 * rather than carrying its own sum across them.
 */
function statedOpenings(
  sheets: ParsedSheet[],
  yearAllowed: (year: number) => boolean,
  columnLabel?: string | null,
): { month: MonthKey; minor: Minor | null }[] {
  return sheets
    .flatMap((sheet) => {
      const first = sheet.months
        .map((month, row) => ({ month, row }))
        .filter((entry) => yearAllowed(yearOf(entry.month)))
        .sort((a, b) => a.month.localeCompare(b.month))[0];
      if (!first) return [];
      const column = openingColumnIndex(sheet, columnLabel);
      const minor = column < 0 ? null : sheet.cells[first.row]?.[column]?.valueMinor ?? null;
      return [{ month: first.month, minor }];
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

function openingColumnIndex(sheet: ParsedSheet, columnLabel: string | null | undefined): number {
  const label = columnLabel ?? sheet.openingColumn;
  return label == null ? -1 : sheet.columns.findIndex((entry) => entry.label === label);
}

/**
 * Every month-opening figure the imported sheets state, through `throughMonth`.
 *
 * A sheet's opening column is its own running balance, and the formula behind
 * it can change between months: the file this was measured against leaves rent
 * and a conscription payment out of "Kalan" until mid-2023 and counts them
 * after, which left sixteen months up to 5.324,11 out while every cell matched.
 * Holding each stated month to its figure reproduces the file without guessing
 * which columns a month's formula counted. A later month has not happened yet,
 * so its figure is the sheet's forecast rather than a statement.
 */
function statedMonthOpenings(
  sheets: ParsedSheet[],
  yearAllowed: (year: number) => boolean,
  columnLabel: string | null,
  throughMonth: MonthKey,
): { month: MonthKey; minor: Minor }[] {
  return sheets.flatMap((sheet) => {
    const column = openingColumnIndex(sheet, columnLabel);
    if (column < 0) return [];
    return sheet.months.flatMap((month, row) => {
      const minor = sheet.cells[row]?.[column]?.valueMinor;
      return minor != null && month <= throughMonth && yearAllowed(yearOf(month)) ? [{ month, minor }] : [];
    });
  });
}

/**
 * The ledger anchor an import establishes: the earliest month being imported,
 * and the balance to open it with.
 *
 * The month is the earliest one IMPORTED, never the earliest one that happens
 * to carry a balance column. A workbook whose first year has no opening column
 * — the owner's 2021 sheet is exactly that — used to anchor at a later year
 * instead, and the chain then back-computed the earlier months from it and
 * opened them thousands in the red. Anchoring where the data starts is also
 * what the owner describes: the first month opens at the figure given for it,
 * or at zero, and every month after it opens at the one before's close.
 *
 * Exported so the importer can SHOW what it is about to adopt. The whole
 * chained ledger hangs off this one number, and it was being written with
 * nothing on screen naming it.
 */
export function openingBalanceFromSheets(
  sheets: ParsedSheet[],
  yearAllowed: (year: number) => boolean = () => true,
  columnLabel?: string | null,
): { month: MonthKey; minor: Minor | null } | null {
  return statedOpenings(sheets, yearAllowed, columnLabel)[0] ?? null;
}

/**
 * Seed the ledger anchor from the earliest imported month.
 *
 * An import that reaches back before the configured anchor MOVES it, whether or
 * not the workbook states a figure of its own. That is the owner's rule — the
 * workbook's first month opens at the figure given for it, or at zero — and not
 * an arithmetic necessity: left alone, the ledger chain back-computes the
 * earlier months to keep the balance typed for the configured month, and the
 * imported history then disagrees with the workbook it came from. The cost is
 * that a current balance typed at setup gives way to the one the workbook's
 * history produces; measured 2026-09-13 on the owner's file, same rows, 30.657,28
 * kept against −18.053,53 adopted.
 *
 * The figure is the workbook's where it states one and zero where it does not,
 * which is what the owner describes: the first month opens at the figure given
 * for it, or at zero, and every month after it opens at the one before's close.
 */
async function anchorFromImport(
  userId: string,
  sheets: ParsedSheet[],
  yearAllowed: (y: number) => boolean,
  adopt: boolean,
  columnLabel: string | null,
  importedBefore: boolean,
): Promise<{
  writes: RowWrite[];
  anchorMonth: MonthKey | null;
  anchorMinor: Minor;
  /** The typed opening this import moved the anchor away from, kept as a declaration. */
  preservedOpening: { month: MonthKey; minor: Minor } | null;
}> {
  const none = { writes: [], anchorMonth: null, anchorMinor: 0, preservedOpening: null };
  const opening = openingBalanceFromSheets(sheets, yearAllowed, columnLabel);
  if (!opening) return none;
  const currentStart = await readSetting<MonthKey>(userId, "start_month");
  // Earlier data always wins without being asked. Moving the anchor later, or
  // restating it where the workbook starts at the same month, is the owner's
  // call and arrives as `adopt`.
  if (adopt || !currentStart || opening.month < currentStart) {
    // Reaching back before an anchor the owner set by hand used to throw the
    // balance they typed away (measured 2026-09-13: 30.657,28 became
    // −18.053,53). It is kept as that month's declared opening instead, so the
    // history reads as the file says and the present as the owner said. Only
    // a figure someone actually typed: an anchor an earlier import wrote is the
    // file's own, and a zero is the setup screen's empty optional field.
    const currentOpening = currentStart ? await readSetting<Minor>(userId, "opening_balance_minor") : null;
    const preservedOpening = !adopt && currentStart && opening.month < currentStart && !importedBefore && currentOpening
      ? { month: currentStart, minor: currentOpening }
      : null;
    return {
      writes: [
        await settingWrite(userId, "start_month", opening.month),
        await settingWrite(userId, "opening_balance_minor", opening.minor ?? 0),
      ],
      anchorMonth: opening.month,
      anchorMinor: opening.minor ?? 0,
      preservedOpening,
    };
  }
  // The anchor is already this workbook's — a second import of the same file.
  // Nothing moves, and the chain still starts here, from the figure the ledger
  // actually holds rather than the one this run would have written.
  if (currentStart === opening.month) {
    return { writes: [], anchorMonth: opening.month, anchorMinor: (await readSetting<Minor>(userId, "opening_balance_minor")) ?? 0, preservedOpening: null };
  }
  return none;
}

// ---------------------------------------------------------------------------
// Record sheets read back from a Helix workbook (Abonelikler, Yatırımlar)
// ---------------------------------------------------------------------------

interface RecordCounts {
  added: number;
  updated: number;
  unchanged: number;
}

export interface RecordImportPlan {
  subscriptions: RecordCounts;
  investments: RecordCounts;
  /** Rows that cannot land as they are, named by row and heading. */
  problems: RecordProblem[];
  /** Investment rows wait for the investment wallet; they are skipped, and said to be. */
  walletMissing: boolean;
}

type LiveRow = Record<string, unknown>;

/** Everything a record row is matched against, read once. */
interface RecordContext {
  selfId: string | null;
  persons: Map<string, string>;
  sources: Map<string, string>;
  expenseCategories: Map<string, string>;
  subscriptions: Map<string, LiveRow>;
  products: Map<string, string>;
  operations: Map<string, LiveRow>;
  hasWallet: boolean;
}

const operationKey = (productId: string, day: unknown, kind: unknown, quantity: unknown): string =>
  recordKey(productId, String(day), String(kind), quantityKey(quantity == null ? null : String(quantity)));

async function recordContext(userId: string): Promise<RecordContext> {
  const sqlite = await getSqliteAsync();
  const live = (table: string) =>
    sqlite.getAllAsync<LiveRow>(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`, [userId]);
  const [persons, sources, categories, subscriptions, products, operations, wallets] = await Promise.all([
    live("persons"), live("payment_sources"), live("categories"), live("subscriptions"),
    live("investment_products"), live("investment_operations"), live("investment_profiles"),
  ]);
  const byName = (rows: LiveRow[]) => new Map(rows.map((row) => [folded(String(row.name)), String(row.id)]));
  const self = persons.find((person) => Number(person.is_self) === 1);
  return {
    selfId: self ? String(self.id) : null,
    persons: byName(persons),
    sources: byName(sources),
    expenseCategories: byName(categories.filter((category) => category.kind === "expense")),
    subscriptions: new Map(subscriptions.map((row) => [recordKey(String(row.name), String(row.cycle)), row])),
    products: new Map(products.map((row) => [recordKey(String(row.name), String(row.asset_type)), String(row.id)])),
    operations: new Map(operations.map((row) => [operationKey(String(row.product_id), row.operation_date, row.kind, row.quantity), row])),
    hasWallet: wallets.length > 0,
  };
}

const noCounts = (): RecordCounts => ({ added: 0, updated: 0, unchanged: 0 });

function tally(existing: LiveRow | undefined, same: (row: LiveRow) => boolean): keyof RecordCounts {
  if (!existing) return "added";
  return same(existing) ? "unchanged" : "updated";
}

/**
 * A subscription row as `upsertSubscription` takes it, or the heading of the
 * name nobody in this workspace has. A missing category is not a problem: the
 * write creates it, the way the subscription form does.
 */
function subscriptionTarget(
  record: SubscriptionRecord,
  context: RecordContext,
): { input: SubscriptionInput; categoryName: string; existing: LiveRow | undefined } | RecordProblem {
  const problem = (column: string): RecordProblem => ({ sheet: WORKBOOK_SHEETS.subscriptions, row: record.row, column });
  const personId = record.person === "" ? context.selfId : context.persons.get(folded(record.person));
  if (!personId) return problem(SUBSCRIPTION_HEADERS.person);
  const sourceId = record.source === "" ? null : context.sources.get(folded(record.source));
  if (sourceId === undefined) return problem(SUBSCRIPTION_HEADERS.source);
  const existing = context.subscriptions.get(recordKey(record.name, record.cycle));
  const categoryName = record.category || tr.subs.suggestedCategoryName;
  return {
    existing,
    categoryName,
    input: {
      id: existing ? String(existing.id) : undefined,
      name: record.name,
      amountMinor: record.amountMinor,
      amountMode: record.amountMode,
      currency: record.currency,
      cycle: record.cycle,
      intervalMonths: record.intervalMonths,
      billingDay: record.billingDay,
      nextDueDate: record.nextDueDate,
      paymentSourceId: sourceId,
      categoryId: context.expenseCategories.get(folded(categoryName)) ?? "",
      personId,
      isActive: record.isActive,
      trialEndDate: record.trialEndDate,
      autoPay: record.autoPay,
      websiteDomain: record.websiteDomain || null,
      // The sheet has no note column, so a matched subscription keeps its own.
      note: existing?.note == null ? null : String(existing.note),
    },
  };
}

/** Whether saving `input` over `row` would change nothing a person can see. */
function sameSubscription(row: LiveRow, input: SubscriptionInput): boolean {
  const pairs: [unknown, unknown][] = [
    [row.name, input.name], [row.amount_minor, input.amountMinor], [row.currency, input.currency],
    [row.amount_mode, input.amountMode], [row.interval_months, input.intervalMonths], [row.billing_day, input.billingDay],
    [row.next_due_date, input.nextDueDate], [row.trial_end_date ?? null, input.trialEndDate], [row.category_id, input.categoryId],
    [row.payment_source_id ?? null, input.paymentSourceId], [row.person_id, input.personId],
    [Boolean(row.auto_pay), input.autoPay], [Boolean(row.is_active), input.isActive], [row.website_domain ?? null, input.websiteDomain],
  ];
  return pairs.every(([stored, next]) => stored === next);
}

function sameOperation(row: LiveRow, record: InvestmentRecord): boolean {
  return (record.unitPriceMinor == null || row.unit_price_minor === record.unitPriceMinor)
    && (record.totalMinor == null || row.total_minor === record.totalMinor)
    && folded(String(row.note ?? "")) === folded(record.note);
}

/** What the record sheets would add, update and leave alone, without writing anything. */
export function planWorkbookRecords(userId: string, records: WorkbookRecords): Promise<RecordImportPlan> {
  return walkWorkbookRecords(userId, records, false);
}

/**
 * Bring the record sheets in (owner decision, 2026-09-14): a subscription
 * matching by name and cycle, or an operation by product, day, kind and
 * quantity, is updated; anything else is added; nothing is deleted.
 *
 * Each row goes through the validated write its own screen uses, one at a
 * time, so a row the app refuses — a sale beyond what is held, a card without a
 * cycle — is reported by its row and the rest still land. Matching is what
 * makes a second run of the same file converge instead of duplicating.
 */
export function importWorkbookRecords(userId: string, records: WorkbookRecords): Promise<RecordImportPlan> {
  return walkWorkbookRecords(userId, records, true);
}

/**
 * The preview is the import's matching with its writes left out, not a second
 * copy of it: a row the sheet repeats has to meet what the row before it
 * wrote, or would have, or the preview promises two additions where the import
 * makes one. The checks those writes make are left out with them, so a row the
 * app would refuse — a sale beyond what is held — is counted here and reported
 * only by the import.
 */
async function walkWorkbookRecords(userId: string, records: WorkbookRecords, write: boolean): Promise<RecordImportPlan> {
  const context = await recordContext(userId);
  const outcome: RecordImportPlan = {
    subscriptions: noCounts(),
    investments: noCounts(),
    problems: [...records.problems],
    walletMissing: records.investments.length > 0 && !context.hasWallet,
  };
  for (const record of records.subscriptions) await importSubscriptionRecord(userId, record, context, outcome, write);
  if (!context.hasWallet) return outcome;
  // Oldest first, so a sale meets the purchase it sells.
  const byDay = [...records.investments].sort((a, b) => a.operationDate.localeCompare(b.operationDate));
  for (const record of byDay) await importInvestmentRecord(userId, record, context, outcome, write);
  return outcome;
}

async function importSubscriptionRecord(
  userId: string,
  record: SubscriptionRecord,
  context: RecordContext,
  outcome: RecordImportPlan,
  write: boolean,
): Promise<void> {
  const target = subscriptionTarget(record, context);
  if ("sheet" in target) {
    outcome.problems.push(target);
    return;
  }
  const change = tally(target.existing, (row) => sameSubscription(row, target.input));
  try {
    if (change !== "unchanged") {
      let id = target.input.id;
      if (write) {
        const categoryId = target.input.categoryId || await ensureSubscriptionCategory(userId, target.categoryName);
        context.expenseCategories.set(folded(target.categoryName), categoryId);
        id = await upsertSubscription(userId, { ...target.input, categoryId });
      }
      // A second row for the same subscription updates this one rather than adding another.
      context.subscriptions.set(recordKey(record.name, record.cycle), { id, note: target.input.note });
    }
    outcome.subscriptions[change] += 1;
  } catch {
    outcome.problems.push({ sheet: WORKBOOK_SHEETS.subscriptions, row: record.row, column: null });
  }
}

async function importInvestmentRecord(
  userId: string,
  record: InvestmentRecord,
  context: RecordContext,
  outcome: RecordImportPlan,
  write: boolean,
): Promise<void> {
  try {
    const productKey = recordKey(record.product, record.assetType);
    // A preview names a product it has not created by its key, which no stored id can equal.
    const productId = context.products.get(productKey)
      ?? (write ? await saveInvestmentProduct(userId, { assetType: record.assetType, name: record.product, marketCode: record.marketCode || null }) : productKey);
    context.products.set(productKey, productId);
    const key = operationKey(productId, record.operationDate, record.kind, record.quantity);
    const existing = context.operations.get(key);
    const change = tally(existing, (row) => sameOperation(row, record));
    const input = {
      productId,
      kind: record.kind,
      operationDate: record.operationDate,
      quantity: record.quantity,
      unitPriceMinor: record.unitPriceMinor,
      totalMinor: record.totalMinor,
      note: record.note || null,
    };
    if (change === "added") {
      const id = write ? await addInvestmentOperation(userId, input) : key;
      context.operations.set(key, { id, unit_price_minor: record.unitPriceMinor, total_minor: record.totalMinor, note: record.note });
    } else if (change === "updated" && write) {
      await updateInvestmentOperation(userId, String(existing!.id), input);
    }
    outcome.investments[change] += 1;
  } catch {
    outcome.problems.push({ sheet: WORKBOOK_SHEETS.investments, row: record.row, column: null });
  }
}
