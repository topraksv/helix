import { describe, expect, it } from "vitest";
import { distributionForRange, fixedVsVariable } from "../../src/domain/analytics";
import { buildDashboardModel } from "../../src/domain/dashboard";
import { plannedExpectations } from "../../src/domain/expected";
import type { ExpectedPaymentLike, TxLike } from "../../src/domain/types";
import { buildLedger, projectedBalance } from "../../src/domain/balance";
import { projectedTransactionFlow } from "../../src/domain/transactions";
import { tx } from "../helpers";

/** What the ledger hook hands the dashboard, with every amount already TRY. */
const planned = (expected: ExpectedPaymentLike[], transactions: TxLike[], today: string) =>
  plannedExpectations({ expected, transactions, today, toTryMinor: (_currency, amount) => amount, ruleOf: () => undefined });

/** The arguments every case repeats; a case names only what it is about. */
const dashboard = (overrides: Partial<Parameters<typeof buildDashboardModel>[0]>) => buildDashboardModel({
  transactions: [],
  expected: [],
  ledger: [],
  actualBalanceMinor: 0,
  today: "2026-07-18",
  monthStart: "2026-07-01",
  monthEnd: "2026-07-31",
  currentMonth: "2026-07",
  year: 2026,
  plannedExpectations: [],
  ...overrides,
});

describe("dashboard model parity", () => {
  it("matches the prior independent aggregate and forecast rules", () => {
    const today = "2026-07-18" as const;
    const transactions = [
      tx({ id: "fixed", type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-03", installmentPlanId: "plan" }),
      tx({ id: "variable", type: "expense", amountTryMinor: 50_00, effectiveDate: "2026-07-04", categoryId: null }),
      tx({ id: "income", type: "income", amountTryMinor: 500_00, effectiveDate: "2026-07-05" }),
      tx({ id: "future", type: "expense", amountTryMinor: 40_00, effectiveDate: "2026-07-25", status: "pending" }),
    ];
    const expected = [{
      id: "expected", direction: "in" as const, kind: "recurring_income" as const,
      refId: "income-rule", dueDate: "2026-07-28" as const, amountMinor: 200_00,
      currency: "TRY", status: "pending" as const,
    }];
    const model = dashboard({
      transactions,
      expected,
      actualBalanceMinor: 1_000_00,
      today,
      plannedExpectations: planned(expected, transactions, today),
    });

    expect(model.distribution).toEqual(distributionForRange(transactions, "2026-07-01", "2026-07-31", today));
    expect({ fixedMinor: model.fixedMinor, variableMinor: model.variableMinor }).toEqual(
      fixedVsVariable(transactions, "2026-07-01", "2026-07-31", today),
    );
    const legacyFlows = [
      { ...projectedTransactionFlow(transactions[3]!), date: transactions[3]!.effectiveDate },
      { direction: "in" as const, amountTryMinor: 200_00, date: "2026-07-28" as const },
    ];
    expect(model.projectedMinor).toBe(projectedBalance(1_000_00, legacyFlows, "2026-07-31"));
  });

  it("counts one future obligation represented by both transaction and expected rows only once", () => {
    const futureTransaction = tx({
      id: "future-subscription",
      type: "expense",
      amountTryMinor: 125_00,
      effectiveDate: "2026-07-28",
      status: "pending",
      subscriptionId: "electricity",
    });
    const expected: ExpectedPaymentLike[] = [{
      id: "electricity-expected",
      direction: "out",
      kind: "subscription",
      refId: "electricity",
      dueDate: "2026-07-28",
      amountMinor: 125_00,
      currency: "TRY",
      status: "pending",
    }];
    const model = dashboard({
      transactions: [futureTransaction],
      expected,
      actualBalanceMinor: 1_000_00,
      plannedExpectations: planned(expected, [futureTransaction], "2026-07-18"),
    });

    expect(model.outgoingMinor).toBe(125_00);
    expect(model.projectedMinor).toBe(875_00);
  });

  it("does not take a partly paid statement's charges from the month-end balance again", () => {
    const charge = (id: string, statementId: string, amountTryMinor: number) => tx({
      id, type: "expense", amountTryMinor, effectiveDate: "2026-07-28", status: "pending",
      paymentSourceId: "card", cardStatementId: statementId,
    });
    const model = dashboard({
      transactions: [charge("partly-paid", "st-partial", 1_000_00), charge("unpaid", "st-open", 200_00)],
      actualBalanceMinor: 5_000_00,
      partlyPaidStatementIds: new Set(["st-partial"]),
    });

    expect(model.outgoingMinor).toBe(200_00);
    expect(model.projectedMinor).toBe(4_800_00);
  });

  it("counts a card charge still due this month when no statement is partly paid", () => {
    const model = dashboard({
      transactions: [tx({ id: "card", type: "expense", amountTryMinor: 300_00, effectiveDate: "2026-07-28", status: "pending", paymentSourceId: "card", cardStatementId: "st" })],
      actualBalanceMinor: 5_000_00,
    });

    expect(model.outgoingMinor).toBe(300_00);
  });

  it("keeps a workbook remainder to its own month, up to the month's last day", () => {
    const remainder = (id: string, effectiveDate: string, amountTryMinor: number) =>
      tx({ id, type: "expense", amountTryMinor, effectiveDate, categoryId: "kart", isWorkbookRemainder: true });
    const model = dashboard({
      transactions: [remainder("june", "2026-06-30", 70_00), remainder("july", "2026-07-31", 30_00)],
      actualBalanceMinor: 1_000_00,
      today: "2026-07-31",
    });

    expect(model.distribution.workbookRemainderMinor).toBe(-30_00);
  });
});

/** The forecast subtracts the median completed month's variable spending minus this month's so far: median so one outlier is not the norm, no pro-rating because no rhythm is measured. */
describe("expected variable spending", () => {
  const monthly = (month: string, day: string, amount: number, id: string) =>
    tx({ id, type: "expense", amountTryMinor: amount, effectiveDate: `${month}-${day}` as const, categoryId: "market" });

  const buildWith = (transactions: ReturnType<typeof tx>[]) => dashboard({
    transactions,
    actualBalanceMinor: 10_000_00,
    today: "2026-07-10",
  });

  it("estimates what a typical month still has left to spend", () => {
    const history = [
      monthly("2026-01", "05", 1_000_00, "jan"),
      monthly("2026-02", "05", 1_200_00, "feb"),
      monthly("2026-03", "05", 800_00, "mar"),
      monthly("2026-04", "05", 1_100_00, "apr"),
      monthly("2026-05", "05", 900_00, "may"),
      monthly("2026-06", "05", 1_000_00, "jun"),
    ];
    // Median of 800, 900, 1000, 1000, 1100, 1200 is 1000; 300 of it is spent.
    const model = buildWith([...history, monthly("2026-07", "03", 300_00, "jul")]);
    expect(model.expectedVariableMinor).toBe(700_00);
  });

  it("expects nothing more once a month has already cost more than usual", () => {
    const history = [
      monthly("2026-05", "05", 500_00, "may"),
      monthly("2026-06", "05", 500_00, "jun"),
    ];
    const model = buildWith([...history, monthly("2026-07", "03", 900_00, "jul")]);
    expect(model.expectedVariableMinor).toBe(0);
  });

  /**
   * The window's first day is inside it.
   *
   * Six months back from the current one, counted from its FIRST day: a month
   * that only just qualifies still describes what a month costs, and dropping
   * it would quietly make the window five months in every case where the
   * oldest spending happens to fall on the first.
   */
  it("counts a month that begins exactly at the edge of the window", () => {
    const model = buildWith([monthly("2026-01", "01", 800_00, "edge")]);
    expect(model.expectedVariableMinor).toBe(800_00);
  });

  it("claims no estimate at all when no month has completed", () => {
    expect(buildWith([monthly("2026-07", "03", 300_00, "jul")]).expectedVariableMinor).toBeNull();
  });

  it("leaves rule-driven spending out of the estimate", () => {
    const subscription = tx({
      id: "sub", type: "expense", amountTryMinor: 5_000_00,
      effectiveDate: "2026-06-05", subscriptionId: "netflix", categoryId: "market",
    });
    const model = buildWith([subscription, monthly("2026-06", "06", 400_00, "jun")]);
    expect(model.expectedVariableMinor).toBe(400_00);
  });
});

describe("dashboard model boundary contracts", () => {
  const TODAY = "2026-07-18";

  it("distinguishes today from yesterday and the horizon's next day", () => {
    const dueToday: ExpectedPaymentLike[] = [
      { id: "due-today", direction: "in", kind: "recurring_income", refId: "today", dueDate: "2026-07-18", amountMinor: 40, currency: "TRY", status: "pending" },
      { id: "after", direction: "out", kind: "subscription", refId: "after", dueDate: "2026-08-01", amountMinor: 50, currency: "TRY", status: "pending" },
    ];
    const model = dashboard({
      transactions: [
        tx({ id: "yesterday", status: "pending", type: "expense", amountTryMinor: 10, effectiveDate: "2026-07-17", categoryKind: "expense" }),
        tx({ id: "today", status: "pending", type: "expense", amountTryMinor: 20, effectiveDate: "2026-07-18", categoryKind: "expense" }),
        tx({ id: "after", status: "pending", type: "expense", amountTryMinor: 30, effectiveDate: "2026-08-01", categoryKind: "expense" }),
      ],
      expected: dueToday,
      actualBalanceMinor: 100,
      plannedExpectations: plannedExpectations({ expected: dueToday, transactions: [], today: TODAY, toTryMinor: (_currency, amount) => amount, ruleOf: () => undefined }),
    });
    expect(model.lateItems).toEqual([]);
    expect(model.monthEndFlows).toEqual([
      { direction: "out", amountTryMinor: 20, date: "2026-07-18" },
      { direction: "in", amountTryMinor: 40, date: "2026-07-18" },
    ]);
    expect(model.projectedMinor).toBe(120);
  });

  it("includes a realized transaction on the exact month-end boundary", () => {
    const model = dashboard({
      transactions: [
        tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-31", categoryId: "food", categoryKind: "expense" }),
        tx({ type: "expense", amountTryMinor: 9_999, effectiveDate: "2026-08-01", categoryId: "food", categoryKind: "expense" }),
      ],
      actualBalanceMinor: 0, today: "2026-07-31",
    });
    expect(model.distribution.expenseTotalMinor).toBe(100);
    expect(model.distribution.expenseByCategory).toEqual(new Map([["food", 100]]));
  });

  it("excludes realized rows after a historical report window", () => {
    const model = dashboard({
      transactions: [tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2026-08-01", categoryId: "food", categoryKind: "expense" })],
      actualBalanceMinor: 0, today: "2026-08-31",
      currentMonth: "2026-08",
    });
    expect(model.distribution.expenseTotalMinor).toBe(0);
    expect(model.distribution.expenseByCategory).toEqual(new Map());
  });

  it("keeps a missing actual balance null even when a forecast flow exists", () => {
    const model = dashboard({
      transactions: [tx({ type: "income", amountTryMinor: 100, effectiveDate: "2026-07-18", status: "pending", categoryKind: "income" })],
      actualBalanceMinor: null,
    });
    expect(model.projectedMinor).toBeNull();
  });

  it("asserts every output collection, total, boundary, fallback, and trend filter directly", () => {
    const transactions = [
      tx({ id: "fixed", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-01", categoryId: "food", categoryKind: "expense", installmentPlanId: "plan" }),
      tx({ id: "variable", type: "expense", amountTryMinor: 200, effectiveDate: "2026-07-18", categoryId: null, categoryKind: "expense" }),
      tx({ id: "transfer", type: "transfer", amountTryMinor: 300, effectiveDate: "2026-07-10", categoryId: "invest", categoryKind: "expense" }),
      tx({ id: "income", type: "income", amountTryMinor: 400, effectiveDate: "2026-07-10", categoryId: "salary", categoryKind: "income" }),
      tx({ id: "pending-today", type: "income", amountTryMinor: 500, effectiveDate: "2026-07-18", status: "pending", categoryKind: "income" }),
      tx({ id: "pending-end", type: "expense", amountTryMinor: 600, effectiveDate: "2026-07-31", status: "pending", categoryKind: "expense" }),
      tx({ id: "pending-after", type: "expense", amountTryMinor: 9_999, effectiveDate: "2026-08-01", status: "pending", categoryKind: "expense" }),
      tx({ id: "watched", type: "expense", amountTryMinor: 9_999, effectiveDate: "2026-07-10", personIsSelf: false, categoryKind: "expense" }),
    ];
    const expected = [
      { id: "pending", direction: "in" as const, kind: "recurring_income" as const, refId: "r", dueDate: "2026-07-31", amountMinor: 700, currency: "TRY", status: "pending" as const },
      { id: "past-pending", direction: "out" as const, kind: "subscription" as const, refId: "s", dueDate: "2026-07-17", amountMinor: 800, currency: "TRY", status: "pending" as const },
      { id: "late-future", direction: "out" as const, kind: "subscription" as const, refId: "l", dueDate: "2026-07-20", amountMinor: 900, currency: "EUR", status: "late" as const },
      { id: "paid", direction: "out" as const, kind: "subscription" as const, refId: "p", dueDate: "2026-07-20", amountMinor: 999, currency: "TRY", status: "paid" as const },
    ];
    const ledger = buildLedger({ openingBalanceMinor: 1_000, startMonth: "2025-12", endMonth: "2026-08", transactions: [], adjustments: [], today: TODAY });
    const model = dashboard({
      transactions, expected, ledger, actualBalanceMinor: 1_000,
      plannedExpectations: plannedExpectations({ expected, transactions, today: TODAY, toTryMinor: (currency, amount) => currency === "TRY" ? amount : null, ruleOf: () => undefined }),
    });

    expect(model.pendingItems.map((item) => item.id)).toEqual(["pending", "past-pending", "late-future"]);
    expect(model.lateItems.map((item) => item.id)).toEqual(["past-pending", "late-future"]);
    expect(model.monthEndFlows).toEqual([
      { direction: "in", amountTryMinor: 500, date: "2026-07-18" },
      { direction: "out", amountTryMinor: 600, date: "2026-07-31" },
      { direction: "in", amountTryMinor: 700, date: "2026-07-31" },
    ]);
    expect({ incomingMinor: model.incomingMinor, outgoingMinor: model.outgoingMinor, projectedMinor: model.projectedMinor })
      .toEqual({ incomingMinor: 1_200, outgoingMinor: 600, projectedMinor: 1_600 });
    expect(model.distribution).toEqual({
      expenseByCategory: new Map([["food", 100]]), uncategorizedExpenseMinor: 200,
      expenseTotalMinor: 300, transferTotalMinor: 300, incomeTotalMinor: 400, workbookRemainderMinor: 0,
    });
    expect({ fixedMinor: model.fixedMinor, variableMinor: model.variableMinor }).toEqual({ fixedMinor: 100, variableMinor: 200 });
    expect(model.trendMonths.map((month) => month.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
  });
});
