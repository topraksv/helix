/** Pure, lazy spreadsheet-to-ledger write plan. No SQL and no mutations. */

import { yearOf, type MonthKey } from "../../domain/dates";
import type { TransactionType } from "../../domain/types";
import {
  isInstallmentCell,
  planImportCell,
  type CellData,
  type ParsedSheet,
} from "../../services/spreadsheet-import";

export function importCategoryKey(name: string, kind: "expense" | "income"): string {
  return `${name.trim().toLocaleLowerCase("tr-TR")}|${kind}`;
}

interface PlannedSpreadsheetCell {
  year: number;
  month: MonthKey;
  categoryId: string;
  type: TransactionType;
  effectiveDate: string;
  status: "realized" | "pending";
  items: ReturnType<typeof planImportCell> extends infer T
    ? T extends { items: infer I }
      ? I
      : never
    : never;
  cellNote: string | null;
}

interface SpreadsheetImportPlan {
  columnYears: Map<number, string[]>;
  cells: Iterable<PlannedSpreadsheetCell>;
}

export function buildSpreadsheetImportPlan(input: {
  sheets: ParsedSheet[];
  excludedLabels: ReadonlySet<string>;
  selectedYears: ReadonlySet<number> | null;
  categoryIds: ReadonlyMap<string, string>;
  today: string;
}): SpreadsheetImportPlan {
  const yearAllowed = (year: number) => !input.selectedYears || input.selectedYears.has(year);
  const resolved = input.sheets.flatMap((sheet) => {
    if (!sheet.months.some((month) => yearAllowed(yearOf(month)))) return [];
    const columns = sheet.columns
      .map((column, index) => ({
        ...column,
        index,
        categoryId: input.categoryIds.get(importCategoryKey(column.label, column.kindGuess)) ?? null,
      }))
      .filter((column) => !input.excludedLabels.has(column.label));
    if (columns.some((column) => !column.categoryId)) {
      throw new Error("Spreadsheet import category plan is incomplete");
    }
    return [{ sheet, columns: columns as (typeof columns[number] & { categoryId: string })[] }];
  });

  const columnYears = new Map<number, string[]>();
  for (const { sheet, columns } of resolved) {
    const orderedIds = columns.map((column) => column.categoryId);
    for (const month of sheet.months) {
      const year = yearOf(month);
      if (!yearAllowed(year)) continue;
      columnYears.set(year, [...new Set([...(columnYears.get(year) ?? []), ...orderedIds])]);
    }
  }

  const cells: Iterable<PlannedSpreadsheetCell> = {
    *[Symbol.iterator]() {
      for (const { sheet, columns } of resolved) {
        for (const [rowIndex, month] of sheet.months.entries()) {
          const year = yearOf(month);
          if (!yearAllowed(year)) continue;
          for (const column of columns) {
            const cell: CellData | undefined = sheet.cells[rowIndex]?.[column.index];
            if (!cell || isInstallmentCell(column.label, cell.comment)) continue;
            const planned = planImportCell(cell);
            if (!planned) continue;
            const effectiveDate = `${month}-01`;
            yield {
              year,
              month,
              categoryId: column.categoryId,
              type: column.isInvestment ? "transfer" : column.kindGuess,
              effectiveDate,
              status: effectiveDate <= input.today ? "realized" : "pending",
              items: planned.items,
              cellNote: planned.cellNote,
            };
          }
        }
      }
    },
  };

  return { columnYears, cells };
}
