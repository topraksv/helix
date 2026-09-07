import { describe, expect, it } from "vitest";
import {
  buildLedgerGrids,
  INVESTMENT_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  WORKBOOK_COLUMNS,
  writeDate,
  writeFlag,
  writeMoney,
  type InvestmentRow,
  type SubscriptionRow,
  type WorkbookColumn,
} from "../src/domain/workbook-format";

const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

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

describe("workbook format", () => {
  it("writes a subscription row the way a person reads it", () => {
    const cells = Object.fromEntries(SUBSCRIPTION_COLUMNS.map((c) => [c.header, c.write(subscription)]));
    expect(cells["Abonelik"]).toBe("Netflix");
    expect(cells["Tutar"]).toBe("229,99");
    expect(cells["Döngü"]).toBe("Aylık");
    expect(cells["Sonraki Ödeme"]).toBe("12.04.2026");
    expect(cells["Otomatik Ödeme"]).toBe("evet");
    // A cancelled subscription leaves the cell empty rather than saying "hayır":
    // a blank column reads as "none of these" at a glance.
    expect(SUBSCRIPTION_COLUMNS.find((c) => c.header === "Aktif")!.write({ ...subscription, isActive: false })).toBe("");
  });

  it("writes an investment row the way a person reads it", () => {
    const cells = Object.fromEntries(INVESTMENT_COLUMNS.map((c) => [c.header, c.write(investment)]));
    expect(cells["Ürün"]).toBe("Gram Altın");
    expect(cells["Varlık Türü"]).toBe("Metal");
    expect(cells["İşlem"]).toBe("Alış");
    expect(cells["Toplam"]).toBe("60000,00");
    expect(cells["İşlem Tarihi"]).toBe("01.02.2026");
  });

  it("gives every column a heading and a hint, and repeats no heading on a sheet", () => {
    for (const key of Object.keys(WORKBOOK_COLUMNS) as (keyof typeof WORKBOOK_COLUMNS)[]) {
      const columns = WORKBOOK_COLUMNS[key] as WorkbookColumn<unknown>[];
      const headers = columns.map((column) => column.header);
      expect(new Set(headers).size, `${key}: two columns cannot share a heading`).toBe(headers.length);
      for (const column of columns) {
        expect(column.header.trim(), `${key}: an unnamed column`).not.toBe("");
        // The hint is what stops a field arriving undescribed; it is the only
        // statement of the format that sits beside the code implementing it.
        expect(column.hint.trim().length, `${key}/${column.header}: no hint`).toBeGreaterThan(8);
      }
    }
  });

  it("writes money and dates as text in the app's own notation", () => {
    expect(writeMoney(123456)).toBe("1234,56");
    expect(writeMoney(-500)).toBe("-5,00");
    expect(writeMoney(0)).toBe("0,00");
    expect(writeDate("2026-03-15")).toBe("15.03.2026");
    expect(writeDate("")).toBe("");
    expect(writeFlag(true)).toBe("evet");
    expect(writeFlag(false)).toBe("");
  });

  /**
   * The grid is the half of the workbook the app can read back, so its shape is
   * the whole round trip: an empty corner, months down the first column with
   * their year, and one column per category.
   */
  it("pivots monthly totals into one grid per year", () => {
    const grids = buildLedgerGrids([
      { item: "Market", month: "2026-01", minor: 920000 },
      { item: "Maaş", month: "2026-01", minor: 6500000 },
      { item: "Market", month: "2026-02", minor: 880000 },
      { item: "Market", month: "2025-12", minor: 810000 },
    ], MONTHS);

    expect(grids.map(([year]) => year), "a year per sheet, oldest first").toEqual([2025, 2026]);

    const [, grid] = grids[1]!;
    expect(grid[0], "empty corner, then the categories").toEqual(["", "Maaş", "Market"]);
    expect(grid[1]![0]).toBe("Ocak 2026");
    expect(grid[2]![0]).toBe("Şubat 2026");
    expect(grid[1]).toEqual(["Ocak 2026", "65000,00", "9200,00"]);
    // February has no salary, and the cell is blank rather than "0,00" — a zero
    // is a figure the owner never entered.
    expect(grid[2]).toEqual(["Şubat 2026", "", "8800,00"]);
  });

  it("sums a repeated cell instead of losing one of them", () => {
    const grid = buildLedgerGrids([
      { item: "Market", month: "2026-01", minor: 100 },
      { item: "Market", month: "2026-01", minor: 250 },
    ], MONTHS)[0]![1];
    expect(grid[1]).toEqual(["Ocak 2026", "3,50"]);
  });

  it("drops a row whose month is not a month rather than inventing a sheet", () => {
    expect(buildLedgerGrids([{ item: "X", month: "kayıp", minor: 1 }], MONTHS)).toEqual([]);
    expect(buildLedgerGrids([{ item: "X", month: "2026-13", minor: 1 }], MONTHS)).toEqual([]);
  });
});
