import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { fromDbShape, nowIso, softDelete, writeRows } from "../../db/mutations";
import type { MonthKey } from "../../domain/dates";
import { assertSupportedMinorAmount, type Minor } from "../../domain/money";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function upsertCategoryBudget(
  userId: string,
  input: { month: MonthKey; categoryId: string; amountMinor: Minor },
): Promise<string> {
  if (!MONTH_RE.test(input.month)) throw new Error("Invalid budget month");
  assertSupportedMinorAmount(input.amountMinor, false);
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<{ id: string }>(
    `SELECT id FROM categories
     WHERE id = ? AND user_id = ? AND kind = 'expense' AND deleted_at IS NULL`,
    [input.categoryId, userId],
  );
  if (!category) throw new Error("Budget category must be a live expense category");
  const id = await deterministicId(naturalKeys.categoryBudget(userId, input.month, input.categoryId));
  await writeRows(userId, [{
    table: "category_budgets",
    row: {
      id,
      categoryId: input.categoryId,
      month: input.month,
      amountMinor: input.amountMinor,
      deletedAt: null,
    },
  }]);
  return id;
}

export function deleteCategoryBudget(userId: string, id: string) {
  return softDelete(userId, "category_budgets", id);
}

export interface CategoryDeleteSnapshot {
  category: Record<string, unknown>;
  budgets: Record<string, unknown>[];
}

/**
 * Deleting a category cascades to its monthly budget targets in the SAME
 * atomic write: a budget is a derived target for a live expense category, so a
 * tombstoned category must never leave nameless budget rows in lists or
 * totals. Returns the pre-delete snapshot; undo restores both together.
 */
export async function deleteCategoryWithBudgets(
  userId: string,
  categoryId: string,
): Promise<CategoryDeleteSnapshot | null> {
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId],
  );
  if (!category) return null;
  const budgets = await sqlite.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM category_budgets WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL`,
    [userId, categoryId],
  );
  const deletedAt = nowIso();
  const snapshot: CategoryDeleteSnapshot = {
    category: fromDbShape("categories", category),
    budgets: budgets.map((row) => fromDbShape("category_budgets", row)),
  };
  await writeRows(userId, [
    { table: "categories", row: { ...snapshot.category, deletedAt } },
    ...snapshot.budgets.map((row) => ({ table: "category_budgets" as const, row: { ...row, deletedAt } })),
  ]);
  return snapshot;
}

/** Undo for `deleteCategoryWithBudgets`: one write restores the whole set. */
export async function restoreCategoryWithBudgets(userId: string, snapshot: CategoryDeleteSnapshot): Promise<void> {
  await writeRows(userId, [
    { table: "categories", row: { ...snapshot.category, deletedAt: null } },
    ...snapshot.budgets.map((row) => ({ table: "category_budgets" as const, row: { ...row, deletedAt: null } })),
  ]);
}
