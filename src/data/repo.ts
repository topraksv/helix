/**
 * High-level data operations. Composes domain engines with the write layer.
 * All writes flow through writeRows (outbox + last_entry_at + atomicity).
 */

import { getSqliteAsync } from "../db/client";
import { deterministicId, naturalKeys, newId } from "../db/ids";
import { nowIso, softDelete, writeRows, writeSetting, type RowWrite } from "../db/mutations";
import { todayISO, type ISODate, type MonthKey } from "../domain/dates";
import { generateSchedule } from "../domain/installments";
import { advanceDueDate } from "../domain/recurrence";
import { findAutoConfirmable, findLate, generateExpected } from "../domain/expected";
import type { Minor } from "../domain/money";
import type { ExpectedPaymentLike, PaymentSourceType, TransactionType } from "../domain/types";

// ---------------------------------------------------------------------------
// Onboarding seed
// ---------------------------------------------------------------------------

/** Excel-like default template. Pure template content — fully editable later. */
export const TEMPLATE_CATEGORIES: { name: string; kind: "expense" | "income"; isColumn: boolean; icon?: string }[] = [
  { name: "Kredi Kartı Tek Çekim", kind: "expense", isColumn: true, icon: "💳" },
  { name: "Ev Kredisi", kind: "expense", isColumn: true, icon: "🏠" },
  { name: "Fatura ve Abonelikler", kind: "expense", isColumn: true, icon: "🧾" },
  { name: "Yatırım", kind: "expense", isColumn: true, icon: "📈" },
  { name: "Ek Giderler", kind: "expense", isColumn: true, icon: "🧺" },
  { name: "Maaş", kind: "income", isColumn: true, icon: "💰" },
  { name: "Ek Gelirler", kind: "income", isColumn: true, icon: "➕" },
];

export interface SeedInput {
  template: "excel" | "blank";
  startMonth: MonthKey;
  openingBalanceMinor: Minor;
  persons: { name: string; isSelf: boolean }[];
  sources: { name: string; type: PaymentSourceType; personIndex: number; dueDay?: number | null }[];
}

export async function seedWorkspace(userId: string, input: SeedInput): Promise<void> {
  const writes: RowWrite[] = [];
  // The self person gets a deterministic id so double-taps and multi-device
  // seeds converge on one row instead of duplicating "me".
  const personIds = await Promise.all(
    input.persons.map((p) => (p.isSelf ? deterministicId(naturalKeys.selfPerson(userId)) : Promise.resolve(newId()))),
  );
  input.persons.forEach((p, i) => {
    writes.push({ table: "persons", row: { id: personIds[i], name: p.name, isSelf: p.isSelf, deletedAt: null } });
  });
  input.sources.forEach((s, i) => {
    writes.push({
      table: "payment_sources",
      row: {
        id: newId(),
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
  if (input.template === "excel") {
    TEMPLATE_CATEGORIES.forEach((c, i) => {
      writes.push({
        table: "categories",
        row: { id: newId(), name: c.name, kind: c.kind, icon: c.icon ?? null, color: null, sortOrder: i, isColumn: c.isColumn, deletedAt: null },
      });
    });
  }
  await writeRows(userId, writes);
  await writeSetting(userId, "start_month", input.startMonth);
  await writeSetting(userId, "opening_balance_minor", input.openingBalanceMinor);
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
async function writePlanWithSchedule(userId: string, planId: string, input: NewPlan): Promise<Set<number>> {
  const today = todayISO();
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
  const writes: RowWrite[] = [
    {
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
    },
  ];
  const keepNos = new Set<number>();
  for (const item of schedule) {
    keepNos.add(item.installmentNo);
    writes.push({
      table: "transactions",
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
    });
  }
  await writeRows(userId, writes);
  return keepNos;
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
  for (const t of existing) {
    if (t.installment_no != null && !keepNos.has(t.installment_no)) await softDelete(userId, "transactions", t.id);
  }
}

/** Tombstone a plan together with its generated transactions. */
export async function deletePlan(userId: string, planId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const txIds = await sqlite.getAllAsync<{ id: string }>(
    `SELECT id FROM transactions WHERE installment_plan_id = ? AND deleted_at IS NULL`,
    [planId] as never[],
  );
  await softDelete(userId, "installment_plans", planId);
  for (const { id } of txIds) await softDelete(userId, "transactions", id);
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
  opts: { actualAmountMinor?: Minor; categoryId?: string | null; personId: string; auto?: boolean },
): Promise<void> {
  const row = await getExpectedRow(expectedId);
  if (!row || row.status === "paid") return;
  const amount = opts.actualAmountMinor ?? row.amount_minor;
  const txId = newId();
  const today = todayISO();
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
        amountTryMinor: amount, // non-TRY expected amounts are entered in TRY equivalents at confirm time
        entryDate: today,
        effectiveDate: row.due_date <= today ? row.due_date : today,
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
          ...dbToCamel(sub),
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
      row: { ...dbToCamel(row as unknown as Record<string, unknown>), status: "skipped" },
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
      row: { ...dbToCamel(row as unknown as Record<string, unknown>), status: "pending", paidAt: null, transactionId: null, autoConfirmed: false },
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
  const writes: RowWrite[] = entries.map((e) => ({
    table: "transactions",
    row: {
      id: newId(),
      type: e.isInvestment ? "transfer" : e.kind,
      amountMinor: e.amountMinor,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: e.amountMinor,
      entryDate: todayISO(),
      effectiveDate: `${month}-15`, // mid-month anchor for aggregates
      status: "realized",
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
// Daily maintenance: §2.7 date flips, expected generation, late marking, auto-pay
// ---------------------------------------------------------------------------

export async function runMaintenance(userId: string): Promise<void> {
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
            refs.map((row) => ({ table, row: { ...dbToCamel(row), personId: keepId } })),
            false,
          );
        }
      }
      await softDelete(userId, "persons", dup.id);
    }
  }

  // 1) §2.7 — pending transactions whose effective date arrived become realized.
  const due = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM transactions WHERE user_id = ? AND status = 'pending' AND effective_date <= ? AND deleted_at IS NULL`,
    [userId, today] as never[],
  );
  if (due.length > 0) {
    await writeRows(
      userId,
      due.map((row) => ({ table: "transactions" as const, row: { ...dbToCamel(row), status: "realized" } })),
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
      await confirmExpected(userId, item.id, {
        personId: (sub?.person_id as string) ?? selfPersonId,
        categoryId: (sub?.category_id as string | null) ?? null,
        auto: true,
      });
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
        row: { ...dbToCamel(byId.get(l.id) as unknown as Record<string, unknown>), status: "late" },
      })),
      false,
    );
  }
}

// ---------------------------------------------------------------------------

/** snake_case row → camelCase (local helper; column names are 1:1 snake/camel). */
function dbToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}
