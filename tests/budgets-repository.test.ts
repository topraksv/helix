import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  beforeTransaction: null as (() => void) | null,
}));

vi.mock("../src/db/client", () => ({
  getSqliteAsync: async () => ({
    getFirstAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).get(...(args as never[])) ?? null,
    getAllAsync: async (sql: string, args: unknown[] = []) =>
      harness.db!.prepare(sql).all(...(args as never[])),
    runAsync: async (sql: string, args: unknown[] = []) => ({
      changes: Number(harness.db!.prepare(sql).run(...(args as never[])).changes),
    }),
  }),
  withTransaction: async (task: () => Promise<void>) => {
    harness.db!.exec("BEGIN");
    try {
      const beforeTransaction = harness.beforeTransaction;
      harness.beforeTransaction = null;
      beforeTransaction?.();
      await task();
      harness.db!.exec("COMMIT");
    } catch (error) {
      harness.db!.exec("ROLLBACK");
      throw error;
    }
  },
}));

vi.mock("../src/db/ids", () => ({
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: new Proxy(
    {},
    {
      get:
        (_target, property) =>
        (...parts: unknown[]) =>
          `${String(property)}|${parts.join("|")}`,
    },
  ),
}));

vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));

import {
  categoryReferenceUsage,
  deleteCategoryBudget,
  deleteCategoryWithBudgets,
  restoreCategoryBudget,
  restoreCategoryWithBudgets,
  upsertCategoryBudget,
} from "../src/data/repo/budgets";
import { fromDbShape } from "../src/db/mutations";
import { migrationStatements } from "./helpers";

const USER = "budget-user";
const OTHER_USER = "other-user";
const NOW = "2026-08-13T09:00:00.000Z";

function seedCategory(
  id: string,
  options: {
    userId?: string;
    kind?: "expense" | "income";
    isTransfer?: boolean;
    deletedAt?: string | null;
  } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO categories
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, icon, color, sort_order, is_column, is_transfer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.kind ?? "expense",
    options.isTransfer ? 1 : 0,
  );
}

function seedPerson(id = "self", userId = USER): void {
  harness.db!.prepare(
    `INSERT INTO persons
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version, name, is_self)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 1)`,
  ).run(id, userId, NOW, NOW, id);
}

function seedBudget(
  id: string,
  categoryId: string,
  options: { userId?: string; deletedAt?: string | null; amountMinor?: number; month?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO category_budgets
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       category_id, month, amount_minor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    categoryId,
    options.month ?? "2026-08",
    options.amountMinor ?? 50_000,
  );
}

function seedTransaction(
  id: string,
  categoryId: string,
  options: { userId?: string; deletedAt?: string | null; personId?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO transactions
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       type, amount_minor, currency, fx_rate, amount_try_minor, entry_date,
       purchase_date, effective_date, status, category_id, payment_source_id,
       person_id, installment_plan_id, installment_no, card_statement_id,
       subscription_id, is_aggregate, note)
     VALUES (?, ?, ?, ?, ?, ?, 'expense', 1000, 'TRY', NULL, 1000,
       '2026-08-01', NULL, '2026-08-01', 'realized', ?, NULL, ?, NULL, NULL,
       NULL, NULL, 0, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    categoryId,
    options.personId ?? (userId === USER ? "self" : "other-self"),
  );
}

function seedSubscription(
  id: string,
  categoryId: string,
  options: { userId?: string; deletedAt?: string | null; personId?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO subscriptions
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, amount_minor, amount_mode, currency, cycle, interval_months,
       billing_day, next_due_date, payment_source_id, category_id, person_id,
       is_active, canceled_at, trial_end_date, auto_pay, website_domain,
       logo_source, logo_ref, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 'fixed', 'TRY', 'monthly', 1,
       1, '2026-09-01', NULL, ?, ?, 1, NULL, NULL, 0, NULL,
       'initials', NULL, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    categoryId,
    options.personId ?? (userId === USER ? "self" : "other-self"),
  );
}

function seedIncome(
  id: string,
  categoryId: string,
  options: { userId?: string; deletedAt?: string | null; personId?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO recurring_incomes
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       name, kind, default_amount_minor, currency, pay_day, recurrence,
       anchor_date, person_id, category_id, is_active, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'salary', 1000, 'TRY', 1, 'monthly',
       NULL, ?, ?, 1, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.personId ?? (userId === USER ? "self" : "other-self"),
    categoryId,
  );
}

function seedPlan(
  id: string,
  categoryId: string,
  options: { userId?: string; deletedAt?: string | null; personId?: string } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO installment_plans
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       title, kind, total_amount_minor, monthly_amount_minor, installment_count,
       currency, start_month, due_day, payment_source_id, person_id, category_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'loan', 3000, 1000, 3, 'TRY',
       '2026-08', 1, NULL, ?, ?, NULL)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    id,
    options.personId ?? (userId === USER ? "self" : "other-self"),
    categoryId,
  );
}

function seedNote(
  id: string,
  categoryId: string,
  month: string,
  body: string,
  options: { userId?: string; deletedAt?: string | null } = {},
): void {
  const userId = options.userId ?? USER;
  const deletedAt = options.deletedAt ?? null;
  harness.db!.prepare(
    `INSERT INTO cell_notes
      (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
       month, category_id, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    NOW,
    NOW,
    deletedAt,
    deletedAt ? 1 : 0,
    month,
    categoryId,
    body,
  );
}

function row(table: string, id: string): Record<string, unknown> {
  return harness.db!.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>;
}

function snapshotRow(table: Parameters<typeof fromDbShape>[0], id: string): Record<string, unknown> {
  return fromDbShape(table, row(table, id));
}

function outbox(): Record<string, unknown>[] {
  return harness.db!.prepare(
    "SELECT table_name, row_id, payload FROM outbox WHERE table_name != 'settings' ORDER BY id",
  ).all() as Record<string, unknown>[];
}

function clearOutbox(): void {
  harness.db!.exec("DELETE FROM outbox");
}

describe("budget repository persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    harness.beforeTransaction = null;
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
    seedPerson();
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  it("inserts and updates one deterministic budget with exact row and outbox payloads", async () => {
    seedCategory("food");
    const id = await upsertCategoryBudget(USER, {
      month: "2026-08",
      categoryId: "food",
      amountMinor: 50_000,
    });

    expect(id).toBe("det:categoryBudget|budget-user|2026-08|food");
    expect(row("category_budgets", id)).toMatchObject({
      id,
      user_id: USER,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      tombstone_version: 0,
      category_id: "food",
      month: "2026-08",
      amount_minor: 50_000,
    });
    expect(outbox()).toHaveLength(1);
    expect(JSON.parse(String(outbox()[0]!.payload))).toMatchObject({
      id,
      user_id: USER,
      category_id: "food",
      month: "2026-08",
      amount_minor: 50_000,
      deleted_at: null,
    });

    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:01:00.000Z"));
    expect(await upsertCategoryBudget(USER, {
      month: "2026-08",
      categoryId: "food",
      amountMinor: 75_000,
    })).toBe(id);
    expect(row("category_budgets", id)).toMatchObject({
      created_at: NOW,
      updated_at: "2026-08-13T09:01:00.000Z",
      amount_minor: 75_000,
    });
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      `category_budgets:${id}`,
    ]);
    expect(JSON.parse(String(outbox()[0]!.payload)).amount_minor).toBe(75_000);
  });

  it("rejects invalid month and amount values before persistence", async () => {
    seedCategory("food");
    const invalid = [
      [{ month: "2026-13", categoryId: "food", amountMinor: 1 }, "Invalid budget month"],
      [{ month: "2026-08", categoryId: "food", amountMinor: 0 }, "Budget amount must be positive"],
      [{ month: "2026-08", categoryId: "food", amountMinor: -1 }, "Budget amount must be positive"],
      [{ month: "2026-08", categoryId: "food", amountMinor: 1.5 }, "Amount is outside the supported range"],
      [{ month: "2026-08", categoryId: "food", amountMinor: 100_000_000_000_000 }, "Amount is outside the supported range"],
    ] as const;

    for (const [input, message] of invalid) {
      await expect(upsertCategoryBudget(USER, input)).rejects.toThrow(message);
    }
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM category_budgets").get()).toEqual({ n: 0 });
    expect(outbox()).toHaveLength(0);
  });

  it("requires a live owned expense category before deriving a budget id", async () => {
    seedCategory("income", { kind: "income" });
    seedCategory("foreign", { userId: OTHER_USER });
    seedCategory("deleted", { deletedAt: "2026-08-12T09:00:00.000Z" });

    for (const categoryId of ["missing", "income", "foreign", "deleted"]) {
      await expect(upsertCategoryBudget(USER, {
        month: "2026-08",
        categoryId,
        amountMinor: 1,
      })).rejects.toThrow("Budget category must be a live expense category");
    }
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM category_budgets").get()).toEqual({ n: 0 });
    expect(outbox()).toHaveLength(0);
  });

  it("tombstones and restores a budget while preserving ownership and its live parent", async () => {
    seedCategory("food");
    const id = await upsertCategoryBudget(USER, {
      month: "2026-08",
      categoryId: "food",
      amountMinor: 50_000,
    });
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:02:00.000Z"));

    const snapshot = await deleteCategoryBudget(USER, id);
    expect(snapshot).toMatchObject({ id, user_id: USER, deleted_at: null });
    expect(row("category_budgets", id)).toMatchObject({
      deleted_at: "2026-08-13T09:02:00.000Z",
      tombstone_version: 1,
    });
    expect(JSON.parse(String(outbox()[0]!.payload))).toMatchObject({
      id,
      deleted_at: "2026-08-13T09:02:00.000Z",
      tombstone_version: 1,
    });

    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:03:00.000Z"));
    await restoreCategoryBudget(USER, snapshot!);
    expect(row("category_budgets", id)).toMatchObject({
      created_at: NOW,
      deleted_at: null,
      tombstone_version: 1,
    });
    expect(JSON.parse(String(outbox()[0]!.payload))).toMatchObject({
      id,
      deleted_at: null,
      tombstone_version: 1,
    });

    expect(await deleteCategoryBudget(OTHER_USER, id)).toBeNull();
    expect(await deleteCategoryBudget(USER, "missing-budget")).toBeNull();
  });

  it("rejects budget restore when the parent or snapshot ownership is invalid without an outbox write", async () => {
    seedCategory("food");
    seedBudget("budget", "food", { deletedAt: "2026-08-12T09:00:00.000Z" });
    const snapshot = row("category_budgets", "budget");
    harness.db!.prepare("UPDATE categories SET deleted_at = ? WHERE id = 'food'").run("2026-08-12T09:00:00.000Z");

    await expect(restoreCategoryBudget(USER, snapshot)).rejects.toThrow("Cannot edit missing categories row");
    expect(row("category_budgets", "budget").deleted_at).not.toBeNull();
    expect(outbox()).toHaveLength(0);

    harness.db!.prepare("UPDATE categories SET deleted_at = NULL WHERE id = 'food'").run();
    await expect(restoreCategoryBudget(OTHER_USER, snapshot)).rejects.toThrow(
      "Cannot restore category_budgets row from another account",
    );
    expect(row("category_budgets", "budget").deleted_at).not.toBeNull();
    expect(outbox()).toHaveLength(0);
  });

  it("counts only live owned references in every relation table", async () => {
    seedCategory("source");
    seedTransaction("tx", "source");
    seedSubscription("subscription", "source");
    seedIncome("income", "source");
    seedPlan("plan", "source");
    seedNote("note", "source", "2026-08", "Not");
    seedTransaction("deleted-tx", "source", { deletedAt: "2026-08-12T09:00:00.000Z" });
    seedPerson("other-self", OTHER_USER);
    seedCategory("other-source", { userId: OTHER_USER });
    seedTransaction("other-tx", "other-source", { userId: OTHER_USER });

    await expect(categoryReferenceUsage(USER, "source")).resolves.toEqual({
      transactions: 1,
      subscriptions: 1,
      recurringIncomes: 1,
      installmentPlans: 1,
      cellNotes: 1,
      total: 5,
    });
    await expect(categoryReferenceUsage(USER, "unused")).resolves.toEqual({
      transactions: 0,
      subscriptions: 0,
      recurringIncomes: 0,
      installmentPlans: 0,
      cellNotes: 0,
      total: 0,
    });
  });

  it("keeps every reference untouched when replacement is omitted", async () => {
    seedCategory("source");
    seedBudget("budget", "source");
    seedTransaction("tx", "source");
    seedPlan("plan", "source");
    seedNote("note", "source", "2026-08", "Not");

    const snapshot = await deleteCategoryWithBudgets(USER, "source");

    expect(snapshot).toMatchObject({ reassigned: [], created: [] });
    expect(row("categories", "source")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("category_budgets", "budget")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("transactions", "tx")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("installment_plans", "plan")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("cell_notes", "note")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      "categories:source",
      "category_budgets:budget",
    ]);
  });

  it("explicit null leaves transactions, clears nullable plans, and tombstones cell notes", async () => {
    seedCategory("source");
    seedBudget("budget", "source");
    seedTransaction("tx", "source");
    seedPlan("plan", "source");
    seedNote("note", "source", "2026-08", "Not");

    const snapshot = await deleteCategoryWithBudgets(USER, "source", null);

    expect(snapshot?.reassigned?.map(({ table }) => table)).toEqual(["installment_plans", "cell_notes"]);
    expect(row("transactions", "tx")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("installment_plans", "plan")).toMatchObject({ category_id: null, deleted_at: null });
    expect(row("cell_notes", "note")).toMatchObject({
      category_id: "source",
      deleted_at: NOW,
      tombstone_version: 1,
    });
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      "categories:source",
      "category_budgets:budget",
      "installment_plans:plan",
      "cell_notes:note",
    ]);
  });

  it("rejects explicit null separately for each rule type, even beside a nullable reference", async () => {
    seedCategory("subscription-source");
    seedBudget("subscription-budget", "subscription-source");
    seedSubscription("subscription", "subscription-source");
    seedPlan("subscription-plan", "subscription-source");
    seedCategory("income-source");
    seedBudget("income-budget", "income-source");
    seedIncome("income", "income-source");
    seedPlan("income-plan", "income-source");

    for (const source of ["subscription-source", "income-source"]) {
      await expect(deleteCategoryWithBudgets(USER, source, null)).rejects.toThrow(
        "A replacement category is required for rules",
      );
      expect(row("categories", source).deleted_at).toBeNull();
    }
    expect(row("category_budgets", "subscription-budget").deleted_at).toBeNull();
    expect(row("category_budgets", "income-budget").deleted_at).toBeNull();
    expect(row("subscriptions", "subscription").category_id).toBe("subscription-source");
    expect(row("recurring_incomes", "income").category_id).toBe("income-source");
    expect(row("installment_plans", "subscription-plan").category_id).toBe("subscription-source");
    expect(row("installment_plans", "income-plan").category_id).toBe("income-source");
    expect(outbox()).toHaveLength(0);
  });

  it("moves all references, generates a natural note id, and merges a same-month target note", async () => {
    seedCategory("source");
    seedCategory("target");
    seedBudget("budget", "source");
    seedTransaction("tx", "source");
    seedSubscription("subscription", "source");
    seedIncome("income", "source");
    seedPlan("plan", "source");
    seedNote("source-new", "source", "2026-08", "Ağustos kaynak");
    seedNote("source-merge", "source", "2026-09", "Eylül kaynak");
    seedNote("target-merge", "target", "2026-09", "Eylül hedef");

    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");
    const generatedId = "det:cellNote|budget-user|2026-08|target";

    for (const [table, id] of [
      ["transactions", "tx"],
      ["subscriptions", "subscription"],
      ["recurring_incomes", "income"],
      ["installment_plans", "plan"],
    ] as const) {
      expect(row(table, id).category_id).toBe("target");
    }
    expect(row("cell_notes", "source-new")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(row("cell_notes", generatedId)).toMatchObject({
      category_id: "target",
      month: "2026-08",
      body: "Ağustos kaynak",
      deleted_at: null,
      tombstone_version: 0,
    });
    expect(row("cell_notes", "target-merge")).toMatchObject({ body: "Eylül hedef\n\nEylül kaynak" });
    expect(row("cell_notes", "source-merge")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
    expect(snapshot?.created).toEqual([
      { table: "cell_notes", row: expect.objectContaining({ id: generatedId, categoryId: "target" }) },
    ]);
    expect(snapshot?.reassigned).toEqual(expect.arrayContaining([
      { table: "cell_notes", row: expect.objectContaining({ id: "target-merge", body: "Eylül hedef" }) },
      { table: "cell_notes", row: expect.objectContaining({ id: "source-new" }) },
      { table: "cell_notes", row: expect.objectContaining({ id: "source-merge" }) },
    ]));
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      "categories:source",
      "category_budgets:budget",
      "transactions:tx",
      "subscriptions:subscription",
      "recurring_incomes:income",
      "installment_plans:plan",
      "cell_notes:source-new",
      `cell_notes:${generatedId}`,
      "cell_notes:target-merge",
      "cell_notes:source-merge",
    ]);
  });

  it("keeps cross-table same-id references distinct in the undo snapshot", async () => {
    seedCategory("source");
    seedCategory("target");
    seedPlan("shared-id", "source");
    seedNote("source-note", "source", "2026-08", "Kaynak");
    seedNote("shared-id", "target", "2026-08", "Hedef");

    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");

    expect(snapshot?.reassigned).toEqual(expect.arrayContaining([
      { table: "cell_notes", row: expect.objectContaining({ id: "shared-id", body: "Hedef" }) },
      { table: "installment_plans", row: expect.objectContaining({ id: "shared-id", categoryId: "source" }) },
    ]));
    expect(row("installment_plans", "shared-id").category_id).toBe("target");
    expect(row("cell_notes", "shared-id").body).toBe("Hedef\n\nKaynak");
  });

  it("allows exactly 1000 note characters and rejects 1001 without changing rows or outbox", async () => {
    seedCategory("source");
    seedCategory("target");
    seedNote("source-note", "source", "2026-08", "s".repeat(498));
    seedNote("target-note", "target", "2026-08", "t".repeat(500));

    await deleteCategoryWithBudgets(USER, "source", "target");
    expect(String(row("cell_notes", "target-note").body)).toHaveLength(1000);

    harness.db!.exec("DELETE FROM outbox");
    seedCategory("too-long-source");
    seedCategory("too-long-target");
    seedNote("too-long-source-note", "too-long-source", "2026-09", "s".repeat(499));
    seedNote("too-long-target-note", "too-long-target", "2026-09", "t".repeat(500));
    const sourceBefore = row("categories", "too-long-source");
    const sourceNoteBefore = row("cell_notes", "too-long-source-note");
    const targetNoteBefore = row("cell_notes", "too-long-target-note");

    await expect(
      deleteCategoryWithBudgets(USER, "too-long-source", "too-long-target"),
    ).rejects.toThrow("Category notes are too long to merge");
    expect(row("categories", "too-long-source")).toEqual(sourceBefore);
    expect(row("cell_notes", "too-long-source-note")).toEqual(sourceNoteBefore);
    expect(row("cell_notes", "too-long-target-note")).toEqual(targetNoteBefore);
    expect(outbox()).toHaveLength(0);
  });

  it("rejects self, missing, foreign, kind, and transfer replacement mismatches without writes", async () => {
    seedCategory("source");
    seedCategory("income", { kind: "income" });
    seedCategory("transfer", { isTransfer: true });
    seedCategory("foreign", { userId: OTHER_USER });
    seedCategory("deleted", { deletedAt: "2026-08-12T09:00:00.000Z" });
    const attempts = [
      ["source", "Category cannot be reassigned to itself"],
      ["missing", "Replacement category does not exist"],
      ["foreign", "Replacement category does not exist"],
      ["deleted", "Replacement category does not exist"],
      ["income", "Replacement category does not match the deleted category"],
      ["transfer", "Replacement category does not match the deleted category"],
    ] as const;

    for (const [replacementId, message] of attempts) {
      await expect(deleteCategoryWithBudgets(USER, "source", replacementId)).rejects.toThrow(message);
    }
    expect(await deleteCategoryWithBudgets(USER, "foreign", null)).toBeNull();
    expect(row("categories", "source").deleted_at).toBeNull();
    expect(outbox()).toHaveLength(0);
  });

  it("revalidates the source category inside the atomic write transaction", async () => {
    seedCategory("source");
    seedBudget("budget", "source");
    harness.beforeTransaction = () => {
      harness.db!.prepare("UPDATE categories SET deleted_at = ? WHERE id = 'source'").run(NOW);
    };

    await expect(deleteCategoryWithBudgets(USER, "source")).rejects.toThrow(
      "Cannot edit missing categories row",
    );
    expect(row("categories", "source").deleted_at).toBeNull();
    expect(row("category_budgets", "budget").deleted_at).toBeNull();
    expect(outbox()).toHaveLength(0);
  });

  it("revalidates the replacement category inside the atomic write transaction", async () => {
    seedCategory("source");
    seedCategory("target");
    harness.beforeTransaction = () => {
      harness.db!.prepare("UPDATE categories SET deleted_at = ? WHERE id = 'target'").run(NOW);
    };

    await expect(deleteCategoryWithBudgets(USER, "source", "target")).rejects.toThrow(
      "Cannot edit missing categories row",
    );
    expect(row("categories", "source").deleted_at).toBeNull();
    expect(row("categories", "target").deleted_at).toBeNull();
    expect(outbox()).toHaveLength(0);
  });

  it("revalidates every moved reference inside the atomic write transaction", async () => {
    seedCategory("source");
    seedCategory("target");
    seedPlan("plan", "source");
    harness.beforeTransaction = () => {
      harness.db!.prepare("UPDATE installment_plans SET deleted_at = ? WHERE id = 'plan'").run(NOW);
    };

    await expect(deleteCategoryWithBudgets(USER, "source", "target")).rejects.toThrow(
      "Cannot edit missing installment_plans row",
    );
    expect(row("categories", "source").deleted_at).toBeNull();
    expect(row("installment_plans", "plan")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(outbox()).toHaveLength(0);
  });

  it("restores the simple no-reassignment snapshot with exact outbox rows", async () => {
    seedCategory("source");
    seedBudget("budget", "source");
    const snapshot = await deleteCategoryWithBudgets(USER, "source");
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:05:00.000Z"));

    await restoreCategoryWithBudgets(USER, snapshot!);

    expect(row("categories", "source")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(row("category_budgets", "budget")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      "categories:source",
      "category_budgets:budget",
    ]);
  });

  it("undoes merged and generated notes, restores moved rows, and re-tombstones the created note", async () => {
    seedCategory("source");
    seedCategory("target");
    seedBudget("budget", "source");
    seedPlan("plan", "source");
    seedNote("source-new", "source", "2026-08", "Yeni");
    seedNote("source-merge", "source", "2026-09", "Kaynak");
    seedNote("target-merge", "target", "2026-09", "Hedef");
    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");
    const generatedId = "det:cellNote|budget-user|2026-08|target";
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:06:00.000Z"));

    await restoreCategoryWithBudgets(USER, snapshot!);

    expect(row("categories", "source")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(row("category_budgets", "budget")).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(row("installment_plans", "plan")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("cell_notes", "source-new")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("cell_notes", "source-merge")).toMatchObject({ category_id: "source", deleted_at: null });
    expect(row("cell_notes", "target-merge")).toMatchObject({ body: "Hedef", deleted_at: null });
    expect(row("cell_notes", generatedId)).toMatchObject({
      deleted_at: "2026-08-13T09:06:00.000Z",
      tombstone_version: 1,
    });
    expect(outbox().map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      "categories:source",
      "category_budgets:budget",
      "cell_notes:target-merge",
      "installment_plans:plan",
      "cell_notes:source-new",
      "cell_notes:source-merge",
      `cell_notes:${generatedId}`,
    ]);
  });

  it("validates every undo target state before restoring any row", async () => {
    seedCategory("source");
    seedCategory("target");
    seedBudget("budget", "source");
    seedPlan("plan", "source");
    seedNote("source-note", "source", "2026-08", "Yeni");
    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");
    const generatedId = "det:cellNote|budget-user|2026-08|target";
    clearOutbox();
    harness.db!.prepare("UPDATE cell_notes SET deleted_at = ? WHERE id = ?").run(
      "2026-08-13T09:07:00.000Z",
      generatedId,
    );

    await expect(restoreCategoryWithBudgets(USER, snapshot!)).rejects.toThrow(
      "Cannot remove reassigned cell_notes row from another account",
    );
    expect(row("categories", "source").deleted_at).toBe(NOW);
    expect(row("category_budgets", "budget").deleted_at).toBe(NOW);
    expect(row("installment_plans", "plan").category_id).toBe("target");
    expect(outbox()).toHaveLength(0);

    harness.db!.prepare("UPDATE cell_notes SET deleted_at = NULL WHERE id = ?").run(generatedId);
    harness.db!.prepare("DELETE FROM installment_plans WHERE id = 'plan'").run();
    await expect(restoreCategoryWithBudgets(USER, snapshot!)).rejects.toThrow(
      "Cannot restore installment_plans row from another account",
    );
    expect(row("categories", "source").deleted_at).toBe(NOW);
    expect(outbox()).toHaveLength(0);
  });

  it("rejects a reassigned undo row whose owner changed after deletion", async () => {
    seedCategory("source");
    seedCategory("target");
    seedPlan("plan", "source");
    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");
    clearOutbox();
    harness.db!.prepare("UPDATE installment_plans SET user_id = ? WHERE id = 'plan'").run(OTHER_USER);

    await expect(restoreCategoryWithBudgets(USER, snapshot!)).rejects.toThrow(
      "Cannot restore installment_plans row from another account",
    );
    expect(row("categories", "source").deleted_at).toBe(NOW);
    expect(row("installment_plans", "plan")).toMatchObject({ user_id: OTHER_USER, category_id: "target" });
    expect(outbox()).toHaveLength(0);
  });

  it("rejects a created undo row that is missing or whose owner changed", async () => {
    seedCategory("source");
    seedCategory("target");
    seedNote("source-note", "source", "2026-08", "Yeni");
    const snapshot = await deleteCategoryWithBudgets(USER, "source", "target");
    const generatedId = "det:cellNote|budget-user|2026-08|target";
    clearOutbox();
    harness.db!.prepare("UPDATE cell_notes SET user_id = ? WHERE id = ?").run(OTHER_USER, generatedId);

    await expect(restoreCategoryWithBudgets(USER, snapshot!)).rejects.toThrow(
      "Cannot remove reassigned cell_notes row from another account",
    );
    expect(row("categories", "source").deleted_at).toBe(NOW);
    expect(outbox()).toHaveLength(0);

    harness.db!.prepare("DELETE FROM cell_notes WHERE id = ?").run(generatedId);
    await expect(restoreCategoryWithBudgets(USER, snapshot!)).rejects.toThrow(
      "Cannot remove reassigned cell_notes row from another account",
    );
    expect(row("categories", "source").deleted_at).toBe(NOW);
    expect(outbox()).toHaveLength(0);
  });

  it("accepts legacy reassignment snapshots that omit created rows", async () => {
    seedCategory("source", { deletedAt: NOW });
    seedBudget("budget", "source", { deletedAt: NOW });
    seedPlan("plan", "target");
    const snapshot = {
      category: snapshotRow("categories", "source"),
      budgets: [snapshotRow("category_budgets", "budget")],
      reassigned: [{
        table: "installment_plans" as const,
        row: { ...snapshotRow("installment_plans", "plan"), categoryId: "source" },
      }],
      created: [],
    };

    await restoreCategoryWithBudgets(USER, snapshot);

    expect(row("categories", "source").deleted_at).toBeNull();
    expect(row("category_budgets", "budget").deleted_at).toBeNull();
    expect(row("installment_plans", "plan").category_id).toBe("source");
  });

  it("accepts created-only undo snapshots and tombstones the created live row", async () => {
    seedCategory("source", { deletedAt: NOW });
    seedBudget("budget", "source", { deletedAt: NOW });
    seedNote("created-note", "source", "2026-08", "Oluşturulan");
    const snapshot = {
      category: snapshotRow("categories", "source"),
      budgets: [snapshotRow("category_budgets", "budget")],
      reassigned: [],
      created: [{ table: "cell_notes" as const, row: snapshotRow("cell_notes", "created-note") }],
    };

    await restoreCategoryWithBudgets(USER, snapshot);

    expect(row("categories", "source").deleted_at).toBeNull();
    expect(row("category_budgets", "budget").deleted_at).toBeNull();
    expect(row("cell_notes", "created-note")).toMatchObject({ deleted_at: NOW, tombstone_version: 1 });
  });

  it("rolls back category, budget, and outbox changes when persistence fails mid-batch", async () => {
    seedCategory("source");
    seedBudget("budget", "source");
    harness.db!.exec(
      `CREATE TRIGGER fail_budget_outbox
       BEFORE INSERT ON outbox
       WHEN NEW.table_name = 'category_budgets'
       BEGIN SELECT RAISE(ABORT, 'forced budget outbox failure'); END`,
    );

    await expect(deleteCategoryWithBudgets(USER, "source")).rejects.toThrow(
      "forced budget outbox failure",
    );
    expect(row("categories", "source")).toMatchObject({ deleted_at: null, tombstone_version: 0 });
    expect(row("category_budgets", "budget")).toMatchObject({ deleted_at: null, tombstone_version: 0 });
    expect(outbox()).toHaveLength(0);
  });
});
