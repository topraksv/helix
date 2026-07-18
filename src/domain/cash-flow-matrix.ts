/** Pure model for either orientation of the cash-flow matrix. */

import type { MonthLedger } from "./balance";
import { creditCardSplitsByMonth } from "./analytics";
import { evaluateComputedColumn, parseDefinition } from "./computed-columns";
import { makeMonthKey, type ISODate, type MonthKey } from "./dates";
import type { TxLike } from "./types";

interface MatrixCategoryLike {
  id: string;
  name: string;
}

interface MatrixComputedColumnLike {
  id: string;
  name: string;
  definition: string;
}

export interface CashFlowMatrixColumn {
  key: string;
  label: string;
  categoryId: string | null;
  computed: boolean;
  system: boolean;
  values: Map<MonthKey, number | null>;
}

interface CashFlowMonthSlot {
  month: MonthKey;
  data: MonthLedger | null;
}

interface CashFlowMatrixModel {
  months: CashFlowMonthSlot[];
  columns: CashFlowMatrixColumn[];
  hasUncategorized: boolean;
  uncategorizedTotal: number;
}

export function buildCashFlowMatrixModel(input: {
  year: number;
  yearMonths: MonthLedger[];
  categories: MatrixCategoryLike[];
  computedColumns: MatrixComputedColumnLike[];
  transactions: TxLike[];
  creditCardIds: ReadonlySet<string>;
  liveCategoryIds: ReadonlySet<string>;
  today: ISODate;
  openingLabel: string;
  closingLabel: string;
}): CashFlowMatrixModel {
  const dataByMonth = new Map(input.yearMonths.map((month) => [month.month, month]));
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = makeMonthKey(input.year, index + 1);
    return { month, data: dataByMonth.get(month) ?? null };
  });
  const cardSplits = creditCardSplitsByMonth(input.transactions, input.creditCardIds, input.today);

  const columns: CashFlowMatrixColumn[] = [
    ...input.categories.map((category) => ({
      key: category.id,
      label: category.name,
      categoryId: category.id,
      computed: false,
      system: false,
      values: new Map(
        input.yearMonths.map((month) => [month.month, month.byCategory.get(category.id) ?? 0]),
      ),
    })),
    ...input.computedColumns.map((column) => {
      let definition: ReturnType<typeof parseDefinition> | null = null;
      try {
        definition = parseDefinition(JSON.parse(column.definition));
      } catch {
        // A corrupt legacy definition remains visible but never fabricates 0.
      }
      return {
        key: column.id,
        label: column.name,
        categoryId: null,
        computed: true,
        system: false,
        values: new Map(
          input.yearMonths.map((month): [MonthKey, number | null] => {
            if (!definition) return [month.month, null];
            const card = cardSplits.get(month.month);
            return [
              month.month,
              evaluateComputedColumn(definition, {
                month: month.month,
                byCategory: month.byCategory,
                incomeMinor: month.incomeMinor,
                expenseMinor: month.expenseMinor,
                ccSingleMinor: card?.singleMinor ?? 0,
                ccInstallmentMinor: card?.installmentMinor ?? 0,
              }),
            ];
          }),
        ),
      };
    }),
    {
      key: "opening",
      label: input.openingLabel,
      categoryId: null,
      computed: false,
      system: true,
      values: new Map(input.yearMonths.map((month) => [month.month, month.openingMinor])),
    },
    {
      key: "closing",
      label: input.closingLabel,
      categoryId: null,
      computed: false,
      system: true,
      values: new Map(input.yearMonths.map((month) => [month.month, month.closingMinor])),
    },
  ];

  const uncategorizedValue = (month: MonthLedger): number => {
    let sum = month.uncategorizedMinor;
    for (const [categoryId, value] of month.byCategory) {
      if (!input.liveCategoryIds.has(categoryId)) sum += value;
    }
    return sum;
  };
  const uncategorizedTotal = input.yearMonths.reduce(
    (sum, month) => sum + uncategorizedValue(month),
    0,
  );

  return {
    months,
    columns,
    hasUncategorized: uncategorizedTotal !== 0,
    uncategorizedTotal,
  };
}
