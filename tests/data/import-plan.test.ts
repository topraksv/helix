import { describe, expect, it } from "vitest";
import { buildSpreadsheetImportPlan, importCategoryKey } from "../../src/data/repo/import-plan";
import type { ParsedSheet } from "../../src/services/spreadsheet-import";

const cell = (valueMinor: number | null, comment: string | null = null) => ({
  valueMinor,
  formulaParts: null,
  comment,
  commentParts: null,
});

const sheet = (overrides: Partial<ParsedSheet> = {}): ParsedSheet => ({
  sheetName: "2026",
  year: 2026,
  months: ["2026-01"],
  columns: [{ label: "Yatırım", kindGuess: "expense", isInvestment: true, balanceLike: false, dueDay: null }],
  cells: [[cell(100_00)]],
  skippedColumns: [],
  openingColumn: null,
  openingCandidates: [],
  ...overrides,
});

const workbookSheet = sheet({
  months: ["2026-01", "2026-02"],
  columns: [
    { label: "Kira", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null },
    { label: "Maaş", kindGuess: "income", isInvestment: false, balanceLike: false, dueDay: null },
  ],
  cells: [
    [cell(100_00, "Ev"), cell(500_00)],
    [{ ...cell(120_00), formulaParts: [50_00, 70_00] }, cell(null)],
  ],
});

describe("spreadsheet import planner", () => {
  it("lazily preserves selected-year columns, breakdowns and notes", () => {
    const plan = buildSpreadsheetImportPlan({
      sheets: [workbookSheet],
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
      sheets: [workbookSheet],
      excludedLabels: new Set(),
      selectedYears: new Set([2025]),
      categoryIds: new Map(),
      today: "2026-01-15",
    });
    expect([...plan.cells]).toEqual([]);
    expect(plan.columnYears.size).toBe(0);
  });

  it("keeps a sheet that crosses into a selected year, and only that year's months of it", () => {
    const plan = buildSpreadsheetImportPlan({
      // One month row short: a sheet may stop before its last month.
      sheets: [sheet({ months: ["2025-12", "2026-01", "2026-02"], cells: [[cell(1_00)], [cell(2_00)]] })],
      excludedLabels: new Set(),
      selectedYears: new Set([2026]),
      categoryIds: new Map([[importCategoryKey("Yatırım", "expense"), "investment"]]),
      today: "2026-01-01",
    });
    expect([...plan.columnYears.keys()]).toEqual([2026]);
    // The first day of the month is already realized on that day.
    expect([...plan.cells].map(({ month, status }) => ({ month, status }))).toEqual([{ month: "2026-01", status: "realized" }]);
  });
});

describe("spreadsheet import-plan boundaries", () => {
  it("normalizes Turkish category identity before resolving a plan", () => {
    expect(importCategoryKey("  İLETİŞİM  ", "expense")).toBe("iletişim|expense");
  });

  it("requires a category only for a non-excluded selected column", () => {
    expect(() => buildSpreadsheetImportPlan({
      sheets: [sheet()],
      excludedLabels: new Set(),
      selectedYears: null,
      categoryIds: new Map(),
      today: "2026-01-01",
    })).toThrow("Spreadsheet import category plan is incomplete");

    const excluded = buildSpreadsheetImportPlan({
      sheets: [sheet()],
      excludedLabels: new Set(["Yatırım"]),
      selectedYears: null,
      categoryIds: new Map(),
      today: "2026-01-01",
    });
    expect([...excluded.cells]).toEqual([]);
  });

  /**
   * The owner's workbook keeps a running balance under "Maaş" in its 2021 sheet
   * and salary under the same heading after it; a default applied by label
   * dropped every later salary, and each month's declared opening hid it.
   */
  it("leaves a balance-like column out only in the sheet that reads it so, unless the owner says otherwise", () => {
    const salary = (year: number, balanceLike: boolean) => sheet({
      sheetName: String(year),
      year,
      months: [`${year}-01`],
      columns: [{ label: "Maaş", kindGuess: "income", isInvestment: false, balanceLike, dueDay: null }],
      cells: [[cell(500_00)]],
    });
    const months = (choice: { excludedLabels?: string[]; includedLabels?: string[] }) => [...buildSpreadsheetImportPlan({
      sheets: [salary(2021, true), salary(2022, false)],
      excludedLabels: new Set(choice.excludedLabels),
      includedLabels: new Set(choice.includedLabels),
      selectedYears: null,
      categoryIds: new Map([[importCategoryKey("Maaş", "income"), "salary"]]),
      today: "2026-01-01",
    }).cells].map((planned) => planned.month);
    expect(months({})).toEqual(["2022-01"]);
    expect(months({ excludedLabels: ["Maaş"] })).toEqual([]);
    expect(months({ includedLabels: ["Maaş"] })).toEqual(["2021-01", "2022-01"]);
  });

  it("deduplicates column ids, skips missing and empty cells, and keeps an instalment cell at its own value", () => {
    const columns = [
      { label: "Kira", kindGuess: "expense" as const, isInvestment: false, balanceLike: false, dueDay: null },
      { label: "Kira", kindGuess: "expense" as const, isInvestment: false, balanceLike: false, dueDay: null },
      { label: "KK Taksitli Harcamalar", kindGuess: "expense" as const, isInvestment: false, balanceLike: false, dueDay: null },
    ];
    const plan = buildSpreadsheetImportPlan({
      sheets: [sheet({
        months: ["2026-01", "2026-02"],
        columns,
        cells: [
          [cell(100), cell(null), cell(100, "══ Kart A ══\nÜrün  100,00  1/3")],
          [],
        ],
      })],
      excludedLabels: new Set(),
      selectedYears: null,
      categoryIds: new Map([
        [importCategoryKey("Kira", "expense"), "rent"],
        [importCategoryKey("KK Taksitli Harcamalar", "expense"), "installments"],
      ]),
      today: "2026-01-15",
    });

    expect(plan.columnYears.get(2026)).toEqual(["rent", "installments"]);
    // The instalment cell is imported like any other: its value is what the
    // workbook's own balance column adds up. What its comment reconstructs is
    // the schedule, and `importSheets` places those rows only in months no
    // sheet states — see `openMonths` there.
    expect([...plan.cells].map(({ month, type, status, categoryId }) => ({ month, type, status, categoryId }))).toEqual([
      { month: "2026-01", type: "expense", status: "realized", categoryId: "rent" },
      { month: "2026-01", type: "expense", status: "realized", categoryId: "installments" },
    ]);
  });

  it("marks investment columns as transfers and preserves a future boundary as pending", () => {
    const plan = buildSpreadsheetImportPlan({
      sheets: [sheet()],
      excludedLabels: new Set(),
      selectedYears: null,
      categoryIds: new Map([[importCategoryKey("Yatırım", "expense"), "investment"]]),
      today: "2025-12-31",
    });
    expect([...plan.cells].map(({ type, effectiveDate, status }) => ({ type, effectiveDate, status }))).toEqual([
      { type: "transfer", effectiveDate: "2026-01-01", status: "pending" },
    ]);
  });

  /**
   * A cell whose instalments are written as their own rows keeps the REST of
   * itself, so the column totals what the workbook says while the schedule
   * reaches the Taksitler screen. Three shapes, one rule: money left over,
   * nothing left over, and a column the owner has not filled in for a month
   * the sheet otherwise accounts for.
   */
  describe("a cell the instalment plans already carry", () => {
    const plan = (value: number | null, covered: number, note?: string) => [...buildSpreadsheetImportPlan({
      sheets: [sheet({
        columns: [{ label: "KK", kindGuess: "expense", isInvestment: false, balanceLike: false, dueDay: null }],
        cells: [[cell(value, "══ Kart A ══\nÜrün  100,00  1/3")]],
      })],
      excludedLabels: new Set(),
      selectedYears: null,
      categoryIds: new Map([[importCategoryKey("KK", "expense"), "kk"]]),
      today: "2026-01-15",
      instalmentTotal: () => covered,
      ...(note == null ? {} : { remainderNote: note }),
    }).cells];

    it("writes what is left of the cell, under the note it was given", () => {
      expect(plan(250_00, 100_00, "kalan").map((entry) => entry.items)).toEqual([
        [{ amountMinor: 150_00, note: "kalan", isAggregate: true }],
      ]);
    });

    it("writes nothing when the instalments are the whole cell", () => {
      expect(plan(100_00, 100_00)).toEqual([]);
    });

    it("takes the instalments back out of a column left empty", () => {
      const [entry] = plan(null, 100_00);
      expect(entry?.items).toEqual([{ amountMinor: -100_00, note: null, isAggregate: true }]);
      // The comment survives on the cell, which is the only record of what the
      // figure was made of.
      expect(entry?.cellNote).toContain("Ürün");
    });
  });
});
