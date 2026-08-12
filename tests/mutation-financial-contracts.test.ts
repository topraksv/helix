import { describe, expect, it } from "vitest";
import {
  categoryRangeMatrix,
  creditCardSplitsByMonth,
  distributionForRange,
  fixedVsVariable,
  normalizedMonthlyLoadMinor,
} from "../src/domain/analytics";
import { buildLedger } from "../src/domain/balance";
import {
  isCardCycleDayConflict,
  isValidCardCycle,
  statementForDueDate,
  statementForPurchase,
  statementPeriod,
} from "../src/domain/card-statements";
import { buildCashFlowMatrixModel } from "../src/domain/cash-flow-matrix";
import { buildDashboardModel } from "../src/domain/dashboard";
import { tx } from "./helpers";

const TODAY = "2026-07-18";

describe("mutation-sensitive analytics contracts", () => {
  const rows = [
    tx({ id: "start", type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-01", categoryId: "food", categoryKind: "expense" }),
    tx({ id: "end", type: "expense", amountTryMinor: 200, effectiveDate: "2026-07-31", categoryId: "food", categoryKind: "expense", installmentPlanId: "plan" }),
    tx({ id: "before", type: "expense", amountTryMinor: 1_000, effectiveDate: "2026-06-30", categoryId: "food", categoryKind: "expense" }),
    tx({ id: "after", type: "expense", amountTryMinor: 2_000, effectiveDate: "2026-08-01", categoryId: "food", categoryKind: "expense" }),
    tx({ id: "transfer", type: "transfer", amountTryMinor: 300, effectiveDate: "2026-07-10", categoryId: "invest", categoryKind: "expense" }),
    tx({ id: "income", type: "income", amountTryMinor: 400, effectiveDate: "2026-07-10", categoryId: "salary", categoryKind: "income" }),
  ];

  it("includes both range endpoints and keeps each flow class exact", () => {
    expect([...categoryRangeMatrix(rows, "2026-07", "2026-07", "2026-12-31").entries()]).toEqual([
      ["food", { categoryId: "food", monthly: new Map([["2026-07", 300]]), ytdMinor: 300 }],
      ["salary", { categoryId: "salary", monthly: new Map([["2026-07", 400]]), ytdMinor: 400 }],
    ]);
    expect(distributionForRange(rows, "2026-07-01", "2026-07-31", "2026-12-31")).toEqual({
      expenseByCategory: new Map([["food", 300]]),
      uncategorizedExpenseMinor: 0,
      expenseTotalMinor: 300,
      transferTotalMinor: 300,
      incomeTotalMinor: 400,
    });
    expect(fixedVsVariable(rows, "2026-07-01", "2026-07-31", "2026-12-31"))
      .toEqual({ fixedMinor: 200, variableMinor: 100 });
  });

  it("separates single and installment card rows and pins interval fallback", () => {
    const cardRows = [
      tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-01", paymentSourceId: "card", categoryKind: "expense" }),
      tx({ type: "expense", amountTryMinor: 200, effectiveDate: "2026-07-02", paymentSourceId: "card", installmentPlanId: "plan", categoryKind: "expense" }),
      tx({ type: "income", amountTryMinor: 999, effectiveDate: "2026-07-03", paymentSourceId: "card", categoryKind: "income" }),
    ];
    expect(creditCardSplitsByMonth(cardRows, new Set(["card"]), "2026-12-31"))
      .toEqual(new Map([["2026-07", { singleMinor: 100, installmentMinor: 200 }]]));
    expect(normalizedMonthlyLoadMinor(101, 1)).toBe(101);
    expect(normalizedMonthlyLoadMinor(101, 0)).toBe(101);
    expect(normalizedMonthlyLoadMinor(101, 2)).toBe(51);
  });
});

describe("mutation-sensitive card-cycle contracts", () => {
  it("accepts exact day bounds and rejects fractional or missing fields", () => {
    expect(isValidCardCycle({ statementDay: 1, dueDay: 31 })).toBe(true);
    expect(isValidCardCycle({ statementDay: 31, dueDay: 1 })).toBe(true);
    expect(isValidCardCycle({ statementDay: 1.5, dueDay: 2 })).toBe(false);
    expect(isValidCardCycle({ statementDay: 2, dueDay: undefined })).toBe(false);
    expect(isValidCardCycle({ statementDay: 2, dueDay: 32 })).toBe(false);
    expect(() => statementPeriod("2026-07", { statementDay: 0, dueDay: 1 })).toThrow("Invalid credit-card cycle");
  });

  it("pins equal-day, later-day, purchase, and due-date boundaries", () => {
    expect(statementPeriod("2026-07", { statementDay: 15, dueDay: 15 })).toEqual({
      periodMonth: "2026-07", statementDate: "2026-07-15", dueDate: "2026-08-15",
    });
    expect(statementPeriod("2026-07", { statementDay: 15, dueDay: 16 }).dueDate).toBe("2026-07-16");
    expect(statementForPurchase("2026-07-15", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-07");
    expect(statementForPurchase("2026-07-16", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-08");
    expect(statementForDueDate("2026-07-16", { statementDay: 15, dueDay: 16 }).periodMonth).toBe("2026-07");
    expect(statementForDueDate("2026-07-15", { statementDay: 15, dueDay: 15 }).periodMonth).toBe("2026-06");
    expect(isCardCycleDayConflict(null, null)).toBe(false);
    expect(isCardCycleDayConflict(null, 1)).toBe(false);
    expect(isCardCycleDayConflict(1, null)).toBe(false);
    expect(isCardCycleDayConflict(1, 1)).toBe(true);
  });
});

describe("mutation-sensitive dashboard contract", () => {
  it("distinguishes today from yesterday and the horizon's next day", () => {
    const model = buildDashboardModel({
      transactions: [
        tx({ id: "yesterday", status: "pending", type: "expense", amountTryMinor: 10, effectiveDate: "2026-07-17", categoryKind: "expense" }),
        tx({ id: "today", status: "pending", type: "expense", amountTryMinor: 20, effectiveDate: "2026-07-18", categoryKind: "expense" }),
        tx({ id: "after", status: "pending", type: "expense", amountTryMinor: 30, effectiveDate: "2026-08-01", categoryKind: "expense" }),
      ],
      expected: [
        { id: "due-today", direction: "in", kind: "recurring_income", refId: "today", dueDate: "2026-07-18", amountMinor: 40, currency: "TRY", status: "pending" },
        { id: "after", direction: "out", kind: "subscription", refId: "after", dueDate: "2026-08-01", amountMinor: 50, currency: "TRY", status: "pending" },
      ],
      ledger: [], actualBalanceMinor: 100, today: TODAY, monthStart: "2026-07-01", monthEnd: "2026-07-31",
      currentMonth: "2026-07", year: 2026, expectedTryMinor: (_currency, amount) => amount,
    });
    expect(model.lateItems).toEqual([]);
    expect(model.monthEndFlows).toEqual([
      { direction: "out", amountTryMinor: 20, date: "2026-07-18" },
      { direction: "in", amountTryMinor: 40, date: "2026-07-18" },
    ]);
    expect(model.projectedMinor).toBe(120);
  });

  it("includes a realized transaction on the exact month-end boundary", () => {
    const model = buildDashboardModel({
      transactions: [
        tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2026-07-31", categoryId: "food", categoryKind: "expense" }),
        tx({ type: "expense", amountTryMinor: 9_999, effectiveDate: "2026-08-01", categoryId: "food", categoryKind: "expense" }),
      ],
      expected: [], ledger: [], actualBalanceMinor: 0, today: "2026-07-31", monthStart: "2026-07-01", monthEnd: "2026-07-31",
      currentMonth: "2026-07", year: 2026, expectedTryMinor: () => null,
    });
    expect(model.distribution.expenseTotalMinor).toBe(100);
    expect(model.distribution.expenseByCategory).toEqual(new Map([["food", 100]]));
  });

  it("keeps a missing actual balance null even when a forecast flow exists", () => {
    const model = buildDashboardModel({
      transactions: [tx({ type: "income", amountTryMinor: 100, effectiveDate: "2026-07-18", status: "pending", categoryKind: "income" })],
      expected: [], ledger: [], actualBalanceMinor: null, today: TODAY, monthStart: "2026-07-01", monthEnd: "2026-07-31",
      currentMonth: "2026-07", year: 2026, expectedTryMinor: () => null,
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
    const model = buildDashboardModel({
      transactions, expected, ledger, actualBalanceMinor: 1_000, today: TODAY,
      monthStart: "2026-07-01", monthEnd: "2026-07-31", currentMonth: "2026-07", year: 2026,
      expectedTryMinor: (currency, amount) => currency === "TRY" ? amount : null,
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
      expenseTotalMinor: 300, transferTotalMinor: 300, incomeTotalMinor: 400,
    });
    expect({ fixedMinor: model.fixedMinor, variableMinor: model.variableMinor }).toEqual({ fixedMinor: 100, variableMinor: 200 });
    expect(model.trendMonths.map((month) => month.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
    expect(buildDashboardModel({ ...{
      transactions: [], expected: [], ledger: [], today: TODAY, monthStart: "2026-07-01", monthEnd: "2026-07-31", currentMonth: "2026-07", year: 2026,
      expectedTryMinor: () => null,
    }, actualBalanceMinor: null }).projectedMinor).toBeNull();
  });
});

describe("mutation-sensitive matrix contract", () => {
  it("does not invent an uncategorized column for an exact zero", () => {
    const model = buildCashFlowMatrixModel({
      year: 2026, yearMonths: [], categories: [], computedColumns: [], transactions: [],
      creditCardIds: new Set(), liveCategoryIds: new Set(), today: "2026-07-18",
      openingLabel: "Açılış", closingLabel: "Kapanış",
    });
    expect(model.hasUncategorized).toBe(false);
    expect(model.uncategorizedTotal).toBe(0);
  });

  it("pins all twelve slots, column metadata, corrupt definitions, card splits, and orphan totals", () => {
    const transactions = [
      tx({ type: "expense", amountTryMinor: 100, effectiveDate: "2026-01-05", categoryId: "food", categoryKind: "expense", paymentSourceId: "card" }),
      tx({ type: "expense", amountTryMinor: 200, effectiveDate: "2026-01-06", categoryId: "orphan", categoryKind: "expense", paymentSourceId: "card", installmentPlanId: "plan" }),
    ];
    const ledger = buildLedger({ openingBalanceMinor: 1_000, startMonth: "2026-01", endMonth: "2026-01", transactions, adjustments: [], today: "2026-12-31" });
    const model = buildCashFlowMatrixModel({
      year: 2026, yearMonths: ledger, categories: [{ id: "food", name: "Market" }],
      computedColumns: [
        { id: "card-single", name: "Tek", definition: '{"op":"cc_split","part":"single"}' },
        { id: "card-installment", name: "Taksit", definition: '{"op":"cc_split","part":"installment"}' },
        { id: "broken", name: "Bozuk", definition: "{" },
      ],
      transactions, creditCardIds: new Set(["card"]), liveCategoryIds: new Set(["food"]), today: "2026-12-31",
      openingLabel: "Açılış", closingLabel: "Kapanış",
    });

    expect(model.months.map(({ month, data }) => [month, data?.month ?? null])).toEqual([
      ["2026-01", "2026-01"], ["2026-02", null], ["2026-03", null], ["2026-04", null],
      ["2026-05", null], ["2026-06", null], ["2026-07", null], ["2026-08", null],
      ["2026-09", null], ["2026-10", null], ["2026-11", null], ["2026-12", null],
    ]);
    expect(model.columns.map(({ key, label, categoryId, computed, system }) => ({ key, label, categoryId, computed, system }))).toEqual([
      { key: "food", label: "Market", categoryId: "food", computed: false, system: false },
      { key: "card-single", label: "Tek", categoryId: null, computed: true, system: false },
      { key: "card-installment", label: "Taksit", categoryId: null, computed: true, system: false },
      { key: "broken", label: "Bozuk", categoryId: null, computed: true, system: false },
      { key: "opening", label: "Açılış", categoryId: null, computed: false, system: true },
      { key: "closing", label: "Kapanış", categoryId: null, computed: false, system: true },
    ]);
    expect(model.columns.map((column) => column.values.get("2026-01"))).toEqual([100, 100, 200, null, 1_000, 700]);
    expect({ hasUncategorized: model.hasUncategorized, uncategorizedTotal: model.uncategorizedTotal })
      .toEqual({ hasUncategorized: true, uncategorizedTotal: 200 });
  });
});
