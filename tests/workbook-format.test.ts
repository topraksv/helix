import { describe, expect, it } from "vitest";
import {
  buildLedgerGrids,
  INVESTMENT_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  WORKBOOK_COLUMNS,
  writeDate,
  writeFlag,
  toInvestmentRow,
  toLedgerTotal,
  toSubscriptionRow,
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

  /**
   * Every column, not a sample of them.
   *
   * The two tests above check the cells a reader would notice first, and
   * mutation testing showed what that misses: replacing a column's accessor
   * with `() => undefined` survived on five of them, because nothing asserted
   * that "Ödeme Günü" reads `billingDay` rather than some other number.
   */
  it("reads its own field in every column", () => {
    const subscriptionCells = SUBSCRIPTION_COLUMNS.map((column) => column.write(subscription));
    expect(subscriptionCells).toEqual([
      "Netflix", "229,99", "TRY", "Sabit", "Aylık", "1", "12", "12.04.2026", "",
      "Abonelik", "Worldcard", "Toprak", "evet", "evet", "netflix.com", "229,99",
    ]);
    // Each number column moves on its own, so none of them can be reading
    // another's field.
    const bySubscriptionHeader = (header: string, row: SubscriptionRow): string =>
      SUBSCRIPTION_COLUMNS.find((column) => column.header === header)!.write(row);
    expect(bySubscriptionHeader("Kaç Ayda Bir", { ...subscription, intervalMonths: 12 })).toBe("12");
    expect(bySubscriptionHeader("Ödeme Günü", { ...subscription, billingDay: 28 })).toBe("28");
    expect(bySubscriptionHeader("Aylık Yük", { ...subscription, monthlyLoadMinor: 1917 })).toBe("19,17");
    expect(bySubscriptionHeader("Aktif", { ...subscription, isActive: false })).toBe("");

    const investmentCells = INVESTMENT_COLUMNS.map((column) => column.write(investment));
    expect(investmentCells).toEqual([
      "Gram Altın", "Metal", "", "01.02.2026", "Alış", "12,5", "4800,00", "60000,00", "",
    ]);
    const byInvestmentHeader = (header: string, row: InvestmentRow): string =>
      INVESTMENT_COLUMNS.find((column) => column.header === header)!.write(row);
    expect(byInvestmentHeader("Birim Fiyat", { ...investment, unitPriceMinor: 111 })).toBe("1,11");
    expect(byInvestmentHeader("Toplam", { ...investment, totalMinor: 222 })).toBe("2,22");
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
    // A date missing any of its three parts is not a date. Written as one it
    // would land in the sheet as "undefined.03.2026".
    expect(writeDate("2026-03"), "no day").toBe("");
    expect(writeDate("2026"), "no month").toBe("");
    expect(writeDate("--"), "nothing at all").toBe("");
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

  it("puts the months in calendar order however they arrive", () => {
    const grid = buildLedgerGrids([
      { item: "Market", month: "2026-03", minor: 300 },
      { item: "Market", month: "2026-01", minor: 100 },
      { item: "Market", month: "2026-02", minor: 200 },
    ], MONTHS)[0]![1];
    // The query orders them, but a grid that trusted that would put a sheet's
    // months in insertion order the day anything else built one.
    expect(grid.slice(1).map((row) => row[0])).toEqual(["Ocak 2026", "Şubat 2026", "Mart 2026"]);
    expect(grid.slice(1).map((row) => row[1])).toEqual(["1,00", "2,00", "3,00"]);
  });

  it("reads a total that arrives as a string, and a missing one as nothing", () => {
    const grid = buildLedgerGrids([
      { item: "Market", month: "2026-01", minor: Number("250") },
    ], MONTHS)[0]![1];
    expect(grid[1]).toEqual(["Ocak 2026", "2,50"]);
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

  /**
   * The step between a query and a sheet.
   *
   * It lived beside the SQL, where no node test could reach it, and the mutation
   * gate reported the file detecting less than it had — which is what a hundred
   * untested lines look like from the outside. Moved here it is ordinary logic
   * with ordinary tests.
   */
  describe("database rows into sheet rows", () => {
    it("reads a subscription row, and does not divide by a missing interval", () => {
      const row = toSubscriptionRow({
        name: "Netflix", amount_minor: 22999, currency: "TRY", amount_mode: "fixed",
        cycle: "monthly", interval_months: 1, billing_day: 12, next_due_date: "2026-04-12",
        trial_end_date: null, category: "Abonelik", source: "Worldcard", person: "Toprak",
        auto_pay: 1, is_active: 1, website_domain: "netflix.com",
      });
      expect(row.name).toBe("Netflix");
      expect(row.autoPay, "SQLite says 1, not true").toBe(true);
      expect(row.trialEndDate, "a null column is an empty cell, never \"null\"").toBe("");
      expect(row.monthlyLoadMinor).toBe(22999);

      // A yearly charge spreads across the year.
      expect(toSubscriptionRow({ amount_minor: 120000, interval_months: 12 }).monthlyLoadMinor).toBe(10000);
      // A missing interval is monthly, not a division by zero.
      expect(toSubscriptionRow({ amount_minor: 12000, interval_months: 0 }).intervalMonths).toBe(1);
      expect(toSubscriptionRow({ amount_minor: 12000, interval_months: null }).monthlyLoadMinor).toBe(12000);
    });

    it("costs one cell, not the whole export, when a stored amount is out of range", () => {
      const row = toSubscriptionRow({ name: "Bozuk", amount_minor: Number.MAX_SAFE_INTEGER, interval_months: 1 });
      expect(row.name, "the row still exports").toBe("Bozuk");
      expect(row.monthlyLoadMinor, "only the derived figure is given up").toBe(0);
    });

    it("reads an investment row with the app's decimal comma", () => {
      const row = toInvestmentRow({
        product: "Gram Altın", asset_type: "metal", market_code: null,
        operation_date: "2026-02-01", kind: "buy", quantity: "12.5",
        unit_price_minor: 480000, total_minor: 6000000, note: null,
      });
      expect(row.quantity, "stored with a dot, read with a comma").toBe("12,5");
      expect(row.marketCode).toBe("");
      expect(row.note).toBe("");
      expect(row.totalMinor).toBe(6000000);
    });

    it("names an uncategorised total instead of leaving the column blank", () => {
      expect(toLedgerTotal({ item: null, month: "2026-01", total: 100 }, "Kategorisiz"))
        .toEqual({ item: "Kategorisiz", month: "2026-01", minor: 100 });
      expect(toLedgerTotal({ item: "Market", month: "2026-01", total: 100 }, "Kategorisiz").item).toBe("Market");
      // A total arriving as a string still counts.
      expect(toLedgerTotal({ item: "Market", month: "2026-01", total: "250" }, "Kategorisiz").minor).toBe(250);
    });
  });
});
