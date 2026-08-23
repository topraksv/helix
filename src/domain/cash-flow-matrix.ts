/** Pure model for either orientation of the cash-flow matrix. */

import { monthColumnBasis, monthFlowTotals, type MonthLedger } from "./balance";
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
  /** First month the workspace has a ledger for; earlier months never existed. */
  startMonth?: MonthKey;
}): CashFlowMatrixModel {
  const dataByMonth = new Map(input.yearMonths.map((month) => [month.month, month]));
  const allMonths = Array.from({ length: 12 }, (_, index) => {
    const month = makeMonthKey(input.year, index + 1);
    return { month, data: dataByMonth.get(month) ?? null };
  });
  // A workspace that starts in July has no January. The grid drew all twelve
  // regardless, so the first year opened on six blank rows a person had to
  // scroll past — and blank rows in a ledger read as lost data rather than as
  // months that never existed. Trimmed only when something is left: a year
  // entirely before the start keeps its twelve, so the screen still reaches
  // its own empty-year state instead of rendering a table with no rows.
  const fromStart = input.startMonth == null
    ? allMonths
    : allMonths.filter((entry) => entry.month >= input.startMonth!);
  const months = fromStart.length > 0 ? fromStart : allMonths;
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
                ...monthColumnBasis(month),
                ccSingleMinor: card?.singleMinor ?? 0,
                ccInstallmentMinor: card?.installmentMinor ?? 0,
              }),
            ];
          }),
        ),
      };
    }),
    // The balance columns read `monthFlowTotals`, exactly like the month card
    // and the computed columns beside them. They used to read the
    // realized-only chain (`openingMinor`/`closingMinor`) while the category
    // cells in the SAME ROW already carried the planned rows, so a future
    // month showed +30.000 of income beside a balance that never moved — the
    // row did not add up on its own face, and tapping it opened a card that
    // disagreed by the whole planned amount. One accessor, one dataset.
    {
      key: "opening",
      label: input.openingLabel,
      categoryId: null,
      computed: false,
      system: true,
      values: new Map(input.yearMonths.map((month) => [month.month, monthFlowTotals(month).openingMinor])),
    },
    {
      key: "closing",
      label: input.closingLabel,
      categoryId: null,
      computed: false,
      system: true,
      values: new Map(input.yearMonths.map((month) => [month.month, monthFlowTotals(month).closingMinor])),
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
