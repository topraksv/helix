/** Pure, lazy spreadsheet-to-ledger write plan. No SQL and no mutations. */

import { yearOf, type MonthKey } from "../../domain/dates";
import type { Minor } from "../../domain/money";
import type { TransactionType } from "../../domain/types";
import {
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

/**
 * One cell's ledger rows, or null when it has none.
 *
 * A cell is imported at its own value, instalment comments included: the cell
 * is what the workbook's own balance column adds up, and rows summing to
 * anything else put the ledger at odds with the file it came from. When plans
 * carry part of it, the cell carries the REST — so every instalment is a real
 * row with its own card and number, and the column still totals what the
 * workbook says. The remainder may be negative: a column kept net of the
 * column beside it holds less than the instalments in its own comment.
 */
function plannedCell(
  cell: CellData,
  covered: Minor,
  remainderNote: string | null,
): { items: PlannedSpreadsheetCell["items"]; cellNote: string | null } | null {
  if (covered === 0) {
    const planned = planImportCell(cell);
    return planned && { items: planned.items, cellNote: planned.cellNote };
  }
  const remainder = (cell.valueMinor ?? 0) - covered;
  if (remainder === 0) return null;
  return {
    items: [{ amountMinor: remainder, note: remainderNote, isAggregate: true }],
    cellNote: cell.comment,
  };
}

export function buildSpreadsheetImportPlan(input: {
  sheets: ParsedSheet[];
  excludedLabels: ReadonlySet<string>;
  selectedYears: ReadonlySet<number> | null;
  categoryIds: ReadonlyMap<string, string>;
  today: string;
  /**
   * What the reconstructed instalment plans already put into one cell, by
   * month and column label. Those rows are written by the plans themselves —
   * with their card, their title and their payment number — so the cell writes
   * only what is LEFT of it, and the column still totals exactly what the
   * workbook says.
   */
  instalmentTotal?: (month: MonthKey, label: string) => Minor;
  /** Note carried by that remainder row, so the figure can be accounted for. */
  remainderNote?: string;
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
            if (!cell) continue;
            const planned = plannedCell(
              cell,
              input.instalmentTotal?.(month, column.label) ?? 0,
              input.remainderNote ?? null,
            );
            if (!planned) continue;
            const effectiveDate = `${month}-01`;
            yield {
              year,
              month,
              categoryId: column.categoryId,
              type: column.isInvestment ? "transfer" : column.kindGuess,
              effectiveDate,
              status: effectiveDate <= input.today ? "realized" : "pending",
              ...planned,
            };
          }
        }
      }
    },
  };

  return { columnYears, cells };
}
