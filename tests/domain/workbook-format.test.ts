import { describe, expect, it } from "vitest";
import { tr } from "../../src/i18n/tr";
import {
  buildLedgerGrids,
  INVESTMENT_COLUMNS,
  INVESTMENT_HEADERS,
  quantityKey,
  readDate,
  readInvestmentSheet,
  readMoney,
  readSubscriptionSheet,
  recordKey,
  SUBSCRIPTION_COLUMNS,
  SUBSCRIPTION_HEADERS,
  WORKBOOK_COLUMNS,
  writeDate,
  writeFlag,
  toInvestmentRow,
  toLedgerInstalment,
  toLedgerTotal,
  toSubscriptionRow,
  writeMoney,
  type InvestmentRow,
  type LedgerInstalment,
  type SubscriptionRow,
  type WorkbookColumn,
} from "../../src/domain/workbook-format";

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
    expect(cells["Varlık Türü"]).toBe(tr.investments.types.metal);
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
      "Netflix", "229,99", "TRY", "Sabit", tr.subs.monthly, "1", "12", "12.04.2026", "",
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
      "Gram Altın", tr.investments.types.metal, "", "01.02.2026", "Alış", "12,5", "4800,00", "60000,00", "",
    ]);
    const byInvestmentHeader = (header: string, row: InvestmentRow): string =>
      INVESTMENT_COLUMNS.find((column) => column.header === header)!.write(row);
    expect(byInvestmentHeader("Birim Fiyat", { ...investment, unitPriceMinor: 111 })).toBe("1,11");
    expect(byInvestmentHeader("Toplam", { ...investment, totalMinor: 222 })).toBe("2,22");
  });

  /**
   * One vocabulary, not two.
   *
   * This file once wrote "Metal", "Hisse" and "Emeklilik" while every screen in
   * the app said "Kıymetli Maden", "Borsa" and "BES" — a workbook naming a
   * holding differently from the screen it came from, which leaves the owner to
   * reconcile two names for one thing. `knip` found the unused export that hid
   * it; this keeps it found.
   */
  it("names an asset type and a cycle the way the app names them", () => {
    const assetColumn = INVESTMENT_COLUMNS.find((column) => column.header === "Varlık Türü")!;
    for (const [stored, label] of Object.entries(tr.investments.types)) {
      expect(assetColumn.write({ ...investment, assetType: stored }), stored).toBe(label);
    }
    const cycleColumn = SUBSCRIPTION_COLUMNS.find((column) => column.header === "Döngü")!;
    expect(cycleColumn.write({ ...subscription, cycle: "yearly" })).toBe(tr.subs.yearly);
    expect(cycleColumn.write({ ...subscription, cycle: "custom" })).toBe(tr.subs.custom);
    // An unrecognised value passes through rather than becoming blank: a cell
    // the owner can see is worth more than a cell that lost its answer.
    expect(cycleColumn.write({ ...subscription, cycle: "zart" })).toBe("zart");
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
    expect(writeDate("-03-05"), "no year").toBe("");
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
    ]);

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
    ])[0]![1];
    // The query orders them, but a grid that trusted that would put a sheet's
    // months in insertion order the day anything else built one.
    expect(grid.slice(1).map((row) => row[0])).toEqual(["Ocak 2026", "Şubat 2026", "Mart 2026"]);
    expect(grid.slice(1).map((row) => row[1])).toEqual(["1,00", "2,00", "3,00"]);
  });

  it("reads a total that arrives as a string, and a missing one as nothing", () => {
    const grid = buildLedgerGrids([
      { item: "Market", month: "2026-01", minor: Number("250") },
    ])[0]![1];
    expect(grid[1]).toEqual(["Ocak 2026", "2,50"]);
  });

  it("sums a repeated cell instead of losing one of them", () => {
    const grid = buildLedgerGrids([
      { item: "Market", month: "2026-01", minor: 100 },
      { item: "Market", month: "2026-01", minor: 250 },
    ])[0]![1];
    expect(grid[1]).toEqual(["Ocak 2026", "3,50"]);
  });

  it("drops a row whose month is not a month rather than inventing a sheet", () => {
    expect(buildLedgerGrids([{ item: "X", month: "kayıp", minor: 1 }])).toEqual([]);
    expect(buildLedgerGrids([{ item: "X", month: "2026-13", minor: 1 }])).toEqual([]);
  });

  /**
   * A card plan rides in its cells' notes, which the importer rebuilds plans
   * from — and it writes a plan's WHOLE schedule from any month's note, so a
   * plan that is not whole in the ledger stays in its totals.
   */
  describe("card plans in cell notes", () => {
    const instalments = (planId: string, overrides: Partial<LedgerInstalment> = {}): LedgerInstalment[] =>
      ["2026-01", "2026-02"].map((month, index) => ({
        planId, item: "Kart", month, card: "Bonus", title: "Telefon", instalmentNo: index + 1, count: 2, monthlyMinor: 150000, ...overrides,
      }));
    const cells = (kart: number, february = kart) => [
      { item: "Kart", month: "2026-01", minor: kart },
      { item: "Kart", month: "2026-02", minor: february },
      { item: "Market", month: "2026-01", minor: 100 },
      { item: "Market", month: "2026-02", minor: 100 },
    ];
    const notesOf = (rows: LedgerInstalment[], ledger = cells(150000)) => buildLedgerGrids(ledger, rows)[0]![2];
    const plan = instalments("a");

    it("writes each month's instalments under their card, cards in order", () => {
      expect(notesOf([...plan, ...instalments("b", { card: "Axess", title: "Buzdolabı\n  yeni", monthlyMinor: 100000 })], cells(250000))).toEqual([
        [1, 1, "═══ Axess ═══\nBuzdolabı yeni  1000,00  1/2\n═══ Bonus ═══\nTelefon  1500,00  1/2"],
        [2, 1, "═══ Axess ═══\nBuzdolabı yeni  1000,00  2/2\n═══ Bonus ═══\nTelefon  1500,00  2/2"],
      ]);
    });

    it("leaves out a plan that is not whole in the ledger", () => {
      expect(notesOf(plan), "the whole plan, for contrast").toHaveLength(2);
      expect(notesOf(plan.slice(1)), "an instalment missing").toEqual([]);
      expect(notesOf([...plan, plan[1]!], cells(150000, 300000)), "an instalment twice").toEqual([]);
      expect(notesOf(plan.map((row) => ({ ...row, instalmentNo: 1, month: "2026-01", monthlyMinor: 75000 }))), "one number for both").toEqual([]);
      expect(notesOf(plan.map((row) => ({ ...row, instalmentNo: row.instalmentNo + 1 }))), "numbers past its count").toEqual([]);
      expect(notesOf(plan.map((row) => ({ ...row, instalmentNo: row.instalmentNo - 1 }))), "numbers before its first").toEqual([]);
      expect(notesOf(plan.map((row, index) => ({ ...row, instalmentNo: 2 - index }))), "off its schedule").toEqual([]);
      expect(notesOf(plan.map((row, index) => (index === 1 ? { ...row, item: "Market", monthlyMinor: 100 } : row))), "over two columns").toEqual([]);
      expect(notesOf(plan, cells(150000, 0)), "over a cell netting to zero").toEqual([]);
      expect(notesOf(plan, cells(150000).filter((cell) => cell.month !== "2026-02" || cell.item !== "Kart")), "over a cell with no figure").toEqual([]);
    });

    it("leaves out a plan whose cells hold more than plans, and one sharing a cell with a plan left out", () => {
      expect(notesOf(plan, cells(150100)), "spending beside the plan").toEqual([]);
      // Plan b misses February, so January's cell holds an instalment nothing explains.
      expect(notesOf([...plan, ...instalments("b", { monthlyMinor: 100 }).slice(0, 1)], cells(150100, 150000))).toEqual([]);
    });

    it("keeps a plan whose cells differ from it only by its rounding kuruş", () => {
      expect(notesOf(plan, cells(150001, 149999))).toHaveLength(2);
      expect(notesOf(plan, cells(150001, 149998))).toEqual([]);
    });

    it("reads a plan row, billing a total's later share every month", () => {
      const row = { plan_id: "p", item: null, month: "2026-01", card: "Bonus", title: "Telefon", installment_no: 1, installment_count: 3 };
      expect(toLedgerInstalment({ ...row, total_amount_minor: 100000, monthly_amount_minor: null }, "Kalemsiz")).toEqual({
        planId: "p", item: "Kalemsiz", month: "2026-01", card: "Bonus", title: "Telefon", instalmentNo: 1, count: 3, monthlyMinor: 33333,
      });
      expect(toLedgerInstalment({ ...row, total_amount_minor: null, monthly_amount_minor: 25000 }, "Kalemsiz").monthlyMinor).toBe(25000);
    });
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

/**
 * The record sheets come back (owner decision, 2026-09-14): what the writer
 * puts in a cell is what the reader takes out, and what a spreadsheet does to
 * a retyped cell is still read rather than refused.
 */
describe("reading the record sheets back", () => {
  const sheetOf = <Row>(columns: WorkbookColumn<Row>[], rows: Row[]): string[][] =>
    [columns.map((column) => column.header), ...rows.map((row) => columns.map((column) => column.write(row)))];

  it("reads back every subscription field it writes", () => {
    const yearly: SubscriptionRow = {
      ...subscription, name: "Spotify", currency: "USD", amountMode: "variable", cycle: "yearly", intervalMonths: 12,
      trialEndDate: "2026-05-01", autoPay: false, isActive: false, websiteDomain: "",
    };
    expect(readSubscriptionSheet(sheetOf(SUBSCRIPTION_COLUMNS, [subscription, yearly]))).toEqual({
      problems: [],
      records: [
        {
          row: 2, name: "Netflix", amountMinor: 22999, currency: "TRY", amountMode: "fixed", cycle: "monthly", intervalMonths: 1,
          billingDay: 12, nextDueDate: "2026-04-12", trialEndDate: null, category: "Abonelik", source: "Worldcard",
          person: "Toprak", autoPay: true, isActive: true, websiteDomain: "netflix.com",
        },
        {
          row: 3, name: "Spotify", amountMinor: 22999, currency: "USD", amountMode: "variable", cycle: "yearly", intervalMonths: 12,
          billingDay: 12, nextDueDate: "2026-04-12", trialEndDate: "2026-05-01", category: "Abonelik", source: "Worldcard",
          person: "Toprak", autoPay: false, isActive: false, websiteDomain: "",
        },
      ],
    });
  });

  it("reads back every investment field it writes, and an amount-only contribution as one", () => {
    const contribution: InvestmentRow = {
      product: "BES", assetType: "pension", marketCode: "", operationDate: "2026-03-05",
      kind: "contribution", quantity: "", unitPriceMinor: 0, totalMinor: 150000, note: "Mart katkısı",
    };
    expect(readInvestmentSheet(sheetOf(INVESTMENT_COLUMNS, [{ ...investment, marketCode: "XAU" }, contribution]))).toEqual({
      problems: [],
      records: [
        { row: 2, product: "Gram Altın", assetType: "metal", marketCode: "XAU", operationDate: "2026-02-01", kind: "buy", quantity: "12.5", unitPriceMinor: 480000, totalMinor: 6000000, note: "" },
        { row: 3, product: "BES", assetType: "pension", marketCode: "", operationDate: "2026-03-05", kind: "contribution", quantity: null, unitPriceMinor: null, totalMinor: 150000, note: "Mart katkısı" },
      ],
    });
  });

  it("reads what a spreadsheet makes of a retyped cell, and a column moved or deleted", () => {
    const read = readSubscriptionSheet([
      ["Döngü", "Tutar", "Abonelik", "Sonraki Ödeme", "Ödeme Günü", "Otomatik Ödeme"],
      ["yıllık", "1234.5", "'=Oyun", "2026-06-01", "3", "EVET"],
    ]);
    expect(read?.problems).toEqual([]);
    expect(read?.records).toEqual([{
      row: 2, name: "=Oyun", amountMinor: 123450, currency: "TRY", amountMode: "fixed", cycle: "yearly", intervalMonths: 12,
      billingDay: 3, nextDueDate: "2026-06-01", trialEndDate: null, category: "", source: "", person: "",
      autoPay: true, isActive: true, websiteDomain: "",
    }]);
  });

  it("names the row and heading of a cell that does not read, and passes over a blank row", () => {
    const grid = sheetOf(SUBSCRIPTION_COLUMNS, [subscription, subscription, subscription, subscription]);
    const heading = (header: string) => grid[0]!.indexOf(header);
    grid[1]![heading("Sonraki Ödeme")] = "31.02.2026";
    grid[2] = grid[2]!.map(() => " ");
    grid[3]![heading("Aktif")] = "belki";
    const read = readSubscriptionSheet(grid);
    expect(read?.problems).toEqual([
      { sheet: "Abonelikler", row: 2, column: "Sonraki Ödeme" },
      { sheet: "Abonelikler", row: 4, column: "Aktif" },
    ]);
    expect(read?.records.map((record) => record.row)).toEqual([5]);

    const investments = sheetOf(INVESTMENT_COLUMNS, [investment, investment, investment]);
    investments[1]![investments[0]!.indexOf("Adet")] = "on iki";
    investments[2]![investments[0]!.indexOf("Varlık Türü")] = "Arsa";
    expect(readInvestmentSheet(investments)?.problems).toEqual([
      { sheet: "Yatırımlar", row: 2, column: "Adet" },
      { sheet: "Yatırımlar", row: 3, column: "Varlık Türü" },
    ]);
  });

  it("does not claim a sheet whose headings are not its own", () => {
    expect(readSubscriptionSheet([["", "Maaş", "Kira"], ["Ocak 2026", "1", "2"]])).toBeNull();
    expect(readInvestmentSheet([["Altın", "Dolar"], ["24gr", "760$"]])).toBeNull();
    expect(readSubscriptionSheet([])).toBeNull();
  });

  it("reads money, days and keys the way a person writes them", () => {
    expect(readMoney("1.234,56")).toBe(123456);
    expect(readMoney("-5,00")).toBe(-500);
    expect(readMoney("12.345")).toBe(1234500);
    expect(readMoney("on lira")).toBeUndefined();
    expect(readDate("5.3.2026")).toBe("2026-03-05");
    expect(readDate("2026-03-05")).toBe("2026-03-05");
    expect(readDate("30.02.2026")).toBeUndefined();
    expect(recordKey(" Netflix ", "monthly")).toBe(recordKey("NETFLIX", "Monthly"));
    expect(recordKey("Netflix", "monthly")).not.toBe(recordKey("Netflix", "yearly"));
    expect(quantityKey("12,50")).toBe(quantityKey("12.5"));
    expect(quantityKey(null)).toBe("");
    expect(quantityKey(" ")).toBe("");
    expect(quantityKey("12,50")).toBe("12.5");
    expect(readMoney("12.34")).toBe(1234);
    expect(recordKey("Netflix", null)).toBe(recordKey("Netflix", ""));
    expect(recordKey("ab", "c")).not.toBe(recordKey("a", "bc"));
  });

  it("reads each cell trimmed once, a short row as blank, and a sheet only with every heading it needs", () => {
    const S = SUBSCRIPTION_HEADERS;
    const read = readSubscriptionSheet([
      [` ${S.name} `, S.amount, S.cycle, S.billingDay, S.nextDue, S.category, S.active],
      // A formula guard with a space after it, a decimal dot, and no cell at all under Aktif.
      ["' =Oyun", " 12.34 ", ` ${tr.subs.monthly} `, " 7 ", " 5.3.2026 ", "' +Özel"],
    ]);
    expect(read).toEqual({
      problems: [],
      records: [{
        row: 2, name: "=Oyun", amountMinor: 1234, currency: "TRY", amountMode: "fixed", cycle: "monthly", intervalMonths: 1,
        billingDay: 7, nextDueDate: "2026-03-05", trialEndDate: null, category: "+Özel", source: "", person: "",
        autoPay: false, isActive: false, websiteDomain: "",
      }],
    });
    expect(readSubscriptionSheet([[S.name, S.amount], ["Oyun", "1,00"]])).toBeNull();
  });

  it("reads a day, a whole number and a quantity only when the whole cell is one", () => {
    const S = SUBSCRIPTION_HEADERS;
    const row = (billingDay: string, nextDue: string) => ["Oyun", "1,00", tr.subs.monthly, billingDay, nextDue];
    expect(readSubscriptionSheet([
      [S.name, S.amount, S.cycle, S.billingDay, S.nextDue],
      row("a3", "05.03.2026"), row("3a", "05.03.2026"), row("3", "x5.3.2026"), row("3", "5.3.20261"),
    ])?.problems).toEqual([
      { sheet: "Abonelikler", row: 2, column: S.billingDay },
      { sheet: "Abonelikler", row: 3, column: S.billingDay },
      { sheet: "Abonelikler", row: 4, column: S.nextDue },
      { sheet: "Abonelikler", row: 5, column: S.nextDue },
    ]);

    const I = INVESTMENT_HEADERS;
    const metal = tr.investments.types.metal;
    const sheet = readInvestmentSheet([
      [I.product, I.assetType, I.kind, I.date, I.quantity, I.unitPrice, I.total],
      ["Altın", metal, "Alış", "01.02.2026", "12,50", "100,00", "1250,00"],
      ["Altın", metal, "Alış", "01.02.2026", "7", "", "700,00"],
      // No quantity but a price is a price, not an amount-only contribution.
      ["Altın", metal, "Alış", "01.02.2026", "", "100,00", "100,00"],
      ["Altın", metal, "Alış", "01.02.2026", "2", "0,00", "0,00"],
      ["Altın", metal, "Alış", "01.02.2026", "a1", "", ""],
      ["Altın", metal, "Alış", "01.02.2026", "1a", "", ""],
    ]);
    expect(sheet?.records.map((record) => [record.quantity, record.unitPriceMinor, record.totalMinor])).toEqual([
      ["12.50", 10000, 125000],
      ["7", null, 70000],
      [null, 10000, 10000],
      ["2", 0, 0],
    ]);
    expect(sheet?.problems).toEqual([
      { sheet: "Yatırımlar", row: 6, column: I.quantity },
      { sheet: "Yatırımlar", row: 7, column: I.quantity },
    ]);
  });
});
