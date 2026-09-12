import { getSqliteAsync } from "../../db/client";
import { tr } from "../../i18n/tr";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { fromDbShape, nowIso, readSetting, writeRowsValidated, type RowWrite } from "../../db/mutations";
import type { ImportBatchKey } from "../../domain/settings";
import { addMonthsToKey, lastDayOf, todayISO, yearOf, type MonthKey } from "../../domain/dates";
import type { PaymentSourceType } from "../../domain/types";
import type { Minor } from "../../domain/money";
import { isValidCardCycle, type CardCycle } from "../../domain/card-statements";
import { collectInstallmentPlans, type ParsedSheet } from "../../services/spreadsheet-import";
import { suggestCategoryIcon } from "../../domain/category-icons";
import { nameMentions } from "../../domain/logo-domain";
import { CreditCardCycleRequiredError, ImportBatchUnreadableError } from "./errors";
import { buildPlanRows, linkDueRowsToCardStatements } from "./installments";
import { buildSpreadsheetImportPlan, importCategoryKey } from "./import-plan";
import { assertInvestmentWrites } from "./investment-validation";

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
      const generated = await sqlite.getAllAsync<{ id: string; installment_plan_id: string }>(
        `SELECT id, installment_plan_id FROM transactions
         WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL`,
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
    const rows = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...chunk],
    );
    writes.push(...rows.map((row) => ({ table, row: { ...fromDbShape(table, row), deletedAt: nowIso() } })));
  }
  return writes;
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
export async function importSheets(userId: string, req: ImportRequest): Promise<{ imported: number; plans: number }> {
  const sqlite = await getSqliteAsync();
  // `selfId` crosses the UI/file boundary and becomes the owner of every
  // imported transaction/source/plan. Never trust the preview's cached person
  // object: an account switch or crafted caller could otherwise persist a
  // foreign/stale reference locally and leave the whole import queued for an
  // RLS failure. Validate it at the repository boundary before planning any
  // writes.
  const self = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM persons
     WHERE id = ? AND user_id = ? AND is_self = 1 AND deleted_at IS NULL`,
    [req.selfId, userId],
  );
  if (!self) throw new Error("Import owner must be the live self person");
  // Read with the rest of the up-front queries: a card section named after
  // someone the owner already tracks belongs to that person, and which rows
  // reach the balance turns on it.
  const otherPersons = await sqlite.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM persons WHERE user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
    [userId],
  );
  const existing = await sqlite.getAllAsync<{
    id: string;
    name: string;
    kind: "expense" | "income";
    sort_order: number;
    is_transfer: number;
    [key: string]: unknown;
  }>(
    `SELECT * FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const normalizedName = (name: string) => name.trim().toLocaleLowerCase("tr-TR");
  const idByNameAndKind = new Map(existing.map((c) => [importCategoryKey(c.name, c.kind), c.id]));
  let sortSeed = existing.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
  // Query payment sources up front too, so the whole import — categories, rows,
  // reconstructed installment cards + plans — flushes in ONE writeRows. A read
  // issued AFTER a multi-thousand-row write starved the sqlite worker and hung.
  const existingSources = await sqlite.getAllAsync<{
    id: string;
    name: string;
    type: PaymentSourceType;
    statement_day: number | null;
    due_day: number | null;
    [key: string]: unknown;
  }>(
    `SELECT * FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
  );
  const sourceByName = new Map(existingSources.map((s) => [normalizedName(s.name), s]));
  const sourceIdByName = new Map(
    existingSources.filter((source) => source.type === "credit_card").map((source) => [normalizedName(source.name), source.id]),
  );
  const requestedCycles = new Map(
    Object.entries(req.cardCycles ?? {}).map(([name, cycle]) => [normalizedName(name), cycle]),
  );

  const catWrites: RowWrite[] = [];
  const categoryById = new Map(existing.map((category) => [category.id, category]));
  const ensureCategory = (label: string, kind: "expense" | "income", isTransfer = false): string => {
    const cleanLabel = label.trim();
    const key = importCategoryKey(cleanLabel, kind);
    let id = idByNameAndKind.get(key);
    if (!id) {
      id = newId();
      idByNameAndKind.set(key, id);
      catWrites.push({
        table: "categories",
        row: {
          id,
          name: cleanLabel,
          kind,
          icon: suggestCategoryIcon(cleanLabel, kind),
          color: null,
          sortOrder: sortSeed++,
          isColumn: true,
          isTransfer: kind === "expense" && isTransfer,
          deletedAt: null,
        },
      });
    } else {
      const existingCategory = categoryById.get(id);
      if (existingCategory && kind === "expense" && isTransfer && existingCategory.is_transfer !== 1) {
        existingCategory.is_transfer = 1;
        catWrites.push({
          table: "categories",
          row: { ...fromDbShape("categories", existingCategory), isTransfer: true },
        });
      }
    }
    return id;
  };

  const selectedYears = req.selectedYears ? new Set(req.selectedYears) : null;
  const yearAllowed = (y: number) => !selectedYears || selectedYears.has(y);

  const affectedYears = [...new Set(req.sheets.flatMap((s) => s.months.map(yearOf)))].filter(yearAllowed);
  const { batches: priorBatches, unreadableYears } = await importBatchMap(userId);
  // Both modes replace the batch ownership record for an affected year. If its
  // previous value is unreadable, add mode would preserve neither the old row
  // ids nor a way to clean them later, so it must fail closed too.
  const blocked = affectedYears.filter((year) => unreadableYears.has(year));
  if (blocked.length > 0) throw new ImportBatchUnreadableError(blocked.sort((a, b) => a - b));
  const cleanupWrites: RowWrite[] = [];
  // Build the replacement cleanup first, but don't mutate anything yet. Rows
  // still owned by an unaffected year's batch are protected. Cleanup + new
  // import + batch/settings metadata are committed by one writeRows below.
  if (req.mode === "replace") {
    const affected = new Set(affectedYears);
    const protectedTransactions = new Set<string>();
    const protectedNotes = new Set<string>();
    const protectedPlans = new Set<string>();
    const protectedAdjustments = new Set<string>();
    for (const [year, batch] of priorBatches) {
      if (affected.has(year)) continue;
      batch.transactions.forEach((id) => protectedTransactions.add(id));
      batch.cellNotes.forEach((id) => protectedNotes.add(id));
      batch.installmentPlans?.forEach((id) => protectedPlans.add(id));
      batch.adjustments?.forEach((id) => protectedAdjustments.add(id));
    }
    const oldTransactions = affectedYears.flatMap((year) => priorBatches.get(year)?.transactions ?? []).filter((id) => !protectedTransactions.has(id));
    const oldNotes = affectedYears.flatMap((year) => priorBatches.get(year)?.cellNotes ?? []).filter((id) => !protectedNotes.has(id));
    const oldPlans = affectedYears.flatMap((year) => priorBatches.get(year)?.installmentPlans ?? []).filter((id) => !protectedPlans.has(id));
    const oldAdjustments = affectedYears.flatMap((year) => priorBatches.get(year)?.adjustments ?? []).filter((id) => !protectedAdjustments.has(id));
    cleanupWrites.push(
      ...(await tombstoneImportRows(userId, "transactions", oldTransactions)),
      ...(await tombstoneImportRows(userId, "cell_notes", oldNotes)),
      ...(await tombstoneImportRows(userId, "installment_plans", oldPlans)),
      ...(await tombstoneImportRows(userId, "balance_adjustments", oldAdjustments)),
    );
  }

  const txWrites: RowWrite[] = [];
  const noteWrites: RowWrite[] = [];
  const batchByYear = new Map<number, ImportBatch>();
  const columnYearsUpdates = new Map<number, string[]>();
  const today = todayISO();
  let imported = 0;
  const batchFor = (y: number): ImportBatch => {
    let b = batchByYear.get(y);
    if (!b) batchByYear.set(y, (b = { version: 2, transactions: [], cellNotes: [], installmentPlans: [], adjustments: [] }));
    return b;
  };

  // Resolve categories before invoking the pure planner. No SQL/write happens
  // while cells are mapped, and invalid plans cannot partially commit.
  for (const sheet of req.sheets) {
    if (!sheet.months.some((month) => yearAllowed(yearOf(month)))) continue;
    for (const column of sheet.columns) {
      if (!req.excludedLabels.includes(column.label)) {
        ensureCategory(column.label, column.kindGuess, column.isInvestment);
      }
    }
  }
  /**
   * What the workbook states for one column in one month, keyed
   * `${month}|${label}`: a figure, `null` for a column that is there and left
   * empty, and absent for a month whose sheet does not carry that column at
   * all. The three are different facts and the instalment rules below turn on
   * which one it is.
   */
  const statedCells = new Map<string, Minor | null>();
  const statedMonths = new Set<MonthKey>();
  for (const sheet of req.sheets) {
    sheet.columns.forEach((column, index) => {
      if (req.excludedLabels.includes(column.label)) return;
      sheet.months.forEach((month, row) => {
        if (!yearAllowed(yearOf(month))) return;
        const value = sheet.cells[row]?.[index]?.valueMinor ?? null;
        statedCells.set(`${month}|${column.label}`, value);
        if (value != null) statedMonths.add(month);
      });
    });
  }

  /**
   * Whose card a reconstructed section is.
   *
   * A workbook tracks more cards than it pays. The owner's file keeps two of
   * their partner's under her own name — "Betül Business", "Betül Axess" —
   * watched but deliberately outside the table, which is what a non-self
   * person IS in this app: rows that are recorded and never counted. Matching
   * the card against the people the owner already created is what makes that
   * distinction survive an import instead of landing on the balance.
   *
   * Whole-word and at least three letters, the same bar the logo matcher uses:
   * a two-letter name would claim "Ev Kredisi" for a person called Ev.
   */
  const cardOwner = (card: string): { id: string; isSelf: boolean } => {
    const person = otherPersons.find((entry) => entry.name.trim().length >= 3 && nameMentions(card, entry.name));
    return person ? { id: person.id, isSelf: false } : { id: req.selfId, isSelf: true };
  };

  // Plans are collected before the cells are planned, because a cell whose
  // instalments add up to it is written AS those instalments.
  const collectedPlans = collectInstallmentPlans(req.sheets, {
    excludedLabels: req.excludedLabels,
    informationalCards: req.informationalCards,
    yearAllowed,
  });
  const planTotals = new Map<string, Minor>();
  for (const spec of collectedPlans) {
    // Another person's card is not inside the owner's column total, so it can
    // neither add up to a cell nor be double-counted by one.
    if (!cardOwner(spec.card).isSelf) continue;
    for (let index = 0; index < spec.total; index += 1) {
      const key = `${addMonthsToKey(spec.startMonth, index)}|${spec.columnLabel}`;
      planTotals.set(key, (planTotals.get(key) ?? 0) + spec.monthlyMinor);
    }
  }
  /**
   * What the plans already put into a cell, so it writes only the rest.
   *
   * Every instalment a comment names becomes a real row with its card, its
   * title and its payment number, and the cell keeps the difference — which
   * makes the column total exactly what the workbook says while the Taksitler
   * screen shows the whole schedule. The difference is not always positive:
   * the owner's "Kredi Kartı Taksitler" column is the card statements MINUS
   * the single-charge column beside it, so it reads 18.822,92 where the
   * instalments on their own cards come to 16.799,84 in one month and
   * 16.504,85 in the next.
   */
  const coveredByPlans = (month: MonthKey, label: string): Minor => {
    // Only a cell that CARRIES A FIGURE has anything to reduce. Empty and zero
    // are not a statement of zero — they are the workbook not having reached
    // that cell yet, which is where the schedule earns its keep. Measured on
    // the owner's file: the current month's card column was still blank, and
    // treating blank as zero cancelled its instalments against a −25.162,14
    // correction row while the two months AFTER it, blank in every column,
    // showed theirs. Same fact, opposite answers, one month apart.
    return statedCells.get(`${month}|${label}`) ? planTotals.get(`${month}|${label}`) ?? 0 : 0;
  };
  const sheetPlan = buildSpreadsheetImportPlan({
    sheets: req.sheets,
    excludedLabels: new Set(req.excludedLabels),
    selectedYears,
    categoryIds: idByNameAndKind,
    today,
    instalmentTotal: coveredByPlans,
    remainderNote: tr.importer.columnRemainder,
  });
  for (const [year, ids] of sheetPlan.columnYears) columnYearsUpdates.set(year, ids);
  // What each imported month does to the balance. Only the re-anchor
  // arithmetic below needs it, and only the loops that write the rows can
  // produce it without walking them a second time.
  const netByMonth = new Map<MonthKey, Minor>();
  const addNet = (month: MonthKey, minor: Minor) => netByMonth.set(month, (netByMonth.get(month) ?? 0) + minor);
  for (const cell of sheetPlan.cells) {
    const batch = batchFor(cell.year);
    for (const item of cell.items) {
      const id = newId();
      // Keep reversals signed in their original category. A refund reduces
      // expense distribution instead of masquerading as income under an
      // expense category.
      const amount = item.amountMinor;
      txWrites.push({
        table: "transactions",
        row: {
          id,
          type: cell.type,
          amountMinor: amount,
          currency: "TRY",
          fxRate: null,
          amountTryMinor: amount,
          entryDate: today,
          purchaseDate: null,
          effectiveDate: cell.effectiveDate,
          status: cell.status,
          categoryId: cell.categoryId,
          paymentSourceId: null,
          personId: req.selfId,
          installmentPlanId: null,
          installmentNo: null,
          cardStatementId: null,
          subscriptionId: null,
          // Every imported row is dateless (month-level): shown by month and
          // never surfaced as an upcoming payment, whatever the cell shape.
          isAggregate: true,
          note: item.note,
          origin: "spreadsheet",
          // The batch index (`import_batch:<year>`) already records which rows
          // a workbook year produced, and replacing a year tombstones exactly
          // those. A per-cell key would be a second, competing identity for
          // the same fact — and a workbook cell has no stable line id to build
          // one from, so it would be invented rather than observed.
          importKey: null,
          deletedAt: null,
        },
      });
      addNet(cell.month, cell.type === "income" ? amount : -amount);
      batch.transactions.push(id);
      imported++;
    }
    if (cell.cellNote) {
      const noteId = await deterministicId(naturalKeys.cellNote(userId, cell.month, cell.categoryId));
      noteWrites.push({
        table: "cell_notes",
        row: { id: noteId, month: cell.month, categoryId: cell.categoryId, body: cell.cellNote, deletedAt: null },
      });
      batch.cellNotes.push(noteId);
    }
  }

  // Reconstruct installment plans from the "…Taksitli…" comments (deduped across
  // the months they appear in), create/match a payment source per card, then
  // build each plan's rows. Everything is flushed with the ledger rows in ONE
  // write below (deterministic ids → re-import converges, no dups).
  /**
   * The months a reconstructed plan may write a ledger row for.
   *
   * A month the workbook states belongs to the workbook: its column cells
   * already carry that month's instalment inside a total, and a plan row on
   * top of it is the same money twice — measured on the owner's file as an
   * "Ev Kredisi" of 23.672,13 showing 46.000 — so wherever the plan's own
   * column is there to be reduced, `coveredByPlans` takes the instalment back
   * out of it and the month totals what it always did. What a plan may NOT
   * reach is a month whose sheet does not carry its column at all: that money
   * is inside some other column, with nothing to reduce, and writing the row
   * would count it twice. The owner's home loan moved between two columns
   * across years and is exactly that case. A month no sheet states is free,
   * and a year the owner did not select stays empty rather than receiving rows
   * it never asked for.
   */
  const openMonths = (spec: { startMonth: MonthKey; total: number; columnLabel: string; card: string }): MonthKey[] => {
    // A card that is somebody else's keeps its whole schedule unconditionally:
    // those rows never reach the balance, so no column can be counting them.
    const watched = !cardOwner(spec.card).isSelf;
    return Array.from({ length: spec.total }, (_, index) => addMonthsToKey(spec.startMonth, index))
      .filter((month) => yearAllowed(yearOf(month))
        && (watched || !statedMonths.has(month) || statedCells.has(`${month}|${spec.columnLabel}`)));
  };

  const planSpecs = collectedPlans.filter((spec) => openMonths(spec).length > 0);
  const sourceWrites: RowWrite[] = [];
  const cycleByName = new Map<string, CardCycle>();
  for (const spec of planSpecs) {
    const key = normalizedName(spec.card);
    const existingSource = sourceByName.get(key);
    const existingCycle = existingSource
      ? { statementDay: existingSource.statement_day, dueDay: existingSource.due_day }
      : null;
    // The cycle is optional. A workbook names every card a comment mentions —
    // a partner's, a shop card, one that turns out to be a debit card — and
    // demanding a statement and a due day for each of them before anything can
    // be imported asks the owner to invent dates for cards they do not hold.
    // Without one the instalment simply falls on its own month, which is where
    // every other imported row falls anyway.
    const requested = requestedCycles.get(key);
    const cycle = existingCycle && isValidCardCycle(existingCycle)
      ? existingCycle
      : requested && isValidCardCycle(requested) ? requested : null;
    if (cycle) cycleByName.set(key, cycle);
    if (sourceIdByName.has(key)) {
      if (cycle && existingSource && !isValidCardCycle(existingCycle!)) {
        sourceWrites.push({
          table: "payment_sources",
          row: {
            ...fromDbShape("payment_sources", existingSource),
            statementDay: cycle.statementDay,
            dueDay: cycle.dueDay,
          },
        });
      }
      continue;
    }
    const id = await deterministicId(naturalKeys.importSource(userId, spec.card));
    sourceIdByName.set(key, id);
    sourceWrites.push({
      table: "payment_sources",
      row: {
        id, name: spec.card, type: "credit_card", personId: cardOwner(spec.card).id,
        dueDay: cycle?.dueDay ?? null, statementDay: cycle?.statementDay ?? null,
        color: null, logoSource: "initials", logoRef: null, isActive: true, deletedAt: null,
      },
    });
  }
  const planRowBatches = await Promise.all(
    planSpecs.map(async (spec) => {
      const sourceId = sourceIdByName.get(normalizedName(spec.card));
      const cycle = cycleByName.get(normalizedName(spec.card)) ?? null;
      if (!sourceId) throw new CreditCardCycleRequiredError();
      const owner = cardOwner(spec.card);
      const planId = await deterministicId(naturalKeys.importInstallmentPlan(userId, spec.name, spec.monthlyMinor, spec.total, spec.startMonth));
      const built = await buildPlanRows(planId, {
        title: spec.name,
        kind: "card_installment",
        totalAmountMinor: null,
        monthlyAmountMinor: spec.monthlyMinor,
        installmentCount: spec.total,
        currency: "TRY",
        fxRate: null,
        startMonth: spec.startMonth,
        dueDay: cycle?.dueDay ?? null,
        paymentSourceId: sourceId,
        personId: owner.id,
        personIsSelf: owner.isSelf,
        categoryId:
          idByNameAndKind.get(importCategoryKey(spec.columnLabel, "expense")) ??
          idByNameAndKind.get(importCategoryKey(spec.columnLabel, "income")) ??
          null,
        note: null,
        tryFactor: 1,
      }, today);
      const open = new Set(openMonths(spec));
      const rows = built.rows.filter(
        (row) => row.table !== "transactions" || open.has(String(row.row.effectiveDate).slice(0, 7)),
      );
      // No cycle, no statement to link to: the rows stand on their own months.
      const linked = cycle ? await linkDueRowsToCardStatements(userId, sourceId, cycle, rows) : rows;
      return { ...built, rows: linked, planId, spec };
    }),
  );
  for (const built of planRowBatches) {
    // A watched card's rows are recorded and never counted, so they must not
    // move the re-anchor arithmetic either.
    if (cardOwner(built.spec.card).isSelf) {
      for (const row of built.rows) {
        if (row.table === "transactions") addNet(String(row.row.effectiveDate).slice(0, 7) as MonthKey, -Number(row.row.amountTryMinor));
      }
    }
    const startYear = yearOf(built.spec.startMonth);
    const endYear = yearOf(addMonthsToKey(built.spec.startMonth, built.spec.total - 1));
    for (const year of affectedYears) {
      if (year < startYear || year > endYear) continue;
      const batch = batchFor(year);
      batch.installmentPlans!.push(built.planId);
      batch.transactions.push(
        ...built.rows.filter((row) => row.table === "transactions").map((row) => String(row.row.id)),
      );
    }
  }
  imported += planSpecs.length;

  const { writes: anchorWrites, anchorMonth, anchorMinor } = await anchorFromImport(
    userId,
    req.sheets,
    yearAllowed,
    req.adoptOpeningBalance === true,
    req.openingColumnLabel ?? null,
  );
  /**
   * Where the workbook restarts its own running balance, the ledger restarts
   * with it.
   *
   * A sheet's first month states what was really in hand — reconciled against
   * a bank, typed by hand — and the months before it do not add up to that
   * figure: the file this was measured against is 24.592,14 out at Ağustos
   * 2022 and 7.500,00 out at Ocak 2024. Carrying our own sum across those
   * points reproduces the drift the owner had already corrected, in a ledger
   * that then disagrees with every balance in the file from there on.
   *
   * The row lands on the last day of the month BEFORE, so the stated month
   * opens on the stated figure rather than closing on it.
   */
  const adjustmentWrites: RowWrite[] = [];
  // Only an import the ledger's anchor BELONGS TO may restate the balance along
  // the way: the arithmetic starts from that anchor, and a ledger this workbook
  // is merely being added to has a history no cell here can account for. Owning
  // it is not the same as having just written it — re-importing a workbook the
  // ledger is already anchored to writes no anchor and still owns the chain,
  // and testing for the write dropped both corrections on every second import.
  if (anchorMonth != null) {
    const stated = statedOpenings(req.sheets, yearAllowed, req.openingColumnLabel ?? null);
    const targetByMonth = new Map(stated.filter((entry) => entry.minor != null).map((entry) => [entry.month, entry.minor!]));
    let running = anchorMinor;
    for (const month of [...new Set([...netByMonth.keys(), ...targetByMonth.keys()])].sort()) {
      const target = targetByMonth.get(month);
      if (target != null && month !== anchorMonth && target !== running) {
        const date = lastDayOf(addMonthsToKey(month, -1));
        const id = await deterministicId(naturalKeys.balanceAdjustment(userId, date));
        adjustmentWrites.push({
          table: "balance_adjustments",
          row: { id, date, amountMinor: target - running, note: tr.importer.openingRestated, deletedAt: null },
        });
        batchFor(yearOf(month)).adjustments!.push(id);
        running = target;
      }
      running += netByMonth.get(month) ?? 0;
    }
  }

  // Settings and data are part of the SAME transaction as replacement
  // tombstones. The persisted batch can therefore never claim a half-import.
  const metadataWrites: RowWrite[] = [];
  const columnYears = (await readSetting<Record<string, string[]>>(userId, COLUMN_YEARS_KEY)) ?? {};
  for (const [year, ids] of columnYearsUpdates) {
    columnYears[String(year)] = req.mode === "add"
      ? [...new Set([...(columnYears[String(year)] ?? []), ...ids])]
      : ids;
  }
  metadataWrites.push(await settingWrite(userId, COLUMN_YEARS_KEY, columnYears));

  // Record batches (add mode keeps prior ids so a later replace still cleans up).
  for (const year of affectedYears) {
    const batch = batchByYear.get(year) ?? { version: 2 as const, transactions: [], cellNotes: [], installmentPlans: [], adjustments: [] };
    if (req.mode === "add") {
      const prev = priorBatches.get(year);
      batch.transactions = [...new Set([...(prev?.transactions ?? []), ...batch.transactions])];
      batch.cellNotes = [...new Set([...(prev?.cellNotes ?? []), ...batch.cellNotes])];
      batch.installmentPlans = [...new Set([...(prev?.installmentPlans ?? []), ...(batch.installmentPlans ?? [])])];
      batch.adjustments = [...new Set([...(prev?.adjustments ?? []), ...(batch.adjustments ?? [])])];
    }
    metadataWrites.push(await settingWrite(userId, importBatchKey(year), batch));
  }

  metadataWrites.push(...anchorWrites);
  const writes = [
    ...cleanupWrites,
    ...catWrites,
    ...sourceWrites,
    ...txWrites,
    ...noteWrites,
    ...planRowBatches.flatMap((b) => b.rows),
    ...adjustmentWrites,
    ...metadataWrites,
  ];
  if (writes.length > 0) {
    await writeRowsValidated(
      userId,
      writes,
      (db) => assertInvestmentWrites(db, userId, writes).then(() => undefined),
    );
  }
  return { imported, plans: planSpecs.length };
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
  yearAllowed: (year: number) => boolean = () => true,
  columnLabel?: string | null,
): { month: MonthKey; minor: Minor | null }[] {
  return sheets
    .flatMap((sheet) => {
      const first = sheet.months
        .map((month, row) => ({ month, row }))
        .filter((entry) => yearAllowed(yearOf(entry.month)))
        .sort((a, b) => a.month.localeCompare(b.month))[0];
      if (!first) return [];
      const label = columnLabel ?? sheet.openingColumn;
      const column = label == null ? -1 : sheet.columns.findIndex((entry) => entry.label === label);
      const minor = column < 0 ? null : sheet.cells[first.row]?.[column]?.valueMinor ?? null;
      return [{ month: first.month, minor }];
    })
    .sort((a, b) => a.month.localeCompare(b.month));
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
 * not the workbook states a figure of its own. The balance is the opening plus
 * every row, with no regard for whether a row predates the anchor — so an
 * anchor left later than the data does not merely look untidy, it adds the
 * whole imported history on top of a figure that described a later moment.
 * Measured on the owner's file: a first run that opened at 50.000,00 for Eylül
 * 2026 and then imported from Ağustos 2021 read 70.953,72 where the same
 * workbook into an empty workspace reads −16.462,53.
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
): Promise<{ writes: RowWrite[]; anchorMonth: MonthKey | null; anchorMinor: Minor }> {
  const none = { writes: [], anchorMonth: null, anchorMinor: 0 };
  const opening = openingBalanceFromSheets(sheets, yearAllowed, columnLabel);
  if (!opening) return none;
  const currentStart = await readSetting<string>(userId, "start_month");
  // Earlier data always wins without being asked. Moving the anchor later, or
  // restating it where the workbook starts at the same month, is the owner's
  // call and arrives as `adopt`.
  if (adopt || !currentStart || opening.month < currentStart) {
    return {
      writes: [
        await settingWrite(userId, "start_month", opening.month),
        await settingWrite(userId, "opening_balance_minor", opening.minor ?? 0),
      ],
      anchorMonth: opening.month,
      anchorMinor: opening.minor ?? 0,
    };
  }
  // The anchor is already this workbook's — a second import of the same file.
  // Nothing moves, and the chain still starts here, from the figure the ledger
  // actually holds rather than the one this run would have written.
  if (currentStart === opening.month) {
    return { writes: [], anchorMonth: opening.month, anchorMinor: (await readSetting<Minor>(userId, "opening_balance_minor")) ?? 0 };
  }
  return none;
}
