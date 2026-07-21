import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { fromDbShape, nowIso, readSetting, writeRows, type RowWrite } from "../../db/mutations";
import { addMonthsToKey, todayISO, yearOf, type MonthKey } from "../../domain/dates";
import type { PaymentSourceType } from "../../domain/types";
import { isValidCardCycle, type CardCycle } from "../../domain/card-statements";
import { collectInstallmentPlans, type ParsedSheet } from "../../services/spreadsheet-import";
import { suggestCategoryIcon } from "../category-icons";
import { CreditCardCycleRequiredError, ImportBatchUnreadableError } from "./errors";
import { buildPlanRows, linkDueRowsToCardStatements } from "./installments";
import { buildSpreadsheetImportPlan, importCategoryKey } from "./import-plan";

// ---------------------------------------------------------------------------
// Spreadsheet import (faithful, multi-year, per-year columns)
// ---------------------------------------------------------------------------

interface ImportBatch {
  version?: 2;
  transactions: string[];
  cellNotes: string[];
  installmentPlans?: string[];
}

export interface ImportRequest {
  /** Sheets the user chose to import (already picked from the workbook). */
  sheets: ParsedSheet[];
  /** Column labels to skip (by label, case-sensitive to the parsed label). */
  excludedLabels: string[];
  /** Only import months in these years; omit to import every year found. */
  selectedYears?: number[];
  selfId: string;
  /** How to treat a year that was already imported before. */
  mode: "replace" | "add";
  /** Card/section names flagged "ℹ️ informational" in the workbook — their
   *  installments are skipped (they must not hit the balance). */
  informationalCards?: string[];
  /** Explicit cycles for cards reconstructed from installment comments. Keys
   *  are card names; existing configured cards win. */
  cardCycles?: Record<string, CardCycle>;
}

const importBatchKey = (year: number) => `import_batch:${year}`;
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
  table: "transactions" | "cell_notes" | "installment_plans",
  ids: Iterable<string>,
): Promise<RowWrite[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [];
  for (let offset = 0; offset < unique.length; offset += 400) {
    const chunk = unique.slice(offset, offset + 400);
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
    if (prev && (prev.transactions?.length || prev.cellNotes?.length || prev.installmentPlans?.length)) out.push(year);
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
 * Import parsed sheets 1:1 into the ledger. Categories are matched by name (or
 * created as columns), each year records its own ordered column set
 * (`column_years`), formula/comment breakdowns become itemized rows or a cell
 * note (see `planImportCell`), and the earliest month's opening balance seeds
 * the ledger anchor. Re-importing a year either replaces its prior batch or
 * adds on top. Everything is additive elsewhere — existing manual rows are
 * never touched.
 */
export async function importSheets(userId: string, req: ImportRequest): Promise<{ imported: number }> {
  const sqlite = await getSqliteAsync();
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
    for (const [year, batch] of priorBatches) {
      if (affected.has(year)) continue;
      batch.transactions.forEach((id) => protectedTransactions.add(id));
      batch.cellNotes.forEach((id) => protectedNotes.add(id));
      batch.installmentPlans?.forEach((id) => protectedPlans.add(id));
    }
    const oldTransactions = affectedYears.flatMap((year) => priorBatches.get(year)?.transactions ?? []).filter((id) => !protectedTransactions.has(id));
    const oldNotes = affectedYears.flatMap((year) => priorBatches.get(year)?.cellNotes ?? []).filter((id) => !protectedNotes.has(id));
    const oldPlans = affectedYears.flatMap((year) => priorBatches.get(year)?.installmentPlans ?? []).filter((id) => !protectedPlans.has(id));
    cleanupWrites.push(
      ...(await tombstoneImportRows(userId, "transactions", oldTransactions)),
      ...(await tombstoneImportRows(userId, "cell_notes", oldNotes)),
      ...(await tombstoneImportRows(userId, "installment_plans", oldPlans)),
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
    if (!b) batchByYear.set(y, (b = { version: 2, transactions: [], cellNotes: [], installmentPlans: [] }));
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
  const sheetPlan = buildSpreadsheetImportPlan({
    sheets: req.sheets,
    excludedLabels: new Set(req.excludedLabels),
    selectedYears,
    categoryIds: idByNameAndKind,
    today,
  });
  for (const [year, ids] of sheetPlan.columnYears) columnYearsUpdates.set(year, ids);
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
          deletedAt: null,
        },
      });
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
  const planSpecs = collectInstallmentPlans(req.sheets, {
    excludedLabels: req.excludedLabels,
    informationalCards: req.informationalCards,
    yearAllowed,
  });
  const sourceWrites: RowWrite[] = [];
  const cycleByName = new Map<string, CardCycle>();
  for (const spec of planSpecs) {
    const key = normalizedName(spec.card);
    const existingSource = sourceByName.get(key);
    const existingCycle = existingSource
      ? { statementDay: existingSource.statement_day, dueDay: existingSource.due_day }
      : null;
    const cycle = existingCycle && isValidCardCycle(existingCycle) ? existingCycle : requestedCycles.get(key);
    if (!cycle || !isValidCardCycle(cycle)) throw new CreditCardCycleRequiredError();
    cycleByName.set(key, cycle);
    if (sourceIdByName.has(key)) {
      if (existingSource && !isValidCardCycle(existingCycle!)) {
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
        id, name: spec.card, type: "credit_card", personId: req.selfId,
        dueDay: cycle.dueDay, statementDay: cycle.statementDay,
        color: null, logoSource: "initials", logoRef: null, isActive: true, deletedAt: null,
      },
    });
  }
  const planRowBatches = await Promise.all(
    planSpecs.map(async (spec) => {
      const sourceId = sourceIdByName.get(normalizedName(spec.card));
      const cycle = cycleByName.get(normalizedName(spec.card));
      if (!sourceId || !cycle) throw new CreditCardCycleRequiredError();
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
        dueDay: cycle.dueDay,
        paymentSourceId: sourceId,
        personId: req.selfId,
        personIsSelf: true,
        categoryId:
          idByNameAndKind.get(importCategoryKey(spec.columnLabel, "expense")) ??
          idByNameAndKind.get(importCategoryKey(spec.columnLabel, "income")) ??
          null,
        note: null,
        tryFactor: 1,
      }, today);
      return { ...built, rows: await linkDueRowsToCardStatements(userId, sourceId, cycle, built.rows), planId, spec };
    }),
  );
  for (const built of planRowBatches) {
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
    const batch = batchByYear.get(year) ?? { version: 2 as const, transactions: [], cellNotes: [], installmentPlans: [] };
    if (req.mode === "add") {
      const prev = priorBatches.get(year);
      batch.transactions = [...new Set([...(prev?.transactions ?? []), ...batch.transactions])];
      batch.cellNotes = [...new Set([...(prev?.cellNotes ?? []), ...batch.cellNotes])];
      batch.installmentPlans = [...new Set([...(prev?.installmentPlans ?? []), ...(batch.installmentPlans ?? [])])];
    }
    metadataWrites.push(await settingWrite(userId, importBatchKey(year), batch));
  }

  metadataWrites.push(...(await openingWritesFromImport(userId, req.sheets, yearAllowed)));
  const writes = [
    ...cleanupWrites,
    ...catWrites,
    ...sourceWrites,
    ...txWrites,
    ...noteWrites,
    ...planRowBatches.flatMap((b) => b.rows),
    ...metadataWrites,
  ];
  if (writes.length > 0) await writeRows(userId, writes);
  return { imported };
}

/** Seed the ledger opening balance from the earliest imported opening cell. */
async function openingWritesFromImport(userId: string, sheets: ParsedSheet[], yearAllowed: (y: number) => boolean): Promise<RowWrite[]> {
  const withOpening = sheets
    .filter((s) => s.openingBalance && yearAllowed(yearOf(s.openingBalance.month)))
    .sort((a, b) => a.openingBalance!.month.localeCompare(b.openingBalance!.month));
  const earliest = withOpening[0];
  if (!earliest) return [];
  const currentStart = await readSetting<string>(userId, "start_month");
  if (!currentStart || earliest.openingBalance!.month < currentStart) {
    return [
      await settingWrite(userId, "start_month", earliest.openingBalance!.month),
      await settingWrite(userId, "opening_balance_minor", earliest.openingBalance!.minor),
    ];
  }
  return [];
}
