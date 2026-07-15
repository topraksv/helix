/** Pure helpers for subscription category selection. */

export interface SubscriptionCategoryLike {
  id: string;
  name: string;
  kind: "expense" | "income";
  deletedAt?: string | null;
}

function normalizedCategoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
}

/** Reuse a live expense category by Turkish-aware, whitespace-normalized name. */
export function findSubscriptionCategory(
  categories: SubscriptionCategoryLike[],
  requestedName: string,
): SubscriptionCategoryLike | null {
  const target = normalizedCategoryName(requestedName);
  return categories.find(
    (category) =>
      category.kind === "expense" &&
      category.deletedAt == null &&
      normalizedCategoryName(category.name) === target,
  ) ?? null;
}
