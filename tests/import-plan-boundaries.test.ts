import { describe, expect, it } from "vitest";
import { buildSpreadsheetImportPlan, importCategoryKey } from "../src/data/repo/import-plan";
import type { ParsedSheet } from "../src/services/spreadsheet-import";

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
