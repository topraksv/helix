/**
 * High-level data operations. Composes domain engines with the write layer.
 * All writes flow through writeRows (outbox + last_entry_at + atomicity).
 */

import { getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys, newId } from "../db/ids";
import { fromDbShape, nowIso, readSetting, softDelete, softDeleteMany, writeRows, writeSetting, type RowWrite } from "../db/mutations";
import { addMonthsToKey, isCurrentOrFutureMonth, todayISO, yearOf, type ISODate, type MonthKey } from "../domain/dates";
import { generateSchedule } from "../domain/installments";
import { convertToTryMinor } from "../domain/fx";
import { advanceDueDate } from "../domain/recurrence";
import { lookupRate } from "../services/fx-fetch";
import { marketSellRateTry } from "../services/markets";
import { confirmEffectiveDate, findAutoConfirmable, findLate, generateExpected, obsoleteExpectedIds } from "../domain/expected";
import type { Minor } from "../domain/money";
import { collectInstallmentPlans, isInstallmentCell, planImportCell, type ParsedSheet } from "../services/spreadsheet-import";
import { suggestCategoryIcon } from "./category-icons";
import type { ExpectedPaymentLike, PaymentSourceType, RecurringIncomeLike, SubscriptionLike, TransactionType } from "../domain/types";
import { findSubscriptionCategory } from "../domain/subscriptions";
import { reconciliationDelta } from "../domain/balance";
import { categoryAcceptsTransaction } from "../domain/transactions";

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

export interface PersonReferenceUsage {
  paymentSources: number;
  installmentPlans: number;
  transactions: number;
  subscriptions: number;
  recurringIncomes: number;
  total: number;
}

export interface PaymentSourceReferenceUsage {
  installmentPlans: number;
  transactions: number;
  subscriptions: number;
  total: number;
}

export class ReferencedRecordError extends Error {
  constructor() {
    super("Record still has live references");
    this.name = "ReferencedRecordError";
  }
}

export async function personReferenceUsage(userId: string, personId: string): Promise<PersonReferenceUsage> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Omit<PersonReferenceUsage, "total">>(
    `SELECT
       (SELECT COUNT(*) FROM payment_sources WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS paymentSources,
       (SELECT COUNT(*) FROM installment_plans WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS installmentPlans,
       (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS transactions,
       (SELECT COUNT(*) FROM subscriptions WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS subscriptions,
       (SELECT COUNT(*) FROM recurring_incomes WHERE user_id = ? AND person_id = ? AND deleted_at IS NULL) AS recurringIncomes`,
    [userId, personId, userId, personId, userId, personId, userId, personId, userId, personId] as never[],
  );
  const counts = row ?? { paymentSources: 0, installmentPlans: 0, transactions: 0, subscriptions: 0, recurringIncomes: 0 };
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

export async function paymentSourceReferenceUsage(userId: string, sourceId: string): Promise<PaymentSourceReferenceUsage> {
  const sqlite = await getSqliteAsync();
  const row = await sqlite.getFirstAsync<Omit<PaymentSourceReferenceUsage, "total">>(
    `SELECT
       (SELECT COUNT(*) FROM installment_plans WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS installmentPlans,
       (SELECT COUNT(*) FROM transactions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS transactions,
       (SELECT COUNT(*) FROM subscriptions WHERE user_id = ? AND payment_source_id = ? AND deleted_at IS NULL) AS subscriptions`,
    [userId, sourceId, userId, sourceId, userId, sourceId] as never[],
  );
  const counts = row ?? { installmentPlans: 0, transactions: 0, subscriptions: 0 };
  return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
}

async function referenceUpdateRows(
  userId: string,
  table: "payment_sources" | "installment_plans" | "transactions" | "subscriptions" | "recurring_incomes",
  column: "person_id" | "payment_source_id",
  currentId: string,
  field: "personId" | "paymentSourceId",
  replacementId: string | null,
): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE user_id = ? AND ${column} = ? AND deleted_at IS NULL`,
    [userId, currentId] as never[],
  );
  return rows.map((row) => ({ table, row: { ...fromDbShape(table, row), [field]: replacementId } }));
}

export async function deleteUnreferencedPerson(userId: string, personId: string): Promise<Record<string, unknown> | null> {
  const usage = await personReferenceUsage(userId, personId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM persons WHERE id = ? AND user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
    [personId, userId] as never[],
  );
  if (!person) return null;
  await writeRows(userId, [{ table: "persons", row: { ...fromDbShape("persons", person), deletedAt: nowIso() } }]);
  return person;
}

export async function reassignAndDeletePerson(userId: string, personId: string, replacementId: string): Promise<void> {
  if (personId === replacementId) throw new Error("Replacement person must differ");
  const sqlite = await getSqliteAsync();
  const [person, replacement] = await Promise.all([
    sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM persons WHERE id = ? AND user_id = ? AND is_self = 0 AND deleted_at IS NULL`,
      [personId, userId] as never[],
    ),
    sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [replacementId, userId] as never[],
    ),
  ]);
  if (!person || !replacement) throw new Error("Person not found");
  const writes = (
    await Promise.all([
      referenceUpdateRows(userId, "payment_sources", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "installment_plans", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "transactions", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "subscriptions", "person_id", personId, "personId", replacementId),
      referenceUpdateRows(userId, "recurring_incomes", "person_id", personId, "personId", replacementId),
    ])
  ).flat();
  writes.push({ table: "persons", row: { ...fromDbShape("persons", person), deletedAt: nowIso() } });
  await writeRows(userId, writes);
  // Expected rows are derived from person ownership. Maintenance immediately
  // creates/cleans them under the replacement's self/watch-only classification.
  await runMaintenance(userId);
}

export async function deleteUnreferencedPaymentSource(userId: string, sourceId: string): Promise<Record<string, unknown> | null> {
  const usage = await paymentSourceReferenceUsage(userId, sourceId);
  if (usage.total > 0) throw new ReferencedRecordError();
  const sqlite = await getSqliteAsync();
  const source = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId] as never[],
  );
  if (!source) return null;
  await writeRows(userId, [{ table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt: nowIso() } }]);
  return source;
}

export async function reassignAndDeletePaymentSource(
  userId: string,
  sourceId: string,
  replacementId: string | null,
): Promise<void> {
  if (sourceId === replacementId) throw new Error("Replacement source must differ");
  const sqlite = await getSqliteAsync();
  const source = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [sourceId, userId] as never[],
  );
  if (!source) return;
  if (replacementId) {
    const replacement = await sqlite.getFirstAsync<{ id: string }>(
      `SELECT id FROM payment_sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [replacementId, userId] as never[],
    );
    if (!replacement) throw new Error("Payment source not found");
  }
  const writes = (
    await Promise.all([
      referenceUpdateRows(userId, "installment_plans", "payment_source_id", sourceId, "paymentSourceId", replacementId),
      referenceUpdateRows(userId, "transactions", "payment_source_id", sourceId, "paymentSourceId", replacementId),
      referenceUpdateRows(userId, "subscriptions", "payment_source_id", sourceId, "paymentSourceId", replacementId),
    ])
  ).flat();
  writes.push({ table: "payment_sources", row: { ...fromDbShape("payment_sources", source), deletedAt: nowIso() } });
  await writeRows(userId, writes);
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
  categoryId: string;
  paymentSourceId: string | null;
  personId: string;
  note: string | null;
  isAggregate?: boolean;
  subscriptionId?: string | null;
}

function assertSignedTransactionAmounts(amountMinor: Minor, amountTryMinor: Minor): void {
  if (
    !Number.isSafeInteger(amountMinor) ||
    !Number.isSafeInteger(amountTryMinor) ||
    amountMinor === 0 ||
    amountTryMinor === 0 ||
    Math.sign(amountMinor) !== Math.sign(amountTryMinor)
  ) {
    throw new Error("Invalid signed transaction amount");
  }
}

async function assertTransactionCategory(
  userId: string,
  type: TransactionType,
  categoryId: string | null,
  required: boolean,
): Promise<void> {
  if (!categoryId) {
    if (required) throw new Error("Transaction category is required");
    return;
  }
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<{ kind: "expense" | "income" }>(
    `SELECT kind FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId] as never[],
  );
  if (!category || !categoryAcceptsTransaction(type, category.kind)) {
    throw new Error("Transaction type and category do not match");
  }
}

export async function addTransaction(userId: string, input: NewTransaction): Promise<string> {
  assertSignedTransactionAmounts(input.amountMinor, input.amountTryMinor);
  await assertTransactionCategory(userId, input.type, input.categoryId, true);
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
  categoryId: string;
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
  assertSignedTransactionAmounts(patch.amountMinor, patch.amountTryMinor);
  await assertTransactionCategory(userId, patch.type, patch.categoryId, true);
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

/**
 * Reconcile to a real-world balance WITHOUT rewriting history. Stores the
 * difference between the target and the currently-computed balance as one
 * balance adjustment dated today, so every prior month's chain (and the opening
 * balance) is untouched — only today onward shifts by the delta.
 *
 * `computedNowMinor` is the balance the caller currently shows (it already
 * includes any earlier same-day adjustment). The adjustment row is keyed by day
 * so repeated corrections converge on the target instead of stacking: we back
 * out today's existing adjustment before computing the new delta.
 */
export async function setCurrentBalance(
  userId: string,
  targetMinor: Minor,
  computedNowMinor: Minor,
  note: string | null = null,
): Promise<void> {
  const today = todayISO();
  const id = await deterministicId(naturalKeys.balanceAdjustment(userId, today));
  const sqlite = await getSqliteAsync();
  const prev = await sqlite.getFirstAsync<{ amount_minor: number; created_at: string }>(
    `SELECT amount_minor, created_at FROM balance_adjustments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId] as never[],
  );
  const prevAmount = prev?.amount_minor ?? 0;
  // computedNow already contains prevAmount; the new adjustment must make the
  // total land on target: (computedNow - prevAmount) + delta = target.
  const delta = reconciliationDelta(targetMinor, computedNowMinor, prevAmount);
  await writeRows(userId, [
    {
      table: "balance_adjustments",
      row: {
        id,
        date: today,
        amountMinor: delta,
        note,
        createdAt: prev?.created_at,
        // Returning exactly to the unadjusted balance removes the reconciliation
        // from the live ledger instead of leaving a meaningless zero row.
        deletedAt: delta === 0 ? nowIso() : null,
      },
    },
  ]);
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
  await assertTransactionCategory(userId, "expense", input.categoryId, false);
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
  categoryId: string;
  personId: string;
  isActive: boolean;
  trialEndDate: ISODate | null;
  autoPay: boolean;
  websiteDomain: string | null;
  note: string | null;
}

export class SubscriptionCategoryRequiredError extends Error {
  constructor() {
    super("Subscription category is required");
    this.name = "SubscriptionCategoryRequiredError";
  }
}

type RuleKind = "subscription" | "recurring_income";

async function refreshRuleExpectedWrites(
  userId: string,
  kind: RuleKind,
  refId: string,
  source: { subscription?: SubscriptionLike; income?: RecurringIncomeLike },
): Promise<RowWrite[]> {
  const sqlite = await getSqliteAsync();
  const today = todayISO();
  const rows = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM expected_payments
     WHERE user_id = ? AND kind = ? AND ref_id = ? AND deleted_at IS NULL`,
    [userId, kind, refId] as never[],
  );
  const terminal = rows
    .filter((row) => row.status === "paid" || row.status === "skipped")
    .map((row) => ({
      kind: row.kind as ExpectedPaymentLike["kind"],
      refId: row.ref_id as string,
      dueDate: row.due_date as string,
    }));
  const drafts = generateExpected(
    source.subscription ? [source.subscription] : [],
    source.income ? [source.income] : [],
    terminal,
    today,
  );
  const sourceActive = source.subscription
    ? source.subscription.isActive && source.subscription.personIsSelf
    : Boolean(source.income?.isActive && source.income.personIsSelf);
  const obsoleteIds = new Set(obsoleteExpectedIds(
    rows.map((row) => ({
      id: String(row.id),
      direction: row.direction as ExpectedPaymentLike["direction"],
      kind: row.kind as ExpectedPaymentLike["kind"],
      refId: String(row.ref_id),
      dueDate: String(row.due_date),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      status: row.status as ExpectedPaymentLike["status"],
    })),
    drafts,
    today,
    sourceActive,
  ));
  const writes: RowWrite[] = [];
  for (const row of rows) {
    if (obsoleteIds.has(String(row.id))) {
      writes.push({
        table: "expected_payments",
        row: { ...fromDbShape("expected_payments", row), deletedAt: nowIso() },
      });
    }
  }
  for (const draft of drafts) {
    writes.push({
      table: "expected_payments",
      row: {
        id: await deterministicId(naturalKeys.expected(userId, draft.kind, draft.refId, draft.dueDate)),
        direction: draft.direction,
        kind: draft.kind,
        refId: draft.refId,
        dueDate: draft.dueDate,
        amountMinor: draft.amountMinor,
        currency: draft.currency,
        status: "pending",
        paidAt: null,
        autoConfirmed: false,
        transactionId: null,
        deletedAt: null,
      },
    });
  }
  return writes;
}

/**
 * Reuse the live "Abonelikler" expense category or create/revive its
 * deterministic seed row. Repeated taps and multiple devices converge on one
 * id instead of multiplying categories.
 */
export async function ensureSubscriptionCategory(
  userId: string,
  categoryName: string,
): Promise<string> {
  const sqlite = await getSqliteAsync();
  const categories = await sqlite.getAllAsync<{
    id: string;
    name: string;
    kind: "expense" | "income";
    deleted_at: string | null;
  }>(`SELECT id, name, kind, deleted_at FROM categories WHERE user_id = ?`, [userId] as never[]);
  const existing = findSubscriptionCategory(
    categories.map((category) => ({ ...category, deletedAt: category.deleted_at })),
    categoryName,
  );
  if (existing) return existing.id;

  const id = await deterministicId(naturalKeys.seedCategory(userId, categoryName));
  const maxOrder = await sqlite.getFirstAsync<{ max_order: number | null }>(
    `SELECT MAX(sort_order) AS max_order FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  await writeRows(userId, [{
    table: "categories",
    row: {
      id,
      name: categoryName,
      kind: "expense",
      icon: "🔁",
      color: null,
      sortOrder: (maxOrder?.max_order ?? -1) + 1,
      isColumn: true,
      deletedAt: null,
    },
  }]);
  return id;
}

export async function upsertSubscription(userId: string, input: SubscriptionInput): Promise<string> {
  const sqlite = await getSqliteAsync();
  if (!input.categoryId) throw new SubscriptionCategoryRequiredError();
  const category = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories WHERE id = ? AND user_id = ? AND kind = 'expense' AND deleted_at IS NULL`,
    [input.categoryId, userId] as never[],
  );
  if (!category) throw new SubscriptionCategoryRequiredError();
  const person = await sqlite.getFirstAsync<{ is_self: number }>(
    `SELECT is_self FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId] as never[],
  );
  if (!person) throw new Error("Subscription person is required");
  const id = input.id ?? newId();
  const writes: RowWrite[] = [];
  if (input.id) {
    const prev = await sqlite.getFirstAsync<{ amount_minor: number; currency: string }>(
      `SELECT amount_minor, currency FROM subscriptions WHERE id = ? AND user_id = ?`,
      [id, userId] as never[],
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
  writes.push(
    ...(await refreshRuleExpectedWrites(userId, "subscription", id, {
      subscription: {
        id,
        name: input.name,
        amountMinor: input.amountMinor,
        currency: input.currency,
        cycle: input.cycle,
        intervalMonths: input.intervalMonths,
        billingDay: input.billingDay,
        nextDueDate: input.nextDueDate,
        isActive: input.isActive,
        autoPay: input.autoPay,
        personIsSelf: Boolean(person.is_self),
        trialEndDate: input.trialEndDate,
      },
    })),
  );
  await writeRows(userId, writes);
  return id;
}

export interface RecurringIncomeInput {
  id?: string;
  name: string;
  kind: "salary" | "rent" | "allowance" | "other";
  defaultAmountMinor: Minor;
  currency: string;
  payDay: number;
  personId: string;
  categoryId: string | null;
  isActive: boolean;
  note: string | null;
}

export async function upsertRecurringIncome(userId: string, input: RecurringIncomeInput): Promise<string> {
  const sqlite = await getSqliteAsync();
  const person = await sqlite.getFirstAsync<{ is_self: number }>(
    `SELECT is_self FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId] as never[],
  );
  if (!person) throw new Error("Recurring income person is required");
  const id = input.id ?? newId();
  const writes: RowWrite[] = [
    {
      table: "recurring_incomes",
      row: {
        id,
        name: input.name,
        kind: input.kind,
        defaultAmountMinor: input.defaultAmountMinor,
        currency: input.currency,
        payDay: input.payDay,
        personId: input.personId,
        categoryId: input.categoryId,
        isActive: input.isActive,
        note: input.note,
        deletedAt: null,
      },
    },
    ...(await refreshRuleExpectedWrites(userId, "recurring_income", id, {
      income: {
        id,
        name: input.name,
        defaultAmountMinor: input.defaultAmountMinor,
        currency: input.currency,
        payDay: input.payDay,
        isActive: input.isActive,
        personIsSelf: Boolean(person.is_self),
      },
    })),
  ];
  await writeRows(userId, writes);
  return id;
}

export interface RuleDeleteSnapshot {
  table: "subscriptions" | "recurring_incomes";
  root: Record<string, unknown>;
  expected: Record<string, unknown>[];
}

async function deleteRuleWithExpected(
  userId: string,
  table: RuleDeleteSnapshot["table"],
  kind: RuleKind,
  id: string,
): Promise<RuleDeleteSnapshot | null> {
  const sqlite = await getSqliteAsync();
  const root = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId] as never[],
  );
  if (!root) return null;
  const expected = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM expected_payments
     WHERE user_id = ? AND kind = ? AND ref_id = ?
       AND status IN ('pending', 'late') AND deleted_at IS NULL`,
    [userId, kind, id] as never[],
  );
  const deletedAt = nowIso();
  await writeRows(userId, [
    { table, row: { ...fromDbShape(table, root), deletedAt } },
    ...expected.map((row) => ({
      table: "expected_payments" as const,
      row: { ...fromDbShape("expected_payments", row), deletedAt },
    })),
  ]);
  return { table, root, expected };
}

export function deleteSubscriptionWithExpected(userId: string, id: string): Promise<RuleDeleteSnapshot | null> {
  return deleteRuleWithExpected(userId, "subscriptions", "subscription", id);
}

export function deleteRecurringIncomeWithExpected(userId: string, id: string): Promise<RuleDeleteSnapshot | null> {
  return deleteRuleWithExpected(userId, "recurring_incomes", "recurring_income", id);
}

export async function restoreDeletedRule(userId: string, snapshot: RuleDeleteSnapshot): Promise<void> {
  await writeRows(userId, [
    { table: snapshot.table, row: { ...fromDbShape(snapshot.table, snapshot.root), deletedAt: null } },
    ...snapshot.expected.map((row) => ({
      table: "expected_payments" as const,
      row: { ...fromDbShape("expected_payments", row), deletedAt: null },
    })),
  ]);
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

async function getExpectedRow(userId: string, id: string): Promise<ExpectedRow | null> {
  const sqlite = await getSqliteAsync();
  return sqlite.getFirstAsync<ExpectedRow>(
    `SELECT * FROM expected_payments WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId] as never[],
  );
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
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  const amount = opts.actualAmountMinor ?? row.amount_minor;
  // Snapshot the TRY value at confirm time. For foreign-currency items convert
  // with the Harem sell ("satış") price (already streamed), falling back to the
  // cached TCMB rate. If NEITHER is available we must not store the raw foreign
  // amount as TRY (that silently corrupts the balance) — refuse the confirm so
  // the caller can retry once a rate is known.
  const appliedRate = row.currency === "TRY"
    ? null
    : marketSellRateTry(row.currency) ?? lookupRate(userId, row.currency)?.rate.rateTry ?? null;
  if (row.currency !== "TRY" && appliedRate == null) throw new FxRateUnavailableError(row.currency);
  const amountTryMinor = appliedRate == null ? amount : convertToTryMinor(amount, appliedRate);
  assertSignedTransactionAmounts(amount, amountTryMinor);
  await assertTransactionCategory(
    userId,
    row.direction === "in" ? "income" : "expense",
    opts.categoryId ?? null,
    false,
  );
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
        fxRate: appliedRate == null ? null : String(appliedRate),
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
      `SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.ref_id, userId] as never[],
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
  const row = await getExpectedRow(userId, expectedId);
  if (!row || (row.status !== "pending" && row.status !== "late")) return;
  await writeRows(userId, [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "skipped" },
    },
  ]);
}

/** Undo a confirmation: tombstone the created transaction, back to pending. */
export async function revertExpected(userId: string, expectedId: string): Promise<void> {
  const row = await getExpectedRow(userId, expectedId);
  if (!row || row.status !== "paid") return;
  const sqlite = await getSqliteAsync();
  const writes: RowWrite[] = [
    {
      table: "expected_payments",
      row: { ...fromDbShape("expected_payments", row as unknown as Record<string, unknown>), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
    },
  ];
  if (row.transaction_id) {
    const transaction = await sqlite.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [row.transaction_id, userId] as never[],
    );
    if (transaction) {
      writes.unshift({
        table: "transactions",
        row: { ...fromDbShape("transactions", transaction), deletedAt: nowIso() },
      });
    }
  }
  await writeRows(userId, writes);
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
  if (isCurrentOrFutureMonth(month)) throw new Error("Bulk history accepts past months only");
  await Promise.all(
    entries.map((entry) =>
      assertTransactionCategory(userId, entry.isInvestment ? "transfer" : entry.kind, entry.categoryId, true),
    ),
  );
  const today = todayISO();
  const effectiveDate = `${month}-15`; // mid-month anchor for aggregates
  const status = "realized" as const;
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

async function importBatchMap(userId: string): Promise<Map<number, ImportBatch>> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE user_id = ? AND key LIKE 'import_batch:%' AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const result = new Map<number, ImportBatch>();
  for (const row of rows) {
    const year = Number(row.key.slice("import_batch:".length));
    const batch = parseImportBatch(row.value);
    if (Number.isInteger(year) && batch) result.set(year, batch);
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
      [userId] as never[],
    );
    const importedPlanIds = new Set<string>();
    for (const plan of plans) {
      if (plan.monthly_amount_minor == null) continue;
      const expectedId = await deterministicId(
        naturalKeys.importInstallmentPlan(userId, plan.title, plan.monthly_amount_minor, plan.installment_count, plan.start_month),
      );
      if (expectedId !== plan.id) continue;
      importedPlanIds.add(plan.id);
      const startYear = yearOf(plan.start_month);
      const endYear = yearOf(addMonthsToKey(plan.start_month, plan.installment_count - 1));
      for (const [year, batch] of result) {
        if (year >= startYear && year <= endYear) batch.installmentPlans = [...new Set([...(batch.installmentPlans ?? []), plan.id])];
      }
    }
    if (importedPlanIds.size > 0) {
      const generated = await sqlite.getAllAsync<{ id: string; installment_plan_id: string }>(
        `SELECT id, installment_plan_id FROM transactions
         WHERE user_id = ? AND installment_plan_id IS NOT NULL AND deleted_at IS NULL`,
        [userId] as never[],
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
  return result;
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
      [userId, ...chunk] as never[],
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
    [userId] as never[],
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
  const existing = await sqlite.getAllAsync<{ id: string; name: string; kind: "expense" | "income"; sort_order: number }>(
    `SELECT id, name, kind, sort_order FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const normalizedName = (name: string) => name.trim().toLocaleLowerCase("tr-TR");
  const categoryKey = (name: string, kind: "expense" | "income") => `${normalizedName(name)}|${kind}`;
  const idByNameAndKind = new Map(existing.map((c) => [categoryKey(c.name, c.kind), c.id]));
  let sortSeed = existing.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1;
  // Query payment sources up front too, so the whole import — categories, rows,
  // reconstructed installment cards + plans — flushes in ONE writeRows. A read
  // issued AFTER a multi-thousand-row write starved the sqlite worker and hung.
  const existingSources = await sqlite.getAllAsync<{ id: string; name: string }>(
    `SELECT id, name FROM payment_sources WHERE user_id = ? AND deleted_at IS NULL`,
    [userId] as never[],
  );
  const sourceIdByName = new Map(existingSources.map((s) => [normalizedName(s.name), s.id]));

  const catWrites: RowWrite[] = [];
  const ensureCategory = (label: string, kind: "expense" | "income"): string => {
    const cleanLabel = label.trim();
    const key = categoryKey(cleanLabel, kind);
    let id = idByNameAndKind.get(key);
    if (!id) {
      id = newId();
      idByNameAndKind.set(key, id);
      catWrites.push({
        table: "categories",
        row: { id, name: cleanLabel, kind, icon: suggestCategoryIcon(cleanLabel, kind), color: null, sortOrder: sortSeed++, isColumn: true, deletedAt: null },
      });
    }
    return id;
  };

  const selectedYears = req.selectedYears ? new Set(req.selectedYears) : null;
  const yearAllowed = (y: number) => !selectedYears || selectedYears.has(y);

  const affectedYears = [...new Set(req.sheets.flatMap((s) => s.months.map(yearOf)))].filter(yearAllowed);
  const priorBatches = await importBatchMap(userId);
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

  for (const sheet of req.sheets) {
    const active = sheet.columns.map((c, i) => ({ ...c, index: i })).filter((c) => !req.excludedLabels.includes(c.label));
    const orderedCatIds = active.map((col) => ensureCategory(col.label, col.kindGuess));

    for (let r = 0; r < sheet.months.length; r++) {
      const month = sheet.months[r];
      const year = yearOf(month);
      if (!yearAllowed(year)) continue;
      const priorColumns = columnYearsUpdates.get(year) ?? [];
      columnYearsUpdates.set(year, [...new Set([...priorColumns, ...orderedCatIds])]);
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
          // Keep reversals signed in their original category. A refund reduces
          // expense distribution instead of masquerading as income under an
          // expense category.
          const baseType: TransactionType = col.isInvestment ? "transfer" : col.kindGuess;
          const amount = item.amountMinor;
          txWrites.push({
            table: "transactions",
            row: {
              id,
              type: baseType,
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
    const key = normalizedName(spec.card);
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
      const built = await buildPlanRows(planId, {
        title: spec.name,
        kind: "card_installment",
        totalAmountMinor: null,
        monthlyAmountMinor: spec.monthlyMinor,
        installmentCount: spec.total,
        currency: "TRY",
        fxRate: null,
        startMonth: spec.startMonth,
        dueDay: null,
        paymentSourceId: sourceIdByName.get(normalizedName(spec.card)) ?? null,
        personId: req.selfId,
        personIsSelf: true,
        categoryId:
          idByNameAndKind.get(categoryKey(spec.columnLabel, "expense")) ??
          idByNameAndKind.get(categoryKey(spec.columnLabel, "income")) ??
          null,
        note: null,
        tryFactor: 1,
      }, today);
      return { ...built, planId, spec };
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
      const repairWrites: RowWrite[] = [];
      for (const table of ["transactions", "payment_sources", "subscriptions", "recurring_incomes", "installment_plans"] as const) {
        const refs = await sqlite.getAllAsync<Record<string, unknown>>(
          `SELECT * FROM ${table} WHERE user_id = ? AND person_id = ?`,
          [userId, dup.id] as never[],
        );
        repairWrites.push(...refs.map((row) => ({ table, row: { ...fromDbShape(table, row), personId: keepId } })));
      }
      const duplicate = await sqlite.getFirstAsync<Record<string, unknown>>(
        `SELECT * FROM persons WHERE id = ? AND user_id = ?`,
        [dup.id, userId] as never[],
      );
      if (duplicate) repairWrites.push({ table: "persons", row: { ...fromDbShape("persons", duplicate), deletedAt: nowIso() } });
      if (repairWrites.length > 0) await writeRows(userId, repairWrites, false);
    }
  }

  // 0b) Repair legacy type/category mismatches without changing cash balance.
  // Older import/editor code represented an expense refund as income +100 in
  // the expense category. Canonical form is expense -100: same +100 balance
  // effect, but every category/chart can now net the refund consistently.
  const mismatched = await sqlite.getAllAsync<Record<string, unknown> & { category_kind: "expense" | "income" }>(
    `SELECT t.*, c.kind AS category_kind
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.deleted_at IS NULL
       AND t.type != 'transfer' AND t.type != c.kind`,
    [userId] as never[],
  );
  if (mismatched.length > 0) {
    await writeRows(
      userId,
      mismatched.map((row) => ({
        table: "transactions" as const,
        row: {
          ...fromDbShape("transactions", row),
          type: row.category_kind,
          amountMinor: -(row.amount_minor as number),
          amountTryMinor: -(row.amount_try_minor as number),
        },
      })),
      false,
    );
  }

  // 0c) One-time removal: the auto-created "KK Taksit" (credit-card installment
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
    `SELECT s.*, p.is_self FROM subscriptions s
     JOIN persons p ON p.id = s.person_id AND p.user_id = s.user_id AND p.deleted_at IS NULL
     WHERE s.user_id = ? AND s.deleted_at IS NULL`,
    [userId] as never[],
  );
  const incomes = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT r.*, p.is_self FROM recurring_incomes r
     JOIN persons p ON p.id = r.person_id AND p.user_id = r.user_id AND p.deleted_at IS NULL
     WHERE r.user_id = ? AND r.deleted_at IS NULL`,
    [userId] as never[],
  );
  // Older builds generated dashboard obligations for watch-only people. Those
  // rows never belong in the user's balance/forecast; clean pending/late
  // derivatives while retaining paid/skipped history.
  const watchedSubscriptions = new Set(subs.filter((row) => !Boolean(row.is_self)).map((row) => row.id as string));
  const watchedIncomes = new Set(incomes.filter((row) => !Boolean(row.is_self)).map((row) => row.id as string));
  if (watchedSubscriptions.size > 0 || watchedIncomes.size > 0) {
    const mutableExpected = await sqlite.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM expected_payments
       WHERE user_id = ? AND status IN ('pending', 'late') AND deleted_at IS NULL`,
      [userId] as never[],
    );
    const stale = mutableExpected.filter((row) =>
      (row.kind === "subscription" && watchedSubscriptions.has(row.ref_id as string)) ||
      (row.kind === "recurring_income" && watchedIncomes.has(row.ref_id as string)),
    );
    if (stale.length > 0) {
      await writeRows(
        userId,
        stale.map((row) => ({
          table: "expected_payments" as const,
          row: { ...fromDbShape("expected_payments", row), deletedAt: nowIso() },
        })),
        false,
      );
    }
  }
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
  const autoPayIds = new Set(subs.filter((s) => Boolean(s.auto_pay) && Boolean(s.is_self)).map((s) => s.id as string));
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
