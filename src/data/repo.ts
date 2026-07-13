/**
 * High-level data operations. Composes domain engines with the write layer.
 * All writes flow through writeRows (outbox + last_entry_at + atomicity).
 */

import { getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys, newId } from "../db/ids";
import { fromDbShape, nowIso, readSetting, softDelete, softDeleteMany, writeRows, writeSetting, type RowWrite } from "../db/mutations";
import { todayISO, yearOf, type ISODate, type MonthKey } from "../domain/dates";
import { generateSchedule } from "../domain/installments";
import { convertToTryMinor } from "../domain/fx";
import { advanceDueDate } from "../domain/recurrence";
import { lookupRate } from "../services/fx-fetch";
import { marketSellRateTry } from "../services/markets";
import { confirmEffectiveDate, findAutoConfirmable, findLate, generateExpected } from "../domain/expected";
import type { Minor } from "../domain/money";
import { collectInstallmentPlans, isInstallmentCell, planImportCell, type ParsedSheet } from "../services/spreadsheet-import";
import { suggestCategoryIcon } from "./category-icons";
import type { ExpectedPaymentLike, PaymentSourceType, TransactionType } from "../domain/types";

// ---------------------------------------------------------------------------
// Onboarding seed
// ---------------------------------------------------------------------------

export interface TemplateCategory {
  name: string;
  kind: "expense" | "income";
  isColumn: boolean;
  icon?: string;
}

/**
 * Starter category set offered on first run. Broad, everyday items that fit
 * most people (no assumptions like a mortgage or a car) — all fully editable
 * and deletable later. Extra, less-universal examples live in
 * `TEMPLATE_EXTRA_CATEGORIES` and are offered separately.
 */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { name: "Kredi Kartı", kind: "expense", isColumn: true, icon: "💳" },
  { name: "Faturalar", kind: "expense", isColumn: true, icon: "🧾" },
  { name: "Market", kind: "expense", isColumn: true, icon: "🛒" },
  { name: "Araç & Yakıt", kind: "expense", isColumn: true, icon: "⛽" },
  { name: "Kira", kind: "expense", isColumn: true, icon: "🏠" },
  { name: "Ulaşım", kind: "expense", isColumn: true, icon: "🚌" },
  { name: "Sağlık", kind: "expense", isColumn: true, icon: "🩺" },
  { name: "Eğlence", kind: "expense", isColumn: true, icon: "🎬" },
  { name: "Ek Giderler", kind: "expense", isColumn: true, icon: "🧺" },
  { name: "Maaş", kind: "income", isColumn: true, icon: "💰" },
  { name: "Ek Gelirler", kind: "income", isColumn: true, icon: "➕" },
];

/** Less-universal example columns, offered as optional extras (not default). */
export const TEMPLATE_EXTRA_CATEGORIES: TemplateCategory[] = [
  { name: "Ev Kredisi", kind: "expense", isColumn: true, icon: "🏦" },
  { name: "Araç Kredisi", kind: "expense", isColumn: true, icon: "🚗" },
  { name: "Yatırım", kind: "expense", isColumn: true, icon: "📈" },
  { name: "Abonelikler", kind: "expense", isColumn: true, icon: "🔁" },
  { name: "Giyim", kind: "expense", isColumn: true, icon: "👕" },
  { name: "Eğitim", kind: "expense", isColumn: true, icon: "🎓" },
  { name: "Kira Geliri", kind: "income", isColumn: true, icon: "🏘️" },
];

export interface SeedInput {
  /** Template categories to create; empty = start blank. */
  templateCategories: TemplateCategory[];
  startMonth: MonthKey;
  openingBalanceMinor: Minor;
  persons: { name: string; isSelf: boolean }[];
  sources: { name: string; type: PaymentSourceType; personIndex: number; dueDay?: number | null }[];
}

/**
 * Seed (or re-seed) the onboarding workspace. Fully idempotent: every seeded
 * row gets a DETERMINISTIC id (self person, watch-only persons by slot, sources
 * by slot, template categories by name), so re-entering setup — after a reload,
 * or opening an importer then committing — upserts the same rows instead of
 * duplicating the whole workspace (the old `newId()` seed multiplied everything
 * on every re-run). The opening balance / start month are applied through the
 * earlier-wins rule so a re-seed on commit never clobbers an earlier ledger
 * anchor set by an Excel import.
 */
export async function seedWorkspace(userId: string, input: SeedInput): Promise<void> {
  const writes: RowWrite[] = [];
  const personIds = await Promise.all(
    input.persons.map((p, i) =>
      p.isSelf ? deterministicId(naturalKeys.selfPerson(userId)) : deterministicId(naturalKeys.onboardingPerson(userId, i)),
    ),
  );
  input.persons.forEach((p, i) => {
    writes.push({ table: "persons", row: { id: personIds[i], name: p.name, isSelf: p.isSelf, deletedAt: null } });
  });
  const sourceIds = await Promise.all(input.sources.map((_, i) => deterministicId(naturalKeys.onboardingSource(userId, i))));
  input.sources.forEach((s, i) => {
    writes.push({
      table: "payment_sources",
      row: {
        id: sourceIds[i],
        name: s.name,
        type: s.type,
        personId: personIds[s.personIndex] ?? personIds[0],
        dueDay: s.dueDay ?? null,
        statementDay: null,
        color: null,
        logoSource: "initials",
        logoRef: null,
        isActive: true,
        deletedAt: null,
        sortOrder: i,
      },
    });
  });
  const categoryIds = await Promise.all(
    input.templateCategories.map((c) => deterministicId(naturalKeys.seedCategory(userId, c.name))),
  );
  input.templateCategories.forEach((c, i) => {
    writes.push({
      table: "categories",
      row: { id: categoryIds[i], name: c.name, kind: c.kind, icon: c.icon ?? null, color: null, sortOrder: i, isColumn: c.isColumn, deletedAt: null },
    });
  });
  await writeRows(userId, writes);
  await applyOnboardingBalance(userId, input.startMonth, input.openingBalanceMinor);
  // NB: does NOT mark onboarded — the setup screen seeds first (so history can
  // be imported into a real workspace) and calls finalizeOnboarding() only when
  // the user taps "save & start". See setup.tsx.
}

/**
 * Write the onboarding opening balance + start month, but never overwrite an
 * EARLIER anchor already set (e.g. by an Excel import that seeded the ledger
 * from an earlier year). The ledger back-anchors to the earliest data, so the
 * earliest start wins; for the same-or-later month the form value is authoritative.
 */
export async function applyOnboardingBalance(userId: string, startMonth: MonthKey, openingBalanceMinor: Minor): Promise<void> {
  const currentStart = await readSetting<string>(userId, "start_month");
  if (currentStart && startMonth > currentStart) return; // keep the earlier imported anchor
  await writeSetting(userId, "start_month", startMonth);
  await writeSetting(userId, "opening_balance_minor", openingBalanceMinor);
}

/** Mark onboarding complete → the route guard lets the user into the app. */
export async function finalizeOnboarding(userId: string): Promise<void> {
  await writeSetting(userId, "onboarded", true);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface NewTransaction {
  type: TransactionType;
  amountMinor: Minor;
  currency: string;
  fxRate: string | null;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  categoryId: string | null;
  paymentSourceId: string | null;
  personId: string;
  note: string | null;
  isAggregate?: boolean;
  subscriptionId?: string | null;
}

export async function addTransaction(userId: string, input: NewTransaction): Promise<string> {
  const today = todayISO();
  const id = newId();
  await writeRows(userId, [
    {
      table: "transactions",
      row: {
        id,
        ...input,
        isAggregate: input.isAggregate ?? false,
        subscriptionId: input.subscriptionId ?? null,
        installmentPlanId: null,
        installmentNo: null,
        entryDate: today,
        status: input.effectiveDate <= today ? "realized" : "pending",
        deletedAt: null,
      },
    },
  ]);
  return id;
}

/** Editable fields of a single transaction (installment linkage is preserved). */
export interface TransactionPatch {
  type: TransactionType;
  amountMinor: Minor;
  currency: string;
  fxRate: string | null;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  isAggregate?: boolean;
  categoryId: string | null;
  paymentSourceId: string | null;
  personId: string;
  note: string | null;
}

/** Update an existing transaction in place; status is re-derived from the date. */
export async function updateTransaction(
  userId: string,
  existing: Record<string, unknown>,
  patch: TransactionPatch,
): Promise<void> {
  await writeRows(userId, [
    {
      table: "transactions",
      row: {
        ...existing,
        ...patch,
        status: patch.effectiveDate <= todayISO() ? "realized" : "pending",
      },
    },
  ]);
}

export async function deleteTransaction(userId: string, id: string) {
  return softDelete(userId, "transactions", id);
}

/** How many live transactions reference a category — for a warn-before-delete
 *  confirmation (deleting a category leaves its rows uncategorized, not lost). */
export async function countTransactionsForCategory(userId: string, categoryId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
    [userId, categoryId] as never[],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Installment plans
// ---------------------------------------------------------------------------

export interface NewPlan {
  title: string;
  kind: "card_installment" | "loan";
  totalAmountMinor: Minor | null;
  monthlyAmountMinor: Minor | null;
  installmentCount: number;
  currency: string;
  fxRate: string | null;
  startMonth: MonthKey;
  dueDay: number | null;
  paymentSourceId: string | null;
  personId: string;
  personIsSelf: boolean;
  categoryId: string | null;
  note: string | null;
  /** TRY conversion factor applied to each share (1 for TRY). */
  tryFactor: number;
}

/**
 * Write the plan row plus one deterministic transaction per scheduled month.
 * Installment transactions are a pure function of (plan params, start month):
 * their id is deterministic and their realized/pending status is derived from
 * the date, so regenerating on edit reproduces the same paid/unpaid split.
 */
/** Build (but don't write) the plan row + one deterministic transaction per
 *  scheduled month. Extracted so a bulk import can batch many plans into ONE
 *  write instead of a DB transaction per plan (that was minutes for ~100 plans).
 *  The per-installment ids are hashed in parallel. */
async function buildPlanRows(planId: string, input: NewPlan, today: ISODate): Promise<{ rows: RowWrite[]; keepNos: Set<number> }> {
  const schedule = generateSchedule(
    {
      id: planId,
      kind: input.kind,
      startMonth: input.startMonth,
      installmentCount: input.installmentCount,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      currency: input.currency,
      dueDay: input.dueDay,
      personIsSelf: input.personIsSelf,
    },
    today,
  );
  const planRow: RowWrite = {
    table: "installment_plans",
    row: {
      id: planId,
      title: input.title,
      kind: input.kind,
      totalAmountMinor: input.totalAmountMinor,
      monthlyAmountMinor: input.monthlyAmountMinor,
      installmentCount: input.installmentCount,
      currency: input.currency,
      startMonth: input.startMonth,
      dueDay: input.dueDay,
      paymentSourceId: input.paymentSourceId,
      personId: input.personId,
      categoryId: input.categoryId,
      note: input.note,
      deletedAt: null,
    },
  };
  const txRows: RowWrite[] = await Promise.all(
    schedule.map(async (item) => ({
      table: "transactions" as const,
      row: {
        id: await deterministicId(naturalKeys.installmentTx(planId, item.installmentNo)),
        type: "expense",
        amountMinor: item.amountMinor,
        currency: input.currency,
        fxRate: input.fxRate,
        amountTryMinor: Math.round(item.amountMinor * input.tryFactor),
        entryDate: today,
        effectiveDate: item.effectiveDate,
        status: item.status,
        categoryId: input.categoryId,
        paymentSourceId: input.paymentSourceId,
        personId: input.personId,
        installmentPlanId: planId,
        installmentNo: item.installmentNo,
        subscriptionId: null,
        isAggregate: false,
        note: null,
        deletedAt: null,
      },
    })),
  );
  return { rows: [planRow, ...txRows], keepNos: new Set(schedule.map((s) => s.installmentNo)) };
}

async function writePlanWithSchedule(userId: string, planId: string, input: NewPlan): Promise<Set<number>> {
  const { rows, keepNos } = await buildPlanRows(planId, input, todayISO());
  await writeRows(userId, rows);
  return keepNos;
}

/** Live installment transactions belonging to a plan — for a warn-before-delete
 *  count (deleting a plan tombstones all of them; the action has no undo). */
export async function countInstallmentsForPlan(userId: string, planId: string): Promise<number> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND installment_plan_id = ? AND deleted_at IS NULL`,
    [userId, planId] as never[],
  );
  return row?.n ?? 0;
}

/** Create the plan and materialize one transaction per month (deterministic ids). */
export async function createInstallmentPlan(userId: string, input: NewPlan): Promise<string> {
  const planId = newId();
  await writePlanWithSchedule(userId, planId, input);
  return planId;
}

/**
 * Edit an existing plan in place: rewrite the plan row, regenerate the
 * schedule (deterministic ids un-delete/update matching months), and tombstone
 * any previously-generated installments that fall outside the new schedule
 * (e.g. when the installment count is reduced).
 */
export async function updateInstallmentPlan(userId: string, planId: string, input: NewPlan): Promise<void> {
  const keepNos = await writePlanWithSchedule(userId, planId, input);
  const sqlite = await getSqliteAsync();
  const existing = await sqlite.getAllAsync<{ id: string; installment_no: number }>(
    `SELECT id, installment_no FROM transactions WHERE installment_plan_id = ? AND deleted_at IS NULL`,
    [planId] as never[],
  );
  const drop = existing.filter((t) => t.installment_no != null && !keepNos.has(t.installment_no)).map((t) => t.id);
  await softDeleteMany(userId, "transactions", drop);
}

/** Tombstone a plan together with its generated transactions. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const txIds = await sqlite.getAllAsync<{ id: string }>(
    `SELECT id FROM transactions WHERE installment_plan_id = ? AND deleted_at IS NULL`,
    [planId] as never[],
  );
  await softDeleteMany(userId, "transactions", txIds.map((t) => t.id));
  await softDelete(userId, "installment_plans", planId);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface SubscriptionInput {
  id?: string;
  name: string;
  amountMinor: Minor;
  currency: string;
  cycle: "monthly" | "yearly" | "custom";
  intervalMonths: number;
  billingDay: number;
  nextDueDate: ISODate;
  paymentSourceId: string | null;
  categoryId: string | null;
  personId: string;
  isActive: boolean;
  trialEndDate: ISODate | null;
  autoPay: boolean;
  websiteDomain: string | null;
  note: string | null;
}

export async function upsertSubscription(userId: string, input: SubscriptionInput): Promise<string> {
  const id = input.id ?? newId();
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [];
  if (input.id) {
    const prev = await sqlite.getFirstAsync<{ amount_minor: number; currency: string }>(
      `SELECT amount_minor, currency FROM subscriptions WHERE id = ?`,
      [id] as never[],
    );
    if (prev && (prev.amount_minor !== input.amountMinor || prev.currency !== input.currency)) {
      writes.push({
        table: "price_history",
        row: {
          id: newId(),
          subscriptionId: id,
          amountMinor: input.amountMinor,
          currency: input.currency,
          effectiveFrom: todayISO(),
          deletedAt: null,
        },
      });
    }
  } else {
    writes.push({
      table: "price_history",
      row: {
        id: newId(),
        subscriptionId: id,
        amountMinor: input.amountMinor,
        currency: input.currency,
        effectiveFrom: todayISO(),
        deletedAt: null,
      },
    });
  }
  writes.push({
    table: "subscriptions",
    row: {
      id,
      name: input.name,
      amountMinor: input.amountMinor,
      currency: input.currency,
      cycle: input.cycle,
      intervalMonths: input.intervalMonths,
      billingDay: input.billingDay,
      nextDueDate: input.nextDueDate,
      paymentSourceId: input.paymentSourceId,
      categoryId: input.categoryId,
      personId: input.personId,
      isActive: input.isActive,
      canceledAt: input.isActive ? null : nowIso(),
      trialEndDate: input.trialEndDate,
      autoPay: input.autoPay,
      websiteDomain: input.websiteDomain,
      logoSource: "initials",
      logoRef: null,
      note: input.note,
      deletedAt: null,
    },
  });
  await writeRows(userId, writes);
  return id;
}

// ---------------------------------------------------------------------------
// Expected payments: confirm / skip / revert
// ---------------------------------------------------------------------------

/**
 * Thrown when a foreign-currency item is confirmed but no FX rate is available
 * yet (no live Harem price and nothing cached from TCMB). Storing the raw
 * foreign amount as if it were TRY would silently corrupt the balance, so the
 * confirm is refused instead — the caller retries once a rate is known.
 */
export class FxRateUnavailableError extends Error {
  constructor(public readonly currency: string) {
    super(`No FX rate available for ${currency}`);
    this.name = "FxRateUnavailableError";
  }
}

interface ExpectedRow {
  id: string;
  direction: "in" | "out";
  kind: string;
  ref_id: string;
  due_date: string;
  amount_minor: number;
  currency: string;
  status: string;
  transaction_id: string | null;
}

async function getExpectedRow(id: string): Promise<ExpectedRow | null> {
  const sqlite = await getSqliteAsync();
  return sqlite.getFirstAsync<ExpectedRow>(`SELECT * FROM expected_payments WHERE id = ?`, [id] as never[]);
}

/**
 * Confirm an expected item: creates the realized transaction, marks paid and
 * advances the subscription's next due date. `actualAmountMinor` lets the
 * user correct the real amount (salary varies month to month).
 */
export async function confirmExpected(
  userId: string,
  expectedId: string,
  opts: { actualAmountMinor?: Minor; categoryId?: string | null; personId: string; auto?: boolean; paidOn?: ISODate | null },
): Promise<void> {
  const row = await getExpectedRow(expectedId);
  if (!row || row.status === "paid") return;
  const amount = opts.actualAmountMinor ?? row.amount_minor;
  // Snapshot the TRY value at confirm time. For foreign-currency items convert
  // with the Harem sell ("satış") price (already streamed), falling back to the
  // cached TCMB rate. If NEITHER is available we must not store the raw foreign
  // amount as TRY (that silently corrupts the balance) — refuse the confirm so
  // the caller can retry once a rate is known.
  const amountTryMinor = ((): number => {
    if (row.currency === "TRY") return amount;
    const rate = marketSellRateTry(row.currency) ?? lookupRate(userId, row.currency)?.rate.rateTry ?? null;
    if (rate == null) throw new FxRateUnavailableError(row.currency);
    return convertToTryMinor(amount, rate);
  })();
  // Deterministic id: a double-tap (or two devices auto-confirming the same
  // item) upserts the same transaction row instead of creating a duplicate.
  const txId = await deterministicId(naturalKeys.confirmTx(row.id));
  const today = todayISO();
  // Ledger-affecting date: due date (once passed) / today, unless the user
  // recorded a manual/early payment via `paidOn`. See confirmEffectiveDate.
  const effectiveDate = confirmEffectiveDate(row.due_date, today, opts.paidOn);
  const sqlite = await getSqliteAsync();

  const writes: RowWrite[] = [
    {
      table: "transactions",
      row: {
        id: txId,
        type: row.direction === "in" ? "income" : "expense",
        amountMinor: amount,
        currency: row.currency,
        fxRate: null,
        amountTryMinor,
        entryDate: today,
        effectiveDate,
        status: "realized",
        categoryId: opts.categoryId ?? null,
        paymentSourceId: null,
        personId: opts.personId,
        installmentPlanId: null,
        installmentNo: null,
        subscriptionId: row.kind === "subscription" ? row.ref_id : null,
        isAggregate: false,
        note: null,
        deletedAt: null,
      },
    },
    {
      table: "expected_payments",
      row: {
        id: row.id,
        direction: row.direction,
        kind: row.kind,
        refId: row.ref_id,
        dueDate: row.due_date,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: "paid",
        paidAt: nowIso(),
        autoConfirmed: opts.auto ?? false,
        transactionId: txId,
        deletedAt: null,
      },
    },
  ];

  if (row.kind === "subscription") {
    const sub = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM subscriptions WHERE id = ? AND deleted_at IS NULL`,
      [row.ref_id] as never[],
    );
    if (sub && (sub.next_due_date as string) <= row.due_date) {
      const next = advanceDueDate(row.due_date, sub.interval_months as number, sub.billing_day as number);
      writes.push({
        table: "subscriptions",
        row: {
          ...fromDbShape("subscriptions", sub),
          nextDueDate: next,
        },
      });
    }
  }
  await writeRows(userId, writes, !opts.auto);
}

export async function skipExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(expectedId);
  if (!row) return;
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "skipped" },
    },
  ]);
}

/** Undo a confirmation: tombstone the created transaction, back to pending. */
export async function revertExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(expectedId);
  if (!row || row.status !== "paid") return;
  if (row.transaction_id) await softDelete(userId, "transactions", row.transaction_id);
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Bulk history entry (approved feature)
// ---------------------------------------------------------------------------

export async function bulkMonthEntry(
  userId: string,
  month: MonthKey,
  personId: string,
  entries: { categoryId: string; kind: "expense" | "income"; amountMinor: Minor; isInvestment?: boolean }[],
): Promise<void> {
  const today = todayISO();
  const effectiveDate = `${month}-15`; // mid-month anchor for aggregates
  // A mid-month anchor in the current month can land in the future (before the
  // 15th) — status must be derived from the date, or the row would be
  // realized-but-future and vanish from both the balance and the cells.
  const status = effectiveDate <= today ? "realized" : "pending";
  const writes: RowWrite[] = entries.map((e) => ({
    table: "transactions",
    row: {
      id: newId(),
      type: e.isInvestment ? "transfer" : e.kind,
      amountMinor: e.amountMinor,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: e.amountMinor,
      entryDate: today,
      effectiveDate,
      status,
      categoryId: e.categoryId,
      paymentSourceId: null,
      personId,
      installmentPlanId: null,
      installmentNo: null,
      subscriptionId: null,
      isAggregate: true,
      note: null,
      deletedAt: null,
    },
  }));
  await writeRows(userId, writes);
}

// ---------------------------------------------------------------------------
// Spreadsheet import (faithful, multi-year, per-year columns)
// ---------------------------------------------------------------------------

interface ImportBatch {
  transactions: string[];
  cellNotes: string[];
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
}

const importBatchKey = (year: number) => `import_batch:${year}`;
const COLUMN_YEARS_KEY = "column_years";

/** Years (of the given set) that already carry a prior import batch. */
export async function importedYears(userId: string, years: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const year of [...new Set(years)]) {
    const prev = await readSetting<ImportBatch>(userId, importBatchKey(year));
    if (prev && (prev.transactions?.length || prev.cellNotes?.length)) out.push(year);
  }
  return out;
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
  const existing = await sqlite.getAllAsync<{ id: string; name: string; sort_order: number }>(
    `SELECT id, name, sort_order FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const idByName = new Map(existing.map((c) => [c.name.toLocaleLowerCase("tr-TR"), c.id]));
  let sortSeed = existing.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
  // Query payment sources up front too, so the whole import — categories, rows,
  // reconstructed installment cards + plans — flushes in ONE writeRows. A read
  // issued AFTER a multi-thousand-row write starved the sqlite worker and hung.
  const existingSources = await sqlite.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const sourceIdByName = new Map(existingSources.map((s) => [s.name.toLocaleLowerCase("tr-TR"), s.id]));

  const catWrites: RowWrite[] = [];
  const ensureCategory = (label: string, kind: "expense" | "income"): string => {
    const key = label.toLocaleLowerCase("tr-TR");
    let id = idByName.get(key);
    if (!id) {
      id = newId();
      idByName.set(key, id);
      catWrites.push({
        table: "categories",
        row: { id, name: label, kind, icon: suggestCategoryIcon(label, kind), color: null, sortOrder: sortSeed++, isColumn: true, deletedAt: null },
      });
    }
    return id;
  };

  const selectedYears = req.selectedYears ? new Set(req.selectedYears) : null;
  const yearAllowed = (y: number) => !selectedYears || selectedYears.has(y);

  // Replace mode: tombstone each affected year's prior import before rewriting.
  const affectedYears = [...new Set(req.sheets.flatMap((s) => s.months.map(yearOf)))].filter(yearAllowed);
  if (req.mode === "replace") {
    for (const year of affectedYears) {
      const prev = await readSetting<ImportBatch>(userId, importBatchKey(year));
      await softDeleteMany(userId, "transactions", prev?.transactions ?? []);
      await softDeleteMany(userId, "cell_notes", prev?.cellNotes ?? []);
    }
  }

  const txWrites: RowWrite[] = [];
  const noteWrites: RowWrite[] = [];
  const batchByYear = new Map<number, ImportBatch>();
  const columnYearsUpdates = new Map<number, string[]>();
  const today = todayISO();
  let imported = 0;
  const batchFor = (y: number): ImportBatch => {
    let b = batchByYear.get(y);
    if (!b) batchByYear.set(y, (b = { transactions: [], cellNotes: [] }));
    return b;
  };

  for (const sheet of req.sheets) {
    const active = sheet.columns.map((c, i) => ({ ...c, index: i })).filter((c) => !req.excludedLabels.includes(c.label));
    const orderedCatIds = active.map((col) => ensureCategory(col.label, col.kindGuess));

    for (let r = 0; r < sheet.months.length; r++) {
      const month = sheet.months[r];
      const year = yearOf(month);
      if (!yearAllowed(year)) continue;
      columnYearsUpdates.set(year, orderedCatIds); // each year shows its sheet's columns
      const batch = batchFor(year);
      for (let ci = 0; ci < active.length; ci++) {
        const col = active[ci];
        const catId = orderedCatIds[ci];
        // Excel cells carry no day — only a month. Anchor every imported row to
        // the FIRST of its month and mark it dateless (isAggregate below), so the
        // current month reads as realized (counts in the balance + this month's
        // analytics) instead of a mid-month future date that stays pending and
        // pollutes "upcoming payments". Status still derives from the date, so a
        // genuinely future month imports as pending (shown, realized on arrival).
        const effectiveDate = `${month}-01`;
        const status: "realized" | "pending" = effectiveDate <= today ? "realized" : "pending";
        // A "…Taksitli…" cell stores its card installments in the comment; those
        // become real self-scheduling plans (collected separately, below), so the
        // cell's aggregate/cell-note is skipped to avoid double-counting.
        const cellData = sheet.cells[r][col.index];
        if (isInstallmentCell(col.label, cellData.comment)) continue;
        const plan = planImportCell(cellData);
        if (!plan) continue;
        for (const item of plan.items) {
          const id = newId();
          // Ledger keeps amounts positive; a negative cell flips the flow.
          const negative = item.amountMinor < 0;
          const baseType: TransactionType = col.isInvestment ? "transfer" : col.kindGuess;
          const type: TransactionType = negative && baseType !== "transfer" ? (baseType === "expense" ? "income" : "expense") : baseType;
          const amount = Math.abs(item.amountMinor);
          txWrites.push({
            table: "transactions",
            row: {
              id,
              type,
              amountMinor: amount,
              currency: "TRY",
              fxRate: null,
              amountTryMinor: amount,
              entryDate: today,
              effectiveDate,
              status,
              categoryId: catId,
              paymentSourceId: null,
              personId: req.selfId,
              installmentPlanId: null,
              installmentNo: null,
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
        if (plan.cellNote) {
          const noteId = await deterministicId(naturalKeys.cellNote(userId, month, catId));
          noteWrites.push({ table: "cell_notes", row: { id: noteId, month, categoryId: catId, body: plan.cellNote, deletedAt: null } });
          batch.cellNotes.push(noteId);
        }
      }
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
  for (const spec of planSpecs) {
    const key = spec.card.toLocaleLowerCase("tr-TR");
    if (sourceIdByName.has(key)) continue;
    const id = await deterministicId(naturalKeys.importSource(userId, spec.card));
    sourceIdByName.set(key, id);
    sourceWrites.push({
      table: "payment_sources",
      row: {
        id, name: spec.card, type: "credit_card", personId: req.selfId, dueDay: null, statementDay: null,
        color: null, logoSource: "initials", logoRef: null, isActive: true, deletedAt: null,
      },
    });
  }
  const planRowBatches = await Promise.all(
    planSpecs.map(async (spec) => {
      const planId = await deterministicId(naturalKeys.importInstallmentPlan(userId, spec.name, spec.monthlyMinor, spec.total, spec.startMonth));
      return buildPlanRows(planId, {
        title: spec.name,
        kind: "card_installment",
        totalAmountMinor: null,
        monthlyAmountMinor: spec.monthlyMinor,
        installmentCount: spec.total,
        currency: "TRY",
        fxRate: null,
        startMonth: spec.startMonth,
        dueDay: null,
        paymentSourceId: sourceIdByName.get(spec.card.toLocaleLowerCase("tr-TR")) ?? null,
        personId: req.selfId,
        personIsSelf: true,
        categoryId: idByName.get(spec.columnLabel.toLocaleLowerCase("tr-TR")) ?? null,
        note: null,
        tryFactor: 1,
      }, today);
    }),
  );
  imported += planSpecs.length;

  const writes = [...catWrites, ...sourceWrites, ...txWrites, ...noteWrites, ...planRowBatches.flatMap((b) => b.rows)];
  if (writes.length > 0) await writeRows(userId, writes);

  // Per-year column membership (Excel order preserved).
  const columnYears = (await readSetting<Record<string, string[]>>(userId, COLUMN_YEARS_KEY)) ?? {};
  for (const [year, ids] of columnYearsUpdates) columnYears[String(year)] = ids;
  await writeSetting(userId, COLUMN_YEARS_KEY, columnYears, true);

  // Record batches (add mode keeps prior ids so a later replace still cleans up).
  for (const [year, batch] of batchByYear) {
    if (req.mode === "add") {
      const prev = await readSetting<ImportBatch>(userId, importBatchKey(year));
      batch.transactions = [...(prev?.transactions ?? []), ...batch.transactions];
      batch.cellNotes = [...(prev?.cellNotes ?? []), ...batch.cellNotes];
    }
    await writeSetting(userId, importBatchKey(year), batch);
  }

  await seedOpeningFromImport(userId, req.sheets, yearAllowed);
  return { imported };
}

/** Seed the ledger opening balance from the earliest imported opening cell. */
async function seedOpeningFromImport(userId: string, sheets: ParsedSheet[], yearAllowed: (y: number) => boolean): Promise<void> {
  const withOpening = sheets
    .filter((s) => s.openingBalance && yearAllowed(yearOf(s.openingBalance.month)))
    .sort((a, b) => a.openingBalance!.month.localeCompare(b.openingBalance!.month));
  const earliest = withOpening[0];
  if (!earliest) return;
  const currentStart = await readSetting<string>(userId, "start_month");
  if (!currentStart || earliest.openingBalance!.month < currentStart) {
    await writeSetting(userId, "start_month", earliest.openingBalance!.month);
    await writeSetting(userId, "opening_balance_minor", earliest.openingBalance!.minor);
  }
}

// ---------------------------------------------------------------------------
// Daily maintenance: §2.7 date flips, expected generation, late marking, auto-pay
// ---------------------------------------------------------------------------

let maintenanceRunning = false;

export async function runMaintenance(userId: string): Promise<void> {
  // Single-instance guard: rapid foreground/background cycles must not run
  // two maintenance passes concurrently (both could auto-confirm the same
  // expected item before either write commits).
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    await runMaintenanceInner(userId);
  } finally {
    maintenanceRunning = false;
  }
}

async function runMaintenanceInner(userId: string): Promise<void> {
  const today = todayISO();
  const sqlite = await getSqliteAsync();

  // 0) Repair: collapse duplicate "self" persons (a historical seed bug could
  // create two). Keep the oldest, remap references, tombstone the rest.
  const selves = await sqlite.getAllAsync<{ id: string }>(
    `SELECT id FROM persons WHERE user_id = ? AND is_self = 1 AND deleted_at IS NULL ORDER BY created_at ASC`,
    [userId] as never[],
  );
  if (selves.length > 1) {
    const keepId = selves[0].id;
    for (const dup of selves.slice(1)) {
      for (const table of ["transactions", "payment_sources", "subscriptions", "recurring_incomes", "installment_plans"] as const) {
        const refs = await sqlite.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE user_id = ? AND person_id = ?`,
          [userId, dup.id] as never[],
        );
        if (refs.length > 0) {
          await writeRows(
            userId,
            refs.map((row) => ({ table, row: { ...fromDbShape(table, row), personId: keepId } })),
            false,
          );
        }
      }
      await softDelete(userId, "persons", dup.id);
    }
  }

  // 0b) One-time removal: the auto-created "KK Taksit" (credit-card installment
  // split) computed column is no longer wanted — it renders a derived column
  // that isn't a real category and confused users. Tombstone the deterministic
  // cc column once, guarded by a synced flag so it never resurrects on any
  // device. A user's own manually-created computed columns are untouched.
  const ccRemoved = await sqlite.getAllAsync<{ value: string }>(
    `SELECT value FROM settings WHERE user_id = ? AND key = 'cc_column_removed' AND deleted_at IS NULL`,
    [userId] as never[],
  );
  if (ccRemoved.length === 0) {
    const ccId = await deterministicId(naturalKeys.ccColumn(userId));
    const live = await sqlite.getAllAsync<{ id: string }>(
      `SELECT id FROM computed_columns WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, ccId] as never[],
    );
    if (live.length > 0) await softDelete(userId, "computed_columns", ccId);
    await writeSetting(userId, "cc_column_removed", true);
  }

  // 1) §2.7 — pending transactions whose effective date arrived become realized.
  const due = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE user_id = ? AND status = 'pending' AND effective_date <= ? AND deleted_at IS NULL`,
    [userId, today] as never[],
  );
  if (due.length > 0) {
    await writeRows(
      userId,
      due.map((row) => ({ table: "transactions" as const, row: { ...fromDbShape("transactions", row), status: "realized" } })),
      false,
    );
  }

  // 2) Generate missing expected items (subscriptions + recurring incomes).
  const subs = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT s.*, p.is_self FROM subscriptions s JOIN persons p ON p.id = s.person_id
     WHERE s.user_id = ? AND s.deleted_at IS NULL`,
    [userId] as never[],
  );
  const incomes = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT r.*, p.is_self FROM recurring_incomes r JOIN persons p ON p.id = r.person_id
     WHERE r.user_id = ? AND r.deleted_at IS NULL`,
    [userId] as never[],
  );
  const existing = await sqlite.getAllAsync<{ kind: string; ref_id: string; due_date: string }>(
    `SELECT kind, ref_id, due_date FROM expected_payments WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const drafts = generateExpected(
    subs.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      amountMinor: s.amount_minor as number,
      currency: s.currency as string,
      cycle: s.cycle as "monthly" | "yearly" | "custom",
      intervalMonths: s.interval_months as number,
      billingDay: s.billing_day as number,
      nextDueDate: s.next_due_date as string,
      isActive: Boolean(s.is_active),
      autoPay: Boolean(s.auto_pay),
      personIsSelf: Boolean(s.is_self),
      trialEndDate: (s.trial_end_date as string) ?? null,
    })),
    incomes.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      defaultAmountMinor: r.default_amount_minor as number,
      currency: r.currency as string,
      payDay: r.pay_day as number,
      isActive: Boolean(r.is_active),
      personIsSelf: Boolean(r.is_self),
    })),
    existing.map((e) => ({ kind: e.kind as ExpectedPaymentLike["kind"], refId: e.ref_id, dueDate: e.due_date })),
    today,
  );
  if (drafts.length > 0) {
    const writes: RowWrite[] = [];
    for (const d of drafts) {
      writes.push({
        table: "expected_payments",
        row: {
          id: await deterministicId(naturalKeys.expected(userId, d.kind, d.refId, d.dueDate)),
          direction: d.direction,
          kind: d.kind,
          refId: d.refId,
          dueDate: d.dueDate,
          amountMinor: d.amountMinor,
          currency: d.currency,
          status: "pending",
          paidAt: null,
          autoConfirmed: false,
          transactionId: null,
          deletedAt: null,
        },
      });
    }
    await writeRows(userId, writes, false);
  }

  // 3) Late marking + auto-pay confirmations.
  const pendingRows = await sqlite.getAllAsync<ExpectedRow>(
    `SELECT * FROM expected_payments WHERE user_id = ? AND status = 'pending' AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const pendingLike: ExpectedPaymentLike[] = pendingRows.map((r) => ({
    id: r.id,
    direction: r.direction,
    kind: r.kind as ExpectedPaymentLike["kind"],
    refId: r.ref_id,
    dueDate: r.due_date,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status as ExpectedPaymentLike["status"],
  }));
  const autoPayIds = new Set(subs.filter((s) => Boolean(s.auto_pay)).map((s) => s.id as string));
  const selfPersonId = (
    await sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM persons WHERE user_id = ? AND is_self = 1 AND deleted_at IS NULL`,
      [userId] as never[],
    )
  )?.id;
  for (const item of findAutoConfirmable(pendingLike, autoPayIds, today)) {
    if (selfPersonId) {
      const sub = subs.find((s) => s.id === item.refId);
      try {
        await confirmExpected(userId, item.id, {
          personId: (sub?.person_id as string) ?? selfPersonId,
          categoryId: (sub?.category_id as string | null) ?? null,
          auto: true,
        });
      } catch (e) {
        // A missing FX rate must not abort the whole maintenance pass — leave
        // the item pending and auto-confirm it on a later run once a rate is
        // cached. Re-throw anything unexpected.
        if (!(e instanceof FxRateUnavailableError)) throw e;
      }
    }
  }
  const stillPending = pendingLike.filter((p) => !autoPayIds.has(p.refId) || p.kind !== "subscription");
  const late = findLate(stillPending, today);
  if (late.length > 0) {
    const byId = new Map(pendingRows.map((r) => [r.id, r]));
    await writeRows(
      userId,
      late.map((l) => ({
        table: "expected_payments" as const,
        row: { ...fromDbShape("expected_payments", byId.get(l.id) as unknown as Record<string, unknown>), status: "late" },
      })),
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// (snake_case → camelCase mapping lives in db/mutations.ts `fromDbShape`,
// which is schema-aware — a column whose name isn't a 1:1 snake/camel match
// can never silently produce a wrong field.)
