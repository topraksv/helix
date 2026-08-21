import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  db: null as DatabaseSync | null,
  nextId: 0,
}));

vi.mock("../src/db/client", async () => {
  const { sqliteClientMock } = await import("./helpers");
  return sqliteClientMock(() => harness.db!);
});

vi.mock("../src/db/ids", () => ({
  newId: () => `category-${String(++harness.nextId).padStart(2, "0")}`,
  deterministicId: async (key: string) => `det:${key}`,
  naturalKeys: {
    setting: (userId: string, key: string) => `setting:${userId}:${key}`,
    selfPerson: (userId: string) => `person-self:${userId}`,
    seedCategory: (userId: string, name: string) =>
      `category-seed:${userId}:${name.toLocaleLowerCase("tr-TR")}`,
    categoryBudget: (userId: string, month: string, categoryId: string) =>
      `budget:${userId}:${month}:${categoryId}`,
    cellNote: (userId: string, month: string, categoryId: string) =>
      `cellnote:${userId}:${month}:${categoryId}`,
    investmentProfile: (userId: string) => `investment-profile:${userId}`,
  },
}));

vi.mock("../src/sync/engine", () => ({ scheduleSync: vi.fn() }));
vi.mock("../src/services/fx-fetch", () => ({ lookupRate: vi.fn() }));
vi.mock("../src/services/markets", () => ({ marketSellRateTry: vi.fn() }));

import { createPerson } from "../src/data/repo/accounts";
import {
  addTemplateCategories,
  createCategory,
  reorderCategoryGroup,
  updateCategory,
} from "../src/data/repo/categories";
import {
  deleteCategoryWithBudgets,
  restoreCategoryWithBudgets,
  upsertCategoryBudget,
} from "../src/data/repo/budgets";
import { saveCellNote } from "../src/data/repo/cell-notes";
import {
  addInvestmentOperation,
  saveInvestmentProduct,
  setupInvestments,
} from "../src/data/repo/investments";
import { addTransaction } from "../src/data/repo/transactions";
import { fromDbShape } from "../src/db/mutations";
import { migrationStatements } from "./helpers";

const USER = "category-user";
const OTHER_USER = "other-user";

type CategoryInputRow = Parameters<typeof updateCategory>[1];

function rawCategory(id: string): Record<string, unknown> {
  return harness.db!.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Record<string, unknown>;
}

function categoryInputRow(id: string): CategoryInputRow {
  const row = fromDbShape("categories", rawCategory(id));
  return {
    ...row,
    isColumn: Boolean(row.isColumn),
    isTransfer: Boolean(row.isTransfer),
  } as CategoryInputRow;
}

function categoryOutbox(): Record<string, unknown>[] {
  return harness.db!.prepare(
    "SELECT row_id, payload FROM outbox WHERE table_name = 'categories' ORDER BY id",
  ).all() as Record<string, unknown>[];
}

function clearOutbox(): void {
  harness.db!.exec("DELETE FROM outbox");
}

describe("category repository persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T09:00:00.000Z"));
    harness.nextId = 0;
    harness.db = new DatabaseSync(":memory:");
    for (const statement of migrationStatements) harness.db.exec(statement);
  });

  afterEach(() => {
    harness.db?.close();
    harness.db = null;
    vi.useRealTimers();
  });

  it("persists trimmed names, suggested icons, column defaults, transfer semantics and outbox payloads", async () => {
    const expenseId = await createCategory(USER, {
      name: "  Market  ",
      kind: "expense",
      isTransfer: true,
      sortOrder: 7,
    });
    const incomeId = await createCategory(USER, {
      name: "Maaş",
      kind: "income",
      isTransfer: false,
      sortOrder: 11,
    });

    expect(expenseId).toBe("category-01");
    expect(incomeId).toBe("category-02");
    expect(rawCategory(expenseId)).toMatchObject({
      id: expenseId,
      user_id: USER,
      name: "Market",
      kind: "expense",
      icon: "🛒",
      color: null,
      sort_order: 7,
      is_column: 1,
      is_transfer: 1,
      deleted_at: null,
      tombstone_version: 0,
    });
    expect(rawCategory(incomeId)).toMatchObject({
      id: incomeId,
      user_id: USER,
      name: "Maaş",
      kind: "income",
      icon: "💰",
      color: null,
      sort_order: 11,
      is_column: 1,
      is_transfer: 0,
      deleted_at: null,
      tombstone_version: 0,
    });

    const outbox = categoryOutbox();
    expect(outbox.map((row) => row.row_id)).toEqual([expenseId, incomeId]);
    expect(outbox.map((row) => JSON.parse(String(row.payload)))).toEqual([
      expect.objectContaining({
        id: expenseId,
        user_id: USER,
        name: "Market",
        kind: "expense",
        icon: "🛒",
        color: null,
        sort_order: 7,
        is_column: true,
        is_transfer: true,
        deleted_at: null,
      }),
      expect.objectContaining({
        id: incomeId,
        user_id: USER,
        name: "Maaş",
        kind: "income",
        icon: "💰",
        color: null,
        sort_order: 11,
        is_column: true,
        is_transfer: false,
        deleted_at: null,
      }),
    ]);
  });

  it("rejects every invalid classification before any row or outbox write", async () => {
    const cases = [
      {
        input: { name: "   ", kind: "expense", isTransfer: false, sortOrder: 0 },
        message: "Category name is required",
      },
      {
        input: { name: "x".repeat(121), kind: "expense", isTransfer: false, sortOrder: 0 },
        message: "text input exceeds its maximum length",
      },
      {
        input: { name: "Diğer", kind: "other", isTransfer: false, sortOrder: 0 },
        message: "Invalid category kind",
      },
      {
        input: { name: "Diğer", kind: "expense", isTransfer: "yes", sortOrder: 0 },
        message: "Invalid category transfer flag",
      },
      {
        input: { name: "Maaş", kind: "income", isTransfer: true, sortOrder: 0 },
        message: "Income category cannot be a transfer",
      },
    ];

    for (const { input, message } of cases) {
      await expect(createCategory(USER, input as Parameters<typeof createCategory>[1])).rejects.toThrow(message);
    }
    const invalidStoredRow = {
      id: "missing-category",
      userId: USER,
      createdAt: "2026-08-13T09:00:00.000Z",
      updatedAt: "2026-08-13T09:00:00.000Z",
      deletedAt: null,
      tombstoneVersion: 0,
      name: "Gelir",
      kind: "income" as const,
      icon: null,
      color: null,
      sortOrder: 0,
      isColumn: true,
      isTransfer: false,
    };
    await expect(updateCategory(USER, invalidStoredRow, { isTransfer: true })).rejects.toThrow(
      "Income category cannot be a transfer",
    );

    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 0 });
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("does not persist an ordinary expense as a transfer", async () => {
    const categoryId = await createCategory(USER, {
      name: "Kira",
      kind: "expense",
      isTransfer: false,
      sortOrder: 0,
    });

    expect(rawCategory(categoryId).is_transfer).toBe(0);
    expect(JSON.parse(String(categoryOutbox()[0]!.payload)).is_transfer).toBe(false);
  });

  it("updates only a live owned row, preserves untouched fields and validates the investment graph", async () => {
    const categoryId = await createCategory(USER, {
      name: "Yatırım",
      kind: "expense",
      isTransfer: true,
      sortOrder: 3,
    });
    const original = rawCategory(categoryId);
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:01:00.000Z"));

    await updateCategory(USER, categoryInputRow(categoryId), {
      name: "  Birikim  ",
      isColumn: false,
      isTransfer: false,
    });
    expect(rawCategory(categoryId)).toMatchObject({
      id: categoryId,
      user_id: USER,
      created_at: original.created_at,
      updated_at: "2026-08-13T09:01:00.000Z",
      name: "Birikim",
      kind: "expense",
      icon: "📈",
      color: null,
      sort_order: 3,
      is_column: 0,
      is_transfer: 0,
      deleted_at: null,
    });
    expect(categoryOutbox()).toHaveLength(1);

    clearOutbox();
    const beforeForeignAttempt = rawCategory(categoryId);
    await expect(
      updateCategory(OTHER_USER, categoryInputRow(categoryId), { name: "Başka hesap" }),
    ).rejects.toThrow("Cannot edit missing categories row");
    expect(rawCategory(categoryId)).toEqual(beforeForeignAttempt);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    harness.db!.prepare("UPDATE categories SET deleted_at = ? WHERE id = ?").run(
      "2026-08-13T09:02:00.000Z",
      categoryId,
    );
    await expect(
      updateCategory(USER, categoryInputRow(categoryId), { name: "Diriltme" }),
    ).rejects.toThrow("Cannot edit missing categories row");
    expect(rawCategory(categoryId).name).toBe("Birikim");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    harness.db!.prepare("UPDATE categories SET deleted_at = NULL WHERE id = ?").run(categoryId);
    await updateCategory(USER, categoryInputRow(categoryId), { isTransfer: true });
    const personId = await createPerson(USER, "Ben");
    await setupInvestments(USER, { startedOn: "2026-01-01", openingCashMinor: 0 });
    await addTransaction(USER, {
      type: "transfer",
      amountMinor: 10_000,
      currency: "TRY",
      fxRate: null,
      amountTryMinor: 10_000,
      effectiveDate: "2026-01-02",
      categoryId,
      paymentSourceId: null,
      personId,
      note: null,
    });
    const productId = await saveInvestmentProduct(USER, { assetType: "equity", name: "Fon" });
    await addInvestmentOperation(USER, {
      productId,
      kind: "buy",
      operationDate: "2026-01-03",
      quantity: "1",
      unitPriceMinor: 10_000,
      totalMinor: 10_000,
    });
    clearOutbox();

    await expect(
      updateCategory(USER, categoryInputRow(categoryId), { isTransfer: false }),
    ).rejects.toMatchObject({ name: "InvestmentDomainError", code: "insufficient_cash" });
    expect(rawCategory(categoryId).is_transfer).toBe(1);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("reorders only the requested group, preserves its slots and no-ops for an empty write set", async () => {
    const expenseA = await createCategory(USER, { name: "Market", kind: "expense", isTransfer: false, sortOrder: 9 });
    const expenseB = await createCategory(USER, { name: "Kira", kind: "expense", isTransfer: false, sortOrder: 4 });
    const expenseC = await createCategory(USER, { name: "Sağlık", kind: "expense", isTransfer: false, sortOrder: 7 });
    const income = await createCategory(USER, { name: "Maaş", kind: "income", isTransfer: false, sortOrder: 2 });
    const inputRows = [expenseA, expenseB, expenseC, income].map(categoryInputRow);
    clearOutbox();

    await reorderCategoryGroup(USER, inputRows, "expense", [
      expenseC,
      expenseA,
      expenseB,
      income,
      "unknown-category",
    ]);

    const stored = harness.db!.prepare(
      "SELECT id, name, icon, sort_order FROM categories ORDER BY id",
    ).all() as Record<string, unknown>[];
    expect(stored).toEqual([
      { id: expenseA, name: "Market", icon: "🛒", sort_order: 4 },
      { id: expenseB, name: "Kira", icon: "🏠", sort_order: 7 },
      { id: expenseC, name: "Sağlık", icon: "🩺", sort_order: 9 },
      { id: income, name: "Maaş", icon: "💰", sort_order: 2 },
    ]);
    expect(categoryOutbox().map((row) => row.row_id)).toEqual([expenseC, expenseA, expenseB]);

    clearOutbox();
    await reorderCategoryGroup(USER, inputRows, "expense", [income, "unknown-category"]);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    await reorderCategoryGroup(USER, inputRows, "expense", [
      income,
      "unknown-category",
      "another-unknown-category",
      expenseA,
    ]);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("rejects a reorder containing a foreign or tombstoned category atomically", async () => {
    const ownedId = await createCategory(USER, {
      name: "Market",
      kind: "expense",
      isTransfer: false,
      sortOrder: 5,
    });
    harness.db!.prepare(
      `INSERT INTO categories
        (id, user_id, created_at, updated_at, deleted_at, tombstone_version,
         name, kind, icon, color, sort_order, is_column, is_transfer)
       VALUES (?, ?, ?, ?, NULL, 0, ?, 'expense', NULL, NULL, 30, 1, 0)`,
    ).run("foreign-category", OTHER_USER, "2026-08-13T09:00:00.000Z", "2026-08-13T09:00:00.000Z", "Yabancı");
    clearOutbox();
    const ownedBefore = rawCategory(ownedId);

    await expect(
      reorderCategoryGroup(
        USER,
        [categoryInputRow(ownedId), categoryInputRow("foreign-category")],
        "expense",
        ["foreign-category", ownedId],
      ),
    ).rejects.toThrow("Cannot edit missing categories row");
    expect(rawCategory(ownedId)).toEqual(ownedBefore);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    harness.db!.prepare("UPDATE categories SET deleted_at = ? WHERE id = ?").run(
      "2026-08-13T09:03:00.000Z",
      ownedId,
    );
    await expect(
      reorderCategoryGroup(USER, [categoryInputRow(ownedId)], "expense", [ownedId]),
    ).rejects.toThrow("Cannot edit missing categories row");
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("upserts templates with deterministic ids and exact supplied fields without duplicating rows", async () => {
    await addTemplateCategories(USER, [], 20);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM outbox").get()).toEqual({ n: 0 });

    const templates = [
      { name: "Yatırım", kind: "expense" as const, icon: "📊", isColumn: true, isTransfer: true },
      { name: "Ek Gelir", kind: "income" as const, isColumn: false, isTransfer: true },
      { name: "Faturalar", kind: "expense" as const, isColumn: true },
    ];
    await addTemplateCategories(USER, templates, 20);
    const firstRows = harness.db!.prepare(
      "SELECT id, created_at, name, kind, icon, sort_order, is_column, is_transfer FROM categories ORDER BY sort_order",
    ).all() as Record<string, unknown>[];
    expect(firstRows).toEqual([
      {
        id: `det:category-seed:${USER}:yatırım`,
        created_at: "2026-08-13T09:00:00.000Z",
        name: "Yatırım",
        kind: "expense",
        icon: "📊",
        sort_order: 20,
        is_column: 1,
        is_transfer: 1,
      },
      {
        id: `det:category-seed:${USER}:ek gelir`,
        created_at: "2026-08-13T09:00:00.000Z",
        name: "Ek Gelir",
        kind: "income",
        icon: null,
        sort_order: 21,
        is_column: 0,
        is_transfer: 0,
      },
      {
        id: `det:category-seed:${USER}:faturalar`,
        created_at: "2026-08-13T09:00:00.000Z",
        name: "Faturalar",
        kind: "expense",
        icon: null,
        sort_order: 22,
        is_column: 1,
        is_transfer: 0,
      },
    ]);

    vi.setSystemTime(new Date("2026-08-13T09:05:00.000Z"));
    await addTemplateCategories(USER, templates, 20);
    expect(harness.db!.prepare("SELECT COUNT(*) AS n FROM categories").get()).toEqual({ n: 3 });
    expect(harness.db!.prepare("SELECT id, created_at FROM categories ORDER BY sort_order").all()).toEqual(
      firstRows.map(({ id, created_at }) => ({ id, created_at })),
    );
    expect(categoryOutbox()).toHaveLength(6);
  });

  it("reassigns a cell note, tombstones the category and budget, and restores the whole lifecycle with outbox events", async () => {
    const sourceId = await createCategory(USER, {
      name: "Market",
      kind: "expense",
      isTransfer: false,
      sortOrder: 0,
    });
    const targetId = await createCategory(USER, {
      name: "Gıda",
      kind: "expense",
      isTransfer: false,
      sortOrder: 1,
    });
    const budgetId = await upsertCategoryBudget(USER, {
      month: "2026-08",
      categoryId: sourceId,
      amountMinor: 50_000,
    });
    await saveCellNote(USER, "2026-08", sourceId, "Kaynak notu");
    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:10:00.000Z"));

    const snapshot = await deleteCategoryWithBudgets(USER, sourceId, targetId);
    expect(snapshot).not.toBeNull();
    expect(rawCategory(sourceId)).toMatchObject({
      deleted_at: "2026-08-13T09:10:00.000Z",
      tombstone_version: 1,
    });
    expect(harness.db!.prepare("SELECT deleted_at, tombstone_version FROM category_budgets WHERE id = ?").get(budgetId)).toEqual({
      deleted_at: "2026-08-13T09:10:00.000Z",
      tombstone_version: 1,
    });
    const notesAfterDelete = harness.db!.prepare(
      "SELECT category_id, body, deleted_at, tombstone_version FROM cell_notes ORDER BY id",
    ).all() as Record<string, unknown>[];
    expect(notesAfterDelete).toEqual([
      {
        category_id: sourceId,
        body: "Kaynak notu",
        deleted_at: "2026-08-13T09:10:00.000Z",
        tombstone_version: 1,
      },
      {
        category_id: targetId,
        body: "Kaynak notu",
        deleted_at: null,
        tombstone_version: 0,
      },
    ]);
    const deleteEvents = harness.db!.prepare(
      "SELECT table_name, row_id, payload FROM outbox WHERE table_name != 'settings' ORDER BY id",
    ).all() as Record<string, unknown>[];
    expect(deleteEvents.map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      `categories:${sourceId}`,
      `category_budgets:${budgetId}`,
      `cell_notes:det:cellnote:${USER}:2026-08:${sourceId}`,
      `cell_notes:det:cellnote:${USER}:2026-08:${targetId}`,
    ]);
    expect(JSON.parse(String(deleteEvents[0]!.payload)).deleted_at).toBe("2026-08-13T09:10:00.000Z");

    clearOutbox();
    vi.setSystemTime(new Date("2026-08-13T09:11:00.000Z"));
    await restoreCategoryWithBudgets(USER, snapshot!);
    expect(rawCategory(sourceId)).toMatchObject({ deleted_at: null, tombstone_version: 1 });
    expect(harness.db!.prepare("SELECT deleted_at, tombstone_version FROM category_budgets WHERE id = ?").get(budgetId)).toEqual({
      deleted_at: null,
      tombstone_version: 1,
    });
    expect(harness.db!.prepare(
      "SELECT category_id, deleted_at, tombstone_version FROM cell_notes ORDER BY id",
    ).all()).toEqual([
      { category_id: sourceId, deleted_at: null, tombstone_version: 1 },
      { category_id: targetId, deleted_at: "2026-08-13T09:11:00.000Z", tombstone_version: 1 },
    ]);
    const restoreEvents = harness.db!.prepare(
      "SELECT table_name, row_id FROM outbox WHERE table_name != 'settings' ORDER BY id",
    ).all() as Record<string, unknown>[];
    expect(restoreEvents.map(({ table_name, row_id }) => `${table_name}:${row_id}`)).toEqual([
      `categories:${sourceId}`,
      `category_budgets:${budgetId}`,
      `cell_notes:det:cellnote:${USER}:2026-08:${sourceId}`,
      `cell_notes:det:cellnote:${USER}:2026-08:${targetId}`,
    ]);
  });
});
