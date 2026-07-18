import { getSqliteAsync } from "../../db/client";

export async function assertRecurringIncomeCategory(userId: string, categoryId: string | null): Promise<void> {
  if (!categoryId) throw new Error("Recurring income category is required");
  const sqlite = await getSqliteAsync();
  const category = await sqlite.getFirstAsync<{ kind: "income" | "expense" }>(
    `SELECT kind FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [categoryId, userId],
  );
  if (category?.kind !== "income") throw new Error("Recurring income category must be income");
}
