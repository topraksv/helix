import { describe, expect, it } from "vitest";
import { buildCashFlowMatrixModel } from "../src/domain/cash-flow-matrix";
import { buildLedger, monthFlowTotals } from "../src/domain/balance";
import { tx } from "./helpers";

describe("cash-flow matrix model", () => {
  it("keeps category, computed, system and missing-category values in parity", () => {
    const transactions = [
      tx({ id: "a", type: "expense", categoryId: "food", amountTryMinor: 100_00, effectiveDate: "2026-01-05" }),
      tx({ id: "b", type: "expense", categoryId: "deleted", amountTryMinor: 25_00, effectiveDate: "2026-01-06" }),
    ];
    const ledger = buildLedger({
      openingBalanceMinor: 1_000_00,
      startMonth: "2026-01",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-12-31",
    });
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: [{ id: "food", name: "Market" }],
      computedColumns: [{
        id: "sum", name: "Toplam", definition: JSON.stringify({ op: "sum", categoryIds: ["food"] }),
      }],
      transactions,
      creditCardIds: new Set(),
      liveCategoryIds: new Set(["food"]),
      today: "2026-12-31",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });

    expect(model.months).toHaveLength(12);
    expect(model.columns.map((column) => column.key)).toEqual(["food", "sum", "opening", "closing"]);
    expect(model.columns[0]?.values.get("2026-01")).toBe(100_00);
    expect(model.columns[1]?.values.get("2026-01")).toBe(100_00);
    expect(model.columns[3]?.values.get("2026-01")).toBe(875_00);
    expect(model.uncategorizedTotal).toBe(25_00);
  });

  // A computed column reads `byCategory` AND the month's income/expense. The
  // first already carried planned rows and the second did not, so "Net Akış"
  // printed 0 in a future month whose Market cell, one column to the left in
  // the same row, showed the planned 500,00.
  it("evaluates a computed column against the same rows the cells show", () => {
    const transactions = [
      tx({ id: "planned", type: "expense", categoryId: "food", amountTryMinor: 500_00, effectiveDate: "2026-09-10", status: "pending" }),
    ];
    const ledger = buildLedger({
      openingBalanceMinor: 1_000_00,
      startMonth: "2026-07",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-07-25",
      includePendingInCells: true,
    });
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: [{ id: "food", name: "Market" }],
      computedColumns: [{
        id: "net", name: "Net Akış", definition: JSON.stringify({ op: "income_minus_expense" }),
      }],
      transactions,
      creditCardIds: new Set(),
      liveCategoryIds: new Set(["food"]),
      today: "2026-07-25",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });

    const categoryCell = model.columns[0]?.values.get("2026-09");
    const computedCell = model.columns[1]?.values.get("2026-09");
    expect(categoryCell).toBe(500_00);
    expect(computedCell).toBe(-500_00);
    // The row has to add up ON ITS OWN FACE. This assertion used to say the
    // balance columns "stay on the realized chain" — which is exactly the
    // defect: the Market cell one column to the left showed the planned
    // 500,00 while the balance column repeated Ay Başı unchanged, and the month card a
    // tap away reported the difference. Opening + every cell = closing, in
    // every month, whatever the rows in it are waiting on.
    const opening = model.columns[2]?.values.get("2026-09");
    const closing = model.columns[3]?.values.get("2026-09");
    expect(opening).toBe(1_000_00);
    expect(closing).toBe(500_00);
    expect(closing).toBe((opening ?? 0) - (categoryCell ?? 0));
  });

  // The grid and the month card are one tap apart and used to disagree by the
  // whole planned amount. They read the same accessor now; this is the guard.
  it("agrees with the month card on opening and closing, month for month", () => {
    const transactions = [
      tx({ id: "realized", type: "income", categoryId: "salary", amountTryMinor: 10_000_00, effectiveDate: "2026-07-10", status: "realized" }),
      tx({ id: "planned-out", type: "expense", categoryId: "food", amountTryMinor: 3_000_00, effectiveDate: "2026-10-11", status: "pending" }),
      tx({ id: "planned-in", type: "income", categoryId: "salary", amountTryMinor: 30_000_00, effectiveDate: "2026-10-10", status: "pending" }),
    ];
    const ledger = buildLedger({
      openingBalanceMinor: 0,
      startMonth: "2026-07",
      endMonth: "2026-12",
      transactions,
      adjustments: [],
      today: "2026-08-23",
      includePendingInCells: true,
    });
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: [{ id: "food", name: "Market" }, { id: "salary", name: "Maaş" }],
      computedColumns: [],
      transactions,
      creditCardIds: new Set(),
      liveCategoryIds: new Set(["food", "salary"]),
      today: "2026-08-23",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });

    const opening = model.columns.find((c) => c.key === "opening");
    const closing = model.columns.find((c) => c.key === "closing");
    for (const month of ledger) {
      const card = monthFlowTotals(month);
      expect(opening?.values.get(month.month), month.month).toBe(card.openingMinor);
      expect(closing?.values.get(month.month), month.month).toBe(card.closingMinor);
    }
    // October carries +30.000 and −3.000 of planned flow: the closing must move.
    expect(closing?.values.get("2026-09")).toBe(10_000_00);
    expect(closing?.values.get("2026-10")).toBe(37_000_00);
  });

  /**
   * A workspace that starts in July has no January. The grid drew all twelve
   * months regardless, so its first year opened on six blank rows — and a
   * blank row in a ledger reads as lost data, not as a month that never was.
   */
  it("drops the months before the workspace existed, and only those", () => {
    const ledger = buildLedger({
      openingBalanceMinor: 0,
      startMonth: "2026-07",
      endMonth: "2026-12",
      transactions: [],
      adjustments: [],
      today: "2026-08-23",
      includePendingInCells: true,
    });
    const model = (startMonth?: string) => buildCashFlowMatrixModel({
      year: 2026,
      yearMonths: ledger,
      categories: [],
      computedColumns: [],
      transactions: [],
      creditCardIds: new Set(),
      liveCategoryIds: new Set(),
      today: "2026-08-23",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
      startMonth: startMonth as never,
    });

    expect(model("2026-07").months.map((m) => m.month))
      .toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    // Later years keep every month: the workspace covers all of them.
    expect(model("2025-03").months).toHaveLength(12);
    // Unspecified start is the old behaviour, so no caller silently changes.
    expect(model(undefined).months).toHaveLength(12);
  });

  /**
   * A year entirely before the workspace start would otherwise render a table
   * with no rows at all. The screen has its own empty-year state; the model
   * must reach it rather than produce a headless grid.
   */
  it("keeps a full year when every month of it precedes the start", () => {
    const model = buildCashFlowMatrixModel({
      year: 2024,
      yearMonths: [],
      categories: [],
      computedColumns: [],
      transactions: [],
      creditCardIds: new Set(),
      liveCategoryIds: new Set(),
      today: "2026-08-23",
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
      startMonth: "2026-07" as never,
    });
    expect(model.months).toHaveLength(12);
  });
});
