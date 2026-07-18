import { distributionForRange } from "./analytics";
import { firstDayOf, lastDayOf, type ISODate, type MonthKey } from "./dates";
import type { TxLike } from "./types";

export interface CategoryBudgetLike {
  id: string;
  categoryId: string;
  month: MonthKey;
  amountMinor: number;
}

export interface BudgetProgress extends CategoryBudgetLike {
  spentMinor: number;
  remainingMinor: number;
  ratio: number;
}

export function budgetProgress(
  budgets: readonly CategoryBudgetLike[],
  transactions: TxLike[],
  month: MonthKey,
  today: ISODate,
): BudgetProgress[] {
  const spent = distributionForRange(transactions, firstDayOf(month), lastDayOf(month), today).expenseByCategory;
  return budgets
    .filter((budget) => budget.month === month && budget.amountMinor > 0)
    .map((budget) => {
      const spentMinor = spent.get(budget.categoryId) ?? 0;
      return {
        ...budget,
        spentMinor,
        remainingMinor: budget.amountMinor - spentMinor,
        ratio: spentMinor / budget.amountMinor,
      };
    })
    .sort((left, right) => right.ratio - left.ratio || left.categoryId.localeCompare(right.categoryId));
}
