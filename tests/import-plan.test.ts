import { describe, expect, it } from "vitest";
import { buildSpreadsheetImportPlan, importCategoryKey } from "../src/data/repo/import-plan";
import type { ParsedSheet } from "../src/services/spreadsheet-import";

const sheet: ParsedSheet = {
  sheetName: "2026",
  year: 2026,
  months: ["2026-01", "2026-02"],
  columns: [
    { label: "Kira", kindGuess: "expense", isInvestment: false, dueDay: null },
    { label: "Maaş", kindGuess: "income", isInvestment: false, dueDay: null },
  ],
  cells: [
    [
      { valueMinor: 100_00, formulaParts: null, comment: "Ev", commentParts: null },
      { valueMinor: 500_00, formulaParts: null, comment: null, commentParts: null },
    ],
    [
      { valueMinor: 120_00, formulaParts: [50_00, 70_00], comment: null, commentParts: null },
      { valueMinor: null, formulaParts: null, comment: null, commentParts: null },
    ],
  ],
  skippedColumns: [],
  openingBalance: null,
};

describe("spreadsheet import planner", () => {
  it("lazily preserves selected-year columns, breakdowns and notes", () => {
    const plan = buildSpreadsheetImportPlan({
      sheets: [sheet],
      excludedLabels: new Set(),
      selectedYears: new Set([2026]),
      categoryIds: new Map([
        [importCategoryKey("Kira", "expense"), "expense-id"],
        [importCategoryKey("Maaş", "income"), "income-id"],
      ]),
      today: "2026-01-15",
    });
    const cells = [...plan.cells];
    expect(plan.columnYears.get(2026)).toEqual(["expense-id", "income-id"]);
    expect(cells.map((cell) => ({ month: cell.month, type: cell.type, status: cell.status, items: cell.items.length }))).toEqual([
      { month: "2026-01", type: "expense", status: "realized", items: 1 },
      { month: "2026-01", type: "income", status: "realized", items: 1 },
      { month: "2026-02", type: "expense", status: "pending", items: 2 },
    ]);
    expect(cells[0]?.cellNote).toBe("Ev");
  });

  it("produces no rows or columns for an unselected year", () => {
    const plan = buildSpreadsheetImportPlan({
      sheets: [sheet],
      excludedLabels: new Set(),
      selectedYears: new Set([2025]),
      categoryIds: new Map(),
      today: "2026-01-15",
    });
    expect([...plan.cells]).toEqual([]);
    expect(plan.columnYears.size).toBe(0);
  });
});

