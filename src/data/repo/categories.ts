import type * as schema from "../../db/schema";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { assertLiveRow, writeRows, writeRowsValidated, type RowWrite } from "../../db/mutations";
import { assertInputWithinLimit } from "../../domain/input";
import { suggestCategoryIcon } from "../../domain/category-icons";
import { assertInvestmentWrites } from "./investment-validation";

type CategoryRow = typeof schema.categories.$inferSelect;

function validateCategory(input: Pick<CategoryRow, "name" | "kind" | "isTransfer">): void {
  if (!input.name.trim()) throw new Error("Category name is required");
  assertInputWithinLimit(input.name, "text");
  if (input.kind !== "expense" && input.kind !== "income") throw new Error("Invalid category kind");
  if (typeof input.isTransfer !== "boolean") throw new Error("Invalid category transfer flag");
  if (input.kind === "income" && input.isTransfer) throw new Error("Income category cannot be a transfer");
}

export interface TemplateCategory {
  name: string;
  kind: "expense" | "income";
  isColumn: boolean;
  isTransfer?: boolean;
  icon?: string;
}

export function categoryRow(
  id: string,
  category: {
    name: string;
    kind: "expense" | "income";
    icon: string | null;
    sortOrder: number;
    isColumn: boolean;
    isTransfer?: boolean;
  },
) {
  return {
    id,
    name: category.name,
    kind: category.kind,
    icon: category.icon,
    color: null,
    sortOrder: category.sortOrder,
    isColumn: category.isColumn,
    isTransfer: category.kind === "expense" && category.isTransfer === true,
    deletedAt: null,
  };
}

export async function createCategory(
  userId: string,
  input: { name: string; kind: "expense" | "income"; isTransfer: boolean; sortOrder: number },
): Promise<string> {
  validateCategory(input);
  const id = newId();
  await writeRows(userId, [{
    table: "categories",
    row: categoryRow(id, {
      name: input.name.trim(),
      kind: input.kind,
      icon: suggestCategoryIcon(input.name, input.kind),
      sortOrder: input.sortOrder,
      isColumn: true,
      isTransfer: input.isTransfer,
    }),
  }]);
  return id;
}

export async function updateCategory(
  userId: string,
  category: CategoryRow,
  patch: Partial<Pick<CategoryRow, "name" | "isColumn" | "isTransfer">>,
): Promise<void> {
  const next = { ...category, ...patch, name: (patch.name ?? category.name).trim() };
  validateCategory(next);
  const writes: RowWrite[] = [{ table: "categories", row: next }];
  await writeRowsValidated(
    userId,
    writes,
    async (sqlite) => {
      await assertLiveRow(sqlite, "categories", userId, category.id);
      await assertInvestmentWrites(sqlite, userId, writes);
    },
  );
}

/** Hand the rows' existing sort slots to `orderedIds` in order; ids not among the rows are ignored. */
export async function reorderRows<Row extends { id: string; sortOrder: number }>(
  userId: string,
  table: "categories" | "computed_columns",
  rows: readonly Row[],
  orderedIds: readonly string[],
): Promise<void> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const slots = rows.map((row) => row.sortOrder);
  const writes: RowWrite[] = orderedIds.flatMap((id, index) => {
    const row = byId.get(id);
    const sortOrder = slots[index];
    return row && sortOrder != null ? [{ table, row: { ...row, sortOrder } }] : [];
  });
  if (writes.length > 0) {
    await writeRowsValidated(userId, writes, async (sqlite) => {
      await Promise.all(writes.map((write) => assertLiveRow(sqlite, table, userId, String(write.row.id))));
    });
  }
}

export function reorderCategoryGroup(
  userId: string,
  categories: CategoryRow[],
  kind: "expense" | "income",
  orderedIds: string[],
): Promise<void> {
  return reorderRows(userId, "categories", categories.filter((category) => category.kind === kind), orderedIds);
}

export async function addTemplateCategories(
  userId: string,
  templates: TemplateCategory[],
  sortOrderStart: number,
): Promise<void> {
  const writes: RowWrite[] = await Promise.all(templates.map(async (category, index) => ({
    table: "categories" as const,
    row: categoryRow(await deterministicId(naturalKeys.seedCategory(userId, category.name)), {
      ...category,
      icon: category.icon ?? null,
      sortOrder: sortOrderStart + index,
    }),
  })));
  if (writes.length > 0) await writeRows(userId, writes);
}
