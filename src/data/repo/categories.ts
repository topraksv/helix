import type * as schema from "../../db/schema";
import { deterministicId, naturalKeys, newId } from "../../db/ids";
import { writeRows, type RowWrite } from "../../db/mutations";
import { assertInputWithinLimit } from "../../domain/input";
import { suggestCategoryIcon } from "../category-icons";
import type { TemplateCategory } from "./onboarding";

export type CategoryRow = typeof schema.categories.$inferSelect;

function validateCategory(input: Pick<CategoryRow, "name" | "kind" | "isTransfer">): void {
  if (!input.name.trim()) throw new Error("Category name is required");
  assertInputWithinLimit(input.name, "text");
  if (input.kind === "income" && input.isTransfer) throw new Error("Income category cannot be a transfer");
}

export async function createCategory(
  userId: string,
  input: { name: string; kind: "expense" | "income"; isTransfer: boolean; sortOrder: number },
): Promise<string> {
  validateCategory(input);
  const id = newId();
  await writeRows(userId, [{
    table: "categories",
    row: {
      id,
      name: input.name.trim(),
      kind: input.kind,
      icon: suggestCategoryIcon(input.name, input.kind),
      color: null,
      sortOrder: input.sortOrder,
      isColumn: true,
      isTransfer: input.kind === "expense" && input.isTransfer,
      deletedAt: null,
    },
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
  await writeRows(userId, [{ table: "categories", row: next }]);
}

export async function reorderCategoryGroup(
  userId: string,
  categories: CategoryRow[],
  kind: "expense" | "income",
  orderedIds: string[],
): Promise<void> {
  const group = categories.filter((category) => category.kind === kind);
  const slots = group.map((category) => category.sortOrder);
  const byId = new Map(group.map((category) => [category.id, category]));
  const writes = orderedIds.flatMap((id, index) => {
    const category = byId.get(id);
    const sortOrder = slots[index];
    return category && sortOrder != null
      ? [{ table: "categories" as const, row: { ...category, sortOrder } }]
      : [];
  });
  if (writes.length > 0) await writeRows(userId, writes);
}

export async function addTemplateCategories(
  userId: string,
  templates: TemplateCategory[],
  sortOrderStart: number,
): Promise<void> {
  const writes: RowWrite[] = await Promise.all(templates.map(async (category, index) => ({
    table: "categories" as const,
    row: {
      id: await deterministicId(naturalKeys.seedCategory(userId, category.name)),
      name: category.name,
      kind: category.kind,
      icon: category.icon ?? null,
      color: null,
      sortOrder: sortOrderStart + index,
      isColumn: category.isColumn,
      isTransfer: category.kind === "expense" && category.isTransfer === true,
      deletedAt: null,
    },
  })));
  if (writes.length > 0) await writeRows(userId, writes);
}
