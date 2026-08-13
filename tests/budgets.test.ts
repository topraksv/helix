import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetProgress } from "../src/domain/budgets";
import type { TxLike } from "../src/domain/types";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  assertLiveRow: vi.fn(),
  writeRows: vi.fn(),
  restoreRow: vi.fn(),
  restoreRows: vi.fn(),
  writeRowsValidated: vi.fn(),
}));
vi.mock("../src/db/client", () => ({ getSqliteAsync: dependencies.getSqliteAsync }));
vi.mock("../src/db/ids", () => ({
  deterministicId: vi.fn(async (key: string) => `id:${key}`),
  naturalKeys: {
    categoryBudget: (...parts: unknown[]) => parts.join("|"),
    cellNote: (...parts: unknown[]) => parts.join("|"),
  },
}));
vi.mock("../src/db/mutations", () => ({
  assertLiveRow: dependencies.assertLiveRow,
  fromDbShape: (_table: string, row: Record<string, unknown>) => row,
  nowIso: () => "2026-07-18T00:00:00.000Z",
  softDelete: vi.fn(),
  writeRows: dependencies.writeRows,
  restoreRow: dependencies.restoreRow,
  restoreRows: dependencies.restoreRows,
  writeRowsValidated: dependencies.writeRowsValidated,
}));

import { categoryReferenceUsage, deleteCategoryWithBudgets, restoreCategoryBudget, restoreCategoryWithBudgets, upsertCategoryBudget } from "../src/data/repo/budgets";

const tx = (id: string, categoryId: string, amountTryMinor: number, effectiveDate = "2026-07-10"): TxLike => ({
  id, type: "expense", amountTryMinor, effectiveDate, status: "realized", categoryId,
  categoryKind: "expense", paymentSourceId: null, personIsSelf: true,
  installmentPlanId: null, subscriptionId: null, isAggregate: false,
});

describe("category deletion cascades to its budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.assertLiveRow.mockResolvedValue(undefined);
    dependencies.restoreRows.mockImplementation(async (userId: string, writes: unknown[]) => {
      dependencies.writeRows(userId, writes);
    });
    dependencies.writeRowsValidated.mockImplementation(async (
      userId: string,
      writes: unknown[],
      validate: (sqlite: unknown) => Promise<void>,
    ) => {
      await validate(await dependencies.getSqliteAsync());
      dependencies.writeRows(userId, writes);
    });
  });

  it("tombstones the category and every live budget in one atomic write", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: vi.fn(async () => ({ id: "cat-1", name: "Market" })),
      getAllAsync: vi.fn(async () => [
        { id: "b-1", category_id: "cat-1", month: "2026-07" },
        { id: "b-2", category_id: "cat-1", month: "2026-08" },
      ]),
    });

    const snapshot = await deleteCategoryWithBudgets("user-1", "cat-1");

    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    expect(writes.map((write) => write.table)).toEqual(["categories", "category_budgets", "category_budgets"]);
    for (const write of writes) expect(write.row.deletedAt).toBe("2026-07-18T00:00:00.000Z");
    expect(snapshot?.budgets).toHaveLength(2);
  });

  it("writes nothing when the category is already gone", async () => {
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: vi.fn(async () => null),
      getAllAsync: vi.fn(async () => []),
    });
    expect(await deleteCategoryWithBudgets("user-1", "cat-x")).toBeNull();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });

  it("restores the category and its budgets together on undo", async () => {
    await restoreCategoryWithBudgets("user-1", {
      category: { id: "cat-1", deletedAt: "x" },
      budgets: [{ id: "b-1", deletedAt: "x" }],
    });
    expect(dependencies.writeRows).toHaveBeenCalledTimes(1);
    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    expect(writes.map((write) => write.row.deletedAt)).toEqual([null, null]);
  });

  it("does not restore a budget after its parent category was deleted", async () => {
    const sqlite = { getFirstAsync: vi.fn(async () => null) };
    dependencies.getSqliteAsync.mockResolvedValue(sqlite);
    dependencies.assertLiveRow.mockImplementation(async () => {
      throw new Error("Cannot edit missing categories row");
    });
    dependencies.restoreRows.mockImplementation(async (_userId: string, _writes: unknown[], validate?: (db: unknown) => Promise<void>) => {
      await validate?.(sqlite);
    });

    await expect(restoreCategoryBudget("user-1", {
      id: "budget-1", userId: "user-1", categoryId: "cat-1", deletedAt: "x",
    })).rejects.toThrow("Cannot edit missing categories row");
    expect(dependencies.restoreRow).not.toHaveBeenCalled();
  });

  it("counts every live category reference, not only ledger transactions", async () => {
    const counts = new Map([
      ["transactions", 2],
      ["subscriptions", 1],
      ["recurring_incomes", 3],
      ["installment_plans", 4],
      ["cell_notes", 5],
    ]);
    dependencies.getSqliteAsync.mockResolvedValue({
      getFirstAsync: vi.fn(async (sql: string) => ({ n: counts.get(sql.match(/FROM (\w+)/)?.[1] ?? "") ?? 0 })),
      getAllAsync: vi.fn(async () => []),
    });

    await expect(categoryReferenceUsage("user-1", "cat-1")).resolves.toEqual({
      transactions: 2,
      subscriptions: 1,
      recurringIncomes: 3,
      installmentPlans: 4,
      cellNotes: 5,
      total: 15,
    });
  });

  it("moves live references to the selected compatible category in one write", async () => {
    const sqlite = {
      getFirstAsync: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM categories")) return { id: "cat-1", name: "Market", kind: "expense", is_transfer: 0 };
        if (sql.includes("SELECT id, kind, is_transfer")) return { id: "cat-2", kind: "expense", is_transfer: 0 };
        return null;
      }),
      getAllAsync: vi.fn(async (sql: string, args: unknown[]) => {
        if (sql.includes("category_budgets")) return [{ id: "budget-1", category_id: "cat-1" }];
        if (sql.includes("FROM transactions")) return [{ id: "tx-1", category_id: "cat-1" }];
        if (sql.includes("FROM subscriptions")) return [{ id: "sub-1", category_id: "cat-1" }];
        if (sql.includes("FROM recurring_incomes")) return [{ id: "income-1", category_id: "cat-1" }];
        if (sql.includes("FROM installment_plans")) return [{ id: "plan-1", category_id: "cat-1" }];
        if (sql.includes("FROM cell_notes")) return args[1] === "cat-2" ? [] : [{ id: "note-1", month: "2026-07", category_id: "cat-1", body: "Eski not" }];
        return [];
      }),
    };
    dependencies.getSqliteAsync.mockResolvedValue(sqlite);

    const snapshot = await deleteCategoryWithBudgets("user-1", "cat-1", "cat-2");
    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const moved = writes.filter((write) => write.table !== "categories" && write.table !== "category_budgets");
    expect(moved.map((write) => write.table)).toEqual([
      "transactions",
      "subscriptions",
      "recurring_incomes",
      "installment_plans",
      "cell_notes",
      "cell_notes",
    ]);
    for (const write of moved.filter((write) => write.table !== "cell_notes")) expect(write.row.categoryId).toBe("cat-2");
    expect(moved.filter((write) => write.table === "cell_notes" && write.row.categoryId === "cat-2")).toHaveLength(1);
    expect(moved.filter((write) => write.table === "cell_notes" && write.row.deletedAt === "2026-07-18T00:00:00.000Z")).toHaveLength(1);
    expect(snapshot?.reassigned).toHaveLength(5);
    expect(snapshot?.created).toHaveLength(1);
  });

  it("never nulls a transaction's category: Postgres requires it not null", async () => {
    const sqlite = {
      getFirstAsync: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT * FROM categories")) return { id: "cat-1", name: "Market", kind: "expense", is_transfer: 0 };
        return null;
      }),
      getAllAsync: vi.fn(async (sql: string) => {
        if (sql.includes("category_budgets")) return [];
        if (sql.includes("FROM transactions")) return [{ id: "tx-1", category_id: "cat-1" }];
        if (sql.includes("FROM installment_plans")) return [{ id: "plan-1", category_id: "cat-1" }];
        return [];
      }),
    };
    dependencies.getSqliteAsync.mockResolvedValue(sqlite);

    const snapshot = await deleteCategoryWithBudgets("user-1", "cat-1", null);
    const [, writes] = dependencies.writeRows.mock.calls[0] as [string, { table: string; row: Record<string, unknown> }[]];
    const moved = writes.filter((write) => write.table !== "categories" && write.table !== "category_budgets");
    // The transaction row is left untouched (orphaned, same as the legacy
    // delete path); only installment_plans — nullable on Postgres — is nulled.
    expect(moved.map((write) => write.table)).toEqual(["installment_plans"]);
    expect(moved[0]?.row.categoryId).toBeNull();
    expect(snapshot?.reassigned).toEqual([{ table: "installment_plans", row: { id: "plan-1", category_id: "cat-1" } }]);
  });
});

describe("monthly category budgets", () => {
  it("computes spent, remaining and over-budget ratio from expense flows", () => {
    const rows = budgetProgress(
      [
        { id: "food-budget", categoryId: "food", month: "2026-07", amountMinor: 10_000 },
        { id: "rent-budget", categoryId: "rent", month: "2026-07", amountMinor: 20_000 },
      ],
      [tx("food-1", "food", 12_000), tx("rent-1", "rent", 5_000)],
      "2026-07",
      "2026-07-18",
    );
    expect(rows.map((row) => row.id)).toEqual(["food-budget", "rent-budget"]);
    expect(rows[0]).toMatchObject({ spentMinor: 12_000, remainingMinor: -2_000, ratio: 1.2 });
    expect(rows[1]).toMatchObject({ spentMinor: 5_000, remainingMinor: 15_000, ratio: 0.25 });
  });

  it("ignores other months and watched-person spending", () => {
    const watched = { ...tx("watched", "food", 5_000), personIsSelf: false };
    expect(budgetProgress(
      [{ id: "food", categoryId: "food", month: "2026-07", amountMinor: 10_000 }],
      [watched, tx("old", "food", 9_000, "2026-06-30")],
      "2026-07",
      "2026-07-18",
    )[0]?.spentMinor).toBe(0);
  });
});

describe("budget repository boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects zero and negative limits before touching persistence", async () => {
    for (const amountMinor of [0, -1]) {
      await expect(upsertCategoryBudget("user-1", {
        month: "2026-07",
        categoryId: "cat-1",
        amountMinor,
      })).rejects.toThrow("Budget amount must be positive");
    }
    expect(dependencies.getSqliteAsync).not.toHaveBeenCalled();
    expect(dependencies.writeRows).not.toHaveBeenCalled();
  });
});
