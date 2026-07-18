import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetProgress } from "../src/domain/budgets";
import type { TxLike } from "../src/domain/types";

const dependencies = vi.hoisted(() => ({
  getSqliteAsync: vi.fn(),
  writeRows: vi.fn(),
}));
vi.mock("../src/db/client", () => ({ getSqliteAsync: dependencies.getSqliteAsync }));
vi.mock("../src/db/ids", () => ({
  deterministicId: vi.fn(async (key: string) => `id:${key}`),
  naturalKeys: { categoryBudget: (...parts: unknown[]) => parts.join("|") },
}));
vi.mock("../src/db/mutations", () => ({
  fromDbShape: (_table: string, row: Record<string, unknown>) => row,
  nowIso: () => "2026-07-18T00:00:00.000Z",
  softDelete: vi.fn(),
  writeRows: dependencies.writeRows,
}));

import { deleteCategoryWithBudgets, restoreCategoryWithBudgets } from "../src/data/repo/budgets";

const tx = (id: string, categoryId: string, amountTryMinor: number, effectiveDate = "2026-07-10"): TxLike => ({
  id, type: "expense", amountTryMinor, effectiveDate, status: "realized", categoryId,
  categoryKind: "expense", paymentSourceId: null, personIsSelf: true,
  installmentPlanId: null, subscriptionId: null, isAggregate: false,
});

describe("category deletion cascades to its budgets", () => {
  beforeEach(() => vi.clearAllMocks());

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
