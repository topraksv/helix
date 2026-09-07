import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildTemplateBytes, composeWorkbook } from "../src/services/workbook-export";
import { parseWorkbookBytes } from "../src/services/spreadsheet-import";
import {
  buildLedgerGrids,
  WORKBOOK_COLUMNS,
  WORKBOOK_SHEETS,
  type InvestmentRow,
  type SubscriptionRow,
  type WorkbookColumn,
} from "../src/domain/workbook-format";

/**
 * The promise the whole feature rests on: a file the app writes is a file the
 * app can read.
 *
 * It was not true for two rounds. The export was a flat list of transactions
 * and the template copied its shape, so the wizard — which parses a month grid
 * — answered both with "Ay adlarını bulamadık". Nothing about that is visible
 * in a column table or a type; only handing the written bytes back to the real
 * parser catches it, which is what every test here does.
 */
const subscription: SubscriptionRow = {
  name: "Netflix", amountMinor: 22999, currency: "TRY", amountMode: "fixed", cycle: "monthly",
  intervalMonths: 1, billingDay: 12, nextDueDate: "2026-04-12", trialEndDate: "",
  category: "Abonelik", source: "Worldcard", person: "Toprak", autoPay: true, isActive: true,
  websiteDomain: "netflix.com", monthlyLoadMinor: 22999,
};

const investment: InvestmentRow = {
  product: "Gram Altın", assetType: "metal", marketCode: "", operationDate: "2026-02-01",
  kind: "buy", quantity: "12,5", unitPriceMinor: 480000, totalMinor: 6000000, note: "",
};

const year2026 = buildLedgerGrids([
  { item: "Maaş", month: "2026-01", minor: 6500000 },
  { item: "Maaş", month: "2026-02", minor: 6500000 },
  { item: "Market", month: "2026-01", minor: 920000 },
  { item: "Market", month: "2026-02", minor: 880000 },
  { item: "Kira", month: "2026-01", minor: 1800000 },
  { item: "Kira", month: "2026-02", minor: 1800000 },
]);

function grid(bytes: Uint8Array, sheet: string): string[][] {
  const book = XLSX.read(bytes, { type: "array" });
  const worksheet = book.Sheets[sheet];
  if (!worksheet) throw new Error(`sheet ${sheet} missing`);
  return XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false, defval: "" });
}

describe("workbook round trip", () => {
  it("writes an export the import wizard reads back", async () => {
    const bytes = await composeWorkbook({ years: year2026, subscriptions: [subscription], investments: [investment] });
    const parsed = await parseWorkbookBytes(bytes);

    expect(parsed.sheets, "the ledger year parses").toHaveLength(1);
    const sheet = parsed.sheets[0]!;
    expect(sheet.year).toBe(2026);
    expect(sheet.months).toEqual(["2026-01", "2026-02"]);
    expect(sheet.columns.map((column) => column.label).sort()).toEqual(["Kira", "Maaş", "Market"]);

    // The figures survive the trip, to the kuruş.
    const market = sheet.columns.findIndex((column) => column.label === "Market");
    expect(sheet.cells[0]![market]!.valueMinor).toBe(920000);
    expect(sheet.cells[1]![market]!.valueMinor).toBe(880000);

    // Income is recognised from the heading, which is how the wizard has always
    // decided direction — the sign is not what carries it.
    const salary = sheet.columns.find((column) => column.label === "Maaş")!;
    expect(salary.kindGuess).toBe("income");
  });

  it("names the two record sheets as unread rather than failing the import", async () => {
    const bytes = await composeWorkbook({ years: year2026, subscriptions: [subscription], investments: [investment] });
    const parsed = await parseWorkbookBytes(bytes);
    // A subscription is not a month grid and never will be, so the wizard is
    // right to refuse these two. What matters is that refusing them does not
    // refuse the file: the ledger still imports and the owner is told which
    // sheets were left alone.
    expect(parsed.unparsed.map((sheet) => sheet.sheetName).sort())
      .toEqual([WORKBOOK_SHEETS.subscriptions, WORKBOOK_SHEETS.investments].sort());
    expect(parsed.sheets.length, "and the file is still importable").toBeGreaterThan(0);
  });

  it("gives each year its own sheet, so two years cannot be filed under one", async () => {
    const twoYears = buildLedgerGrids([
      { item: "Market", month: "2025-11", minor: 500000 },
      { item: "Market", month: "2025-12", minor: 510000 },
      { item: "Market", month: "2026-01", minor: 920000 },
    ]);
    const bytes = await composeWorkbook({ years: twoYears, subscriptions: [], investments: [] });
    const book = XLSX.read(bytes, { type: "array" });
    expect(book.SheetNames.slice(0, 2)).toEqual(["Mali Tablo 2025", "Mali Tablo 2026"]);
    const parsed = await parseWorkbookBytes(bytes);
    expect(parsed.sheets.map((sheet) => sheet.year)).toEqual([2025, 2026]);
  });

  it("produces a template the import wizard accepts", async () => {
    const parsed = await parseWorkbookBytes(await buildTemplateBytes());
    expect(parsed.unparsed, "no sheet the wizard has to refuse").toEqual([]);
    expect(parsed.sheets).toHaveLength(1);
    const sheet = parsed.sheets[0]!;
    expect(sheet.year).toBe(2026);
    expect(sheet.months, "a full year to fill in").toHaveLength(12);
    const labels = sheet.columns.map((column) => column.label);
    expect(labels).toContain("Maaş");
    expect(labels).toContain("Kira");
  });

  it("leaves gaps in the template, so a blank cell reads as allowed", async () => {
    const parsed = await parseWorkbookBytes(await buildTemplateBytes());
    const sheet = parsed.sheets[0]!;
    const filled = sheet.cells.flat().filter((cell) => cell.valueMinor != null).length;
    const full = sheet.columns.length * sheet.months.length;
    expect(filled, "at least one month is left empty").toBeLessThan(full);
    expect(filled, "and most of it is filled in").toBeGreaterThan(full * 0.7);
  });

  it("writes the record sheets as tables: header row, one row per record", async () => {
    const bytes = await composeWorkbook({ years: year2026, subscriptions: [subscription], investments: [investment] });
    for (const [key, sheetName] of [["subscriptions", WORKBOOK_SHEETS.subscriptions], ["investments", WORKBOOK_SHEETS.investments]] as const) {
      const rows = grid(bytes, sheetName);
      const columns = WORKBOOK_COLUMNS[key] as WorkbookColumn<unknown>[];
      expect(rows[0], `${key}: header`).toEqual(columns.map((column) => column.header));
      expect(rows, `${key}: one record`).toHaveLength(2);
    }
  });

  it("sizes every column to its widest cell and marks the header as a filter", async () => {
    const bytes = await composeWorkbook({ years: year2026, subscriptions: [subscription], investments: [] });
    const xml = Buffer.from(bytes).toString("latin1");
    expect(xml, "column widths reach the file").toContain("cols>");
    expect(xml, "the header row is a filter row").toContain("autoFilter");
    const book = XLSX.read(bytes, { type: "array" });
    const filter = book.Sheets[WORKBOOK_SHEETS.subscriptions]!["!autofilter"] as { ref: string } | undefined;
    // Over the header AND the record, not the header alone.
    expect(filter?.ref, "the filter covers the rows it filters").toBe("A1:P2");
  });

  /**
   * A sheet with a header and nothing under it gets no filter.
   *
   * A filter over one row is a control that does nothing, and Excel draws the
   * dropdowns anyway — so an empty Abonelikler sheet would look like a table
   * whose contents had gone missing rather than one that was never filled.
   */
  it("leaves a header-only sheet without a filter", async () => {
    const bytes = await composeWorkbook({ years: year2026, subscriptions: [], investments: [] });
    const book = XLSX.read(bytes, { type: "array" });
    expect(book.Sheets[WORKBOOK_SHEETS.subscriptions]!["!autofilter"]).toBeUndefined();
    // The headings are still there, so the sheet says what it would hold.
    expect(grid(bytes, WORKBOOK_SHEETS.subscriptions)).toHaveLength(1);
  });

  it("widens a column to its widest cell, not to its heading", async () => {
    const long = { ...subscription, name: "Çok Uzun Bir Abonelik Adı Buraya" };
    const bytes = await composeWorkbook({ years: [], subscriptions: [long], investments: [] });
    const book = XLSX.read(bytes, { type: "array" });
    // `!cols` does not survive SheetJS's own reader, so the file is the
    // evidence: the width written must exceed the heading's own length.
    const xml = Buffer.from(bytes).toString("latin1");
    const width = /<col[^>]*width="([0-9.]+)"/.exec(xml)?.[1];
    expect(Number(width), "sized to the name, not to \"Abonelik\"").toBeGreaterThan(long.name.length);
    expect(book.SheetNames).toContain(WORKBOOK_SHEETS.subscriptions);
  });
});
