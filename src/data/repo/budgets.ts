import { getSqliteAsync } from "../../db/client";
import { deterministicId, naturalKeys } from "../../db/ids";
import { softDelete, writeRows } from "../../db/mutations";
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
