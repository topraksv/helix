import { describe, expect, it } from "vitest";
import {
  categoryMonthMatrix,
  creditCardSplit,
  cumulativeSeries,
  distributionForRange,
  fixedVsVariable,
  normalizedMonthlyLoadMinor,
} from "../src/domain/analytics";
import { tx } from "./helpers";

const TODAY = "2026-07-05";

describe("categoryMonthMatrix + YTD", () => {
  const txs = [
    tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-01-10", categoryId: "kk" }),
    tx({ type: "expense", amountTryMinor: 150_00, effectiveDate: "2026-02-10", categoryId: "kk" }),
    tx({ type: "expense", amountTryMinor: 50_00, effectiveDate: "2026-02-11", categoryId: "market" }),
    tx({ type: "expense", amountTryMinor: 999_00, effectiveDate: "2025-12-31", categoryId: "kk" }), // previous year
    tx({ type: "expense", amountTryMinor: 77_00, effectiveDate: "2026-03-01", categoryId: "kk", personIsSelf: false }), // watch-only person
    tx({ type: "expense", amountTryMinor: 40_00, effectiveDate: "2026-01-15", categoryId: "kk", isAggregate: true }), // bulk history entry
  ];

  it("aggregates per category per month and computes YTD", () => {
    const matrix = categoryMonthMatrix(txs, 2026, TODAY);
    const kk = matrix.get("kk")!;
    expect(kk.monthly.get("2026-01")).toBe(140_00); // includes aggregate rows
    expect(kk.monthly.get("2026-02")).toBe(150_00);
    expect(kk.ytdMinor).toBe(290_00); // excludes other year + non-self
    expect(matrix.get("market")!.ytdMinor).toBe(50_00);
  });

  it("builds cumulative series for the trend chart", () => {
    const matrix = categoryMonthMatrix(txs, 2026, TODAY);
    const series = cumulativeSeries(matrix.get("kk")!, "2026-01", "2026-03");
    expect(series.map((p) => p.cumulativeMinor)).toEqual([140_00, 290_00, 290_00]);
  });

  it("does not count transfer categories as income or expense analytics", () => {
    const matrix = categoryMonthMatrix(
      [tx({ type: "transfer", amountTryMinor: 1_000_00, effectiveDate: "2026-02-10", categoryId: "yatirim" })],
      2026,
      TODAY,
    );
    expect(matrix.has("yatirim")).toBe(false);
  });
});

describe("distributionForRange", () => {
  it("keeps transfers (Yatırım) out of expense distribution", () => {
    const txs = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-05-10", categoryId: "kk" }),
      tx({ type: "transfer", amountTryMinor: 260_000_00, effectiveDate: "2026-05-12", categoryId: "yatirim" }),
      tx({ type: "income", amountTryMinor: 125_000_00, effectiveDate: "2026-05-15" }),
    ];
    const dist = distributionForRange(txs, "2026-05-01", "2026-05-31", TODAY);
    expect(dist.expenseTotalMinor).toBe(100_00);
    expect(dist.expenseByCategory.has("yatirim")).toBe(false);
    expect(dist.transferTotalMinor).toBe(260_000_00);
    expect(dist.incomeTotalMinor).toBe(125_000_00);
  });

  it("keeps legacy categoryless expenses visible and reconciles to the expense total", () => {
    const txs = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-05-10", categoryId: "market" }),
      tx({ type: "expense", amountTryMinor: 25_00, effectiveDate: "2026-05-11", categoryId: null }),
      tx({ type: "transfer", amountTryMinor: 500_00, effectiveDate: "2026-05-12", categoryId: "yatirim" }),
    ];
    const dist = distributionForRange(txs, "2026-05-01", "2026-05-31", TODAY);
    const chartTotal = [...dist.expenseByCategory.values()].reduce((sum, value) => sum + value, 0) + dist.uncategorizedExpenseMinor;
    expect(dist.uncategorizedExpenseMinor).toBe(25_00);
    expect(chartTotal).toBe(dist.expenseTotalMinor);
    expect(dist.expenseTotalMinor).toBe(125_00);
  });
});

describe("fixedVsVariable", () => {
  it("classifies installment/subscription-linked spending as fixed", () => {
    const txs = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-01", installmentPlanId: "p1" }),
      tx({ type: "expense", amountTryMinor: 230_00, effectiveDate: "2026-07-02", subscriptionId: "s1" }),
      tx({ type: "expense", amountTryMinor: 55_00, effectiveDate: "2026-07-03" }),
    ];
    expect(fixedVsVariable(txs, "2026-07-01", "2026-07-31", TODAY)).toEqual({
      fixedMinor: 330_00,
      variableMinor: 55_00,
    });
  });

  it("treats ordinary expenses as variable and excludes non-expense flows", () => {
    const txs = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-01", installmentPlanId: "p1" }),
      tx({ type: "expense", amountTryMinor: 55_00, effectiveDate: "2026-07-02", categoryId: null }),
      tx({ type: "transfer", amountTryMinor: 900_00, effectiveDate: "2026-07-03" }),
      tx({ type: "income", amountTryMinor: 300_00, effectiveDate: "2026-07-04" }),
      tx({ type: "expense", amountTryMinor: 40_00, effectiveDate: "2026-07-20", status: "pending" }),
      tx({ type: "expense", amountTryMinor: 70_00, effectiveDate: "2026-07-02", personIsSelf: false }),
    ];
    const result = fixedVsVariable(txs, "2026-07-01", "2026-07-31", TODAY);
    expect(result).toEqual({ fixedMinor: 100_00, variableMinor: 55_00 });
    expect(result.fixedMinor + result.variableMinor).toBe(
      distributionForRange(txs, "2026-07-01", "2026-07-31", TODAY).expenseTotalMinor,
    );
  });
});

describe("creditCardSplit", () => {
  it("separates single-shot from installment card spending", () => {
    const txs = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-01", paymentSourceId: "card1" }),
      tx({ type: "expense", amountTryMinor: 200_00, effectiveDate: "2026-07-02", paymentSourceId: "card1", installmentPlanId: "p1" }),
      tx({ type: "expense", amountTryMinor: 999_00, effectiveDate: "2026-07-03", paymentSourceId: "cash1" }),
    ];
    expect(creditCardSplit(txs, new Set(["card1"]), "2026-07", TODAY)).toEqual({
      singleMinor: 100_00,
      installmentMinor: 200_00,
    });
  });
});

describe("normalizedMonthlyLoadMinor", () => {
  it("amortizes yearly subscriptions to a monthly load", () => {
    expect(normalizedMonthlyLoadMinor(1200_00, 12)).toBe(100_00);
    expect(normalizedMonthlyLoadMinor(1000_00, 12)).toBe(83_33);
  });
});
