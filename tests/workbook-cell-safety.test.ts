import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildLedgerGrids,
  deneutralizeFormula,
  neutralizeFormula,
  SUBSCRIPTION_COLUMNS,
  WORKBOOK_SHEETS,
  type SubscriptionRow,
} from "../src/domain/workbook-format";
import { composeWorkbook } from "../src/services/workbook-export";
import { UserFacingError } from "../src/domain/user-error";

const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/**
 * The export's cell boundary, which moved but did not go away.
 *
 * This replaces `csv-export-safety`. The CSV export is gone and with it hazard
 * 1 — structure forgery, where a `;` or a newline inside a cell forged an extra
 * column. An `.xlsx` cell carries its own bounds, so RFC 4180 quoting has
 * nothing left to protect and writing it would put literal quote marks in the
 * file.
 *
 * Hazard 2 survives the format change unchanged: the workbook is opened in the
 * same spreadsheet the CSV was, and category, person and note text can arrive
 * from a synced device. Every formula-injection case that file tested is kept
 * below, including the whitespace bypasses a plain `^` test missed.
 */
describe("workbook cell safety", () => {
  it("neutralizes a formula in the first character", () => {
    expect(neutralizeFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeFormula("+1")).toBe("'+1");
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("-1")).toBe("'-1");
  });

  it("neutralizes a formula hidden behind leading whitespace or a carriage return", () => {
    for (const payload of [" =1+1", "\t=1+1", "   @SUM(A1)", "\r=cmd|'/C calc'!A0"]) {
      expect(neutralizeFormula(payload).startsWith("'"), payload).toBe(true);
    }
  });

  it("leaves ordinary Turkish text untouched", () => {
    for (const value of ["Market alışverişi", "Öğle yemeği (İş)", "1.234,56 TL ödendi", "Yemek; İçecek", ""]) {
      expect(neutralizeFormula(value), value).toBe(value);
    }
  });

  /**
   * The guard has to be reversible or it is a slow corruption: a grid's column
   * headings are the owner's own category names and they are read back by the
   * import wizard, so an unguarded round trip would add an apostrophe per pass.
   */
  it("gives every guarded value its own text back", () => {
    for (const value of ["=1+1", " =1+1", "-500 iade", "@herkes", "Market", "", "  boşlukla başlıyor"]) {
      expect(deneutralizeFormula(neutralizeFormula(value)), value).toBe(value);
    }
    // An apostrophe the OWNER typed is not the guard's and must not be eaten.
    expect(deneutralizeFormula("'Ali'nin kartı")).toBe("'Ali'nin kartı");
  });

  it("guards a hostile category name in the ledger grid's own heading", () => {
    const grid = buildLedgerGrids([{ item: "=1+1", month: "2026-01", minor: 100 }], MONTHS)[0]![1];
    expect(grid[0], "the heading is where a category name lands").toEqual(["", "'=1+1"]);
    // A month label and an amount are app-generated and must NOT be guarded:
    // an apostrophe there would break the wizard's own month matching.
    expect(grid[1]![0]).toBe("Ocak 2026");
    expect(grid[1]![1]).toBe("1,00");
  });

  it("carries a hostile subscription name through a real workbook without evaluating it", async () => {
    const row: SubscriptionRow = {
      name: " =cmd|'/C calc'!A0", amountMinor: -50000, currency: "TRY", amountMode: "fixed",
      cycle: "monthly", intervalMonths: 1, billingDay: 1, nextDueDate: "2026-01-01",
      trialEndDate: "", category: "=1+1", source: "Nakit", person: "", autoPay: false,
      isActive: true, websiteDomain: "", monthlyLoadMinor: -50000,
    };
    const bytes = await composeWorkbook({ years: [], subscriptions: [row], investments: [] });
    const book = XLSX.read(bytes, { type: "array" });
    const sheet = book.Sheets[WORKBOOK_SHEETS.subscriptions]!;
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      // No cell may carry a formula: `f` is what Excel evaluates.
      expect((cell as { f?: string }).f, address).toBeUndefined();
      expect((cell as { t?: string }).t, `${address} must be a string cell`).toBe("s");
    }
    const written = Object.fromEntries(SUBSCRIPTION_COLUMNS.map((c) => [c.header, c.write(row)]));
    expect(written["Abonelik"]).toBe("' =cmd|'/C calc'!A0");
    expect(written["Kategori"]).toBe("'=1+1");
    // A negative amount is app-generated and must NOT have been guarded.
    expect(written["Tutar"]).toBe("-500,00");
  });

  /**
   * The export's own bound, which the JSON backup has always had and this did
   * not. Not a control against an attacker — the only person who can trigger it
   * is the owner — but the same class of failure: an unbounded build that turns
   * a working app into a hung one on the largest workspace.
   */
  it("refuses to build a workbook larger than a phone can hold", async () => {
    const blank: SubscriptionRow = {
      name: "x", amountMinor: 1, currency: "TRY", amountMode: "fixed", cycle: "monthly",
      intervalMonths: 1, billingDay: 1, nextDueDate: "", trialEndDate: "", category: "",
      source: "", person: "", autoPay: false, isActive: true, websiteDomain: "", monthlyLoadMinor: 1,
    };
    await expect(composeWorkbook({
      years: [], subscriptions: Array.from({ length: 25_001 }, () => blank), investments: [],
    })).rejects.toBeInstanceOf(UserFacingError);
    await expect(composeWorkbook({
      years: [], subscriptions: Array.from({ length: 100 }, () => blank), investments: [],
    })).resolves.toBeInstanceOf(Uint8Array);
  }, 30_000);
});
