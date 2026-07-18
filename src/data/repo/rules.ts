import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { fromDbShape, nowIso, writeRows, type RowWrite } from "../../db/mutations";
import { todayISO, type ISODate } from "../../domain/dates";
import { generateExpected, obsoleteExpectedIds } from "../../domain/expected";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";
import { assertInputWithinLimit } from "../../domain/input";
import type { ExpectedPaymentLike, RecurringIncomeLike, SubscriptionLike } from "../../domain/types";
import { findSubscriptionCategory } from "../../domain/subscriptions";
import { isValidCardCycle } from "../../domain/card-statements";
import { CreditCardCycleRequiredError, SubscriptionCategoryRequiredError } from "./errors";
import { livePaymentSource } from "./transactions";
import { assertRecurringIncomeCategory } from "./rule-validation";

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
    [userId, kind, refId],
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
  }>(`SELECT id, name, kind, deleted_at FROM categories WHERE user_id = ?`, [userId]);
  const existing = findSubscriptionCategory(
    categories.map((category) => ({ ...category, deletedAt: category.deleted_at })),
    categoryName,
  );
  if (existing) return existing.id;

  const id = await deterministicId(naturalKeys.seedCategory(userId, categoryName));
  const maxOrder = await sqlite.getFirstAsync<{ max_order: number | null }>(
    `SELECT MAX(sort_order) AS max_order FROM categories WHERE user_id = ? AND deleted_at IS NULL`,
    [userId],
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
  assertInputWithinLimit(input.name, "text");
  assertInputWithinLimit(input.note, "note");
  assertSupportedMinorAmount(input.amountMinor, false);
  if (!input.categoryId) throw new SubscriptionCategoryRequiredError();
  const category = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories WHERE id = ? AND user_id = ? AND kind = 'expense' AND deleted_at IS NULL`,
    [input.categoryId, userId],
  );
  if (!category) throw new SubscriptionCategoryRequiredError();
  const person = await sqlite.getFirstAsync<{ is_self: number }>(
    `SELECT is_self FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId],
  );
  if (!person) throw new Error("Subscription person is required");
  const source = await livePaymentSource(userId, input.paymentSourceId);
  if (input.paymentSourceId && !source) throw new Error("Subscription payment source does not exist");
  if (
    source?.type === "credit_card" &&
    !isValidCardCycle({ statementDay: source.statement_day, dueDay: source.due_day })
  ) throw new CreditCardCycleRequiredError();
  const id = input.id ?? newId();
  const writes: RowWrite[] = [];
  if (input.id) {
    const prev = await sqlite.getFirstAsync<{ amount_minor: number; currency: string }>(
      `SELECT amount_minor, currency FROM subscriptions WHERE id = ? AND user_id = ?`,
      [id, userId],
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
  assertInputWithinLimit(input.name, "text");
  assertInputWithinLimit(input.note, "note");
  assertSupportedMinorAmount(input.defaultAmountMinor, false);
  const person = await sqlite.getFirstAsync<{ is_self: number }>(
    `SELECT is_self FROM persons WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [input.personId, userId],
  );
  if (!person) throw new Error("Recurring income person is required");
  await assertRecurringIncomeCategory(userId, input.categoryId);
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
    [id, userId],
  );
  if (!root) return null;
  const expected = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM expected_payments
     WHERE user_id = ? AND kind = ? AND ref_id = ?
       AND status IN ('pending', 'late') AND deleted_at IS NULL`,
    [userId, kind, id],
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
