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
  columns: [{ label: "Yatırım", kindGuess: "expense", isInvestment: true, dueDay: null }],
  cells: [[cell(100_00)]],
  skippedColumns: [],
  openingBalance: null,
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

  it("deduplicates column ids and skips missing, empty, and reconstructed installment cells", () => {
    const columns = [
      { label: "Kira", kindGuess: "expense" as const, isInvestment: false, dueDay: null },
      { label: "Kira", kindGuess: "expense" as const, isInvestment: false, dueDay: null },
      { label: "KK Taksitli Harcamalar", kindGuess: "expense" as const, isInvestment: false, dueDay: null },
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
    expect([...plan.cells].map(({ month, type, status, categoryId }) => ({ month, type, status, categoryId }))).toEqual([
      { month: "2026-01", type: "expense", status: "realized", categoryId: "rent" },
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
});
