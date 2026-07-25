/**
 * One dataset, every consumer that reports money from it.
 *
 * Each screen builds its own aggregate: the Financial Table chains months
 * (`buildLedger`), the Summary card projects the current month
 * (`buildDashboardModel`), Analysis slices a range (`distributionForRange`,
 * `categoryRangeMatrix`) and the matrix renders columns
 * (`buildCashFlowMatrixModel`). They agree today because they all route through
 * `financialFlow` and `countsTowardBalance` — but nothing failed when they
 * disagreed, and "the same number differs between two screens" is the defect a
 * finance app can least afford. These tests are that alarm.
 *
 * The fixture is deliberately awkward: history before the configured anchor, a
 * refund, a legacy row whose category contradicts its type, an uncategorized
 * expense, another person's spending, a pending future row and a mid-month
 * balance correction.
 */

import { describe, expect, it } from "vitest";
import {
  buildLedger,
  currentBalance,
  reconciliationDelta,
  resolveLedgerAnchor,
} from "../src/domain/balance";
import { categoryRangeMatrix, distributionForRange, fixedVsVariable } from "../src/domain/analytics";
import { buildCashFlowMatrixModel } from "../src/domain/cash-flow-matrix";
import { buildDashboardModel } from "../src/domain/dashboard";
import { firstDayOf, lastDayOf, monthKeyOf } from "../src/domain/dates";
import { required, tl, tx } from "./helpers";

const TODAY = "2026-07-25";
const CONFIGURED_START = "2026-03";
const CONFIGURED_OPENING = tl("100.000,00");

const GROCERIES = "cat-groceries";
const RENT = "cat-rent";
const SALARY = "cat-salary";
const INVESTMENT = "cat-investment";

const transactions = [
  // Entered before the configured anchor month: the ledger must back-anchor to
  // it instead of silently dropping it from the chain.
  tx({ id: "old", type: "expense", amountTryMinor: tl("2.500,00"), effectiveDate: "2026-01-14", categoryId: RENT, categoryKind: "expense" }),
  tx({ id: "salary", type: "income", amountTryMinor: tl("45.000,00"), effectiveDate: "2026-07-01", categoryId: SALARY, categoryKind: "income" }),
  tx({ id: "rent", type: "expense", amountTryMinor: tl("18.000,00"), effectiveDate: "2026-07-05", categoryId: RENT, categoryKind: "expense", subscriptionId: "sub-rent" }),
  tx({ id: "market", type: "expense", amountTryMinor: tl("1.234,56"), effectiveDate: "2026-07-07", categoryId: GROCERIES, categoryKind: "expense" }),
  // A refund keeps its type and category and carries a negative amount.
  tx({ id: "refund", type: "expense", amountTryMinor: tl("-234,56"), effectiveDate: "2026-07-09", categoryId: GROCERIES, categoryKind: "expense" }),
  // Legacy row: an income saved under an expense category. Its cash effect is
  // preserved and it reads as a reversal OF THAT CATEGORY, never as income.
  tx({ id: "legacy", type: "income", amountTryMinor: tl("500,00"), effectiveDate: "2026-07-10", categoryId: GROCERIES, categoryKind: "expense" }),
  tx({ id: "uncategorized", type: "expense", amountTryMinor: tl("310,00"), effectiveDate: "2026-07-11", categoryId: null }),
  tx({ id: "invest", type: "transfer", amountTryMinor: tl("5.000,00"), effectiveDate: "2026-07-12", categoryId: INVESTMENT, categoryKind: "expense" }),
  // Someone else's spending: visible in their own views, never in the balance.
  tx({ id: "other-person", type: "expense", amountTryMinor: tl("9.999,00"), effectiveDate: "2026-07-13", categoryId: GROCERIES, categoryKind: "expense", personIsSelf: false }),
  // Future obligation: forecast only, never realized.
  tx({ id: "future", type: "expense", amountTryMinor: tl("1.500,00"), effectiveDate: "2026-07-28", status: "pending", categoryId: RENT, categoryKind: "expense", installmentPlanId: "plan-1" }),
];

const adjustments = [{ date: "2026-07-20", amountMinor: tl("-750,00") }];

function anchoredLedger(adjustmentRows = adjustments) {
  const anchor = resolveLedgerAnchor(CONFIGURED_START, CONFIGURED_OPENING, transactions, adjustmentRows, TODAY);
  return {
    anchor,
    ledger: buildLedger({
      openingBalanceMinor: anchor.openingBalanceMinor,
      startMonth: anchor.startMonth,
      endMonth: "2026-12",
      transactions,
      adjustments: adjustmentRows,
      today: TODAY,
    }),
  };
}

const monthOf = (month: string) => {
  const { ledger } = anchoredLedger();
  return required(ledger.find((entry) => entry.month === month), `ledger month ${month}`);
};

describe("every money screen reports the same dataset the same way", () => {
  it("back-anchors history without moving the balance at the configured start", () => {
    const { anchor, ledger } = anchoredLedger();
    expect(anchor.startMonth).toBe("2026-01");
    // The 2026-01 expense is now inside the chain, so the anchor month's opening
    // is rolled back by exactly that flow — the balance AT the configured start
    // (and therefore every later month) is unchanged.
    expect(anchor.openingBalanceMinor).toBe(CONFIGURED_OPENING + tl("2.500,00"));
    expect(required(ledger.find((month) => month.month === CONFIGURED_START)).openingMinor).toBe(CONFIGURED_OPENING);
    expect(required(ledger.find((month) => month.month === "2026-01")).expenseMinor).toBe(tl("2.500,00"));
  });

  it("closes the current month on exactly the balance the reconciliation screen shows", () => {
    // `useLedgerState` serves the "current balance" from the chain instead of a
    // second O(N) pass. If that shortcut ever drifts, the opening-balance editor
    // reconciles against a number no other screen agrees with.
    const { anchor, ledger } = anchoredLedger();
    const fromChain = required(ledger.find((month) => month.month === monthKeyOf(TODAY))).closingMinor;
    const direct = currentBalance({
      openingBalanceMinor: anchor.openingBalanceMinor,
      startMonth: anchor.startMonth,
      transactions,
      adjustments,
      today: TODAY,
    });
    expect(fromChain).toBe(direct);
  });

  it("agrees with Analysis on income, expense and transfer for the same month", () => {
    const july = monthOf("2026-07");
    const distribution = distributionForRange(transactions, "2026-07-01", "2026-07-31", TODAY);
    expect(july.incomeMinor).toBe(distribution.incomeTotalMinor);
    expect(july.expenseMinor).toBe(distribution.expenseTotalMinor);
    expect(july.transferMinor).toBe(distribution.transferTotalMinor);
    // The uncategorized expense is inside the ledger's expense total and broken
    // out separately by Analysis — the two views of one number must reconcile.
    expect(
      [...distribution.expenseByCategory.values()].reduce((sum, value) => sum + value, 0) +
        distribution.uncategorizedExpenseMinor,
    ).toBe(july.expenseMinor);
    expect(july.uncategorizedMinor).toBe(distribution.uncategorizedExpenseMinor);
  });

  it("agrees with the Summary card on the same month", () => {
    const july = monthOf("2026-07");
    const model = buildDashboardModel({
      transactions,
      expected: [],
      ledger: [],
      actualBalanceMinor: july.closingMinor,
      today: TODAY,
      monthStart: firstDayOf("2026-07"),
      monthEnd: lastDayOf("2026-07"),
      currentMonth: "2026-07",
      year: 2026,
      expectedTryMinor: (_currency, amount) => amount,
    });
    expect(model.distribution.incomeTotalMinor).toBe(july.incomeMinor);
    expect(model.distribution.expenseTotalMinor).toBe(july.expenseMinor);
    expect(model.distribution.transferTotalMinor).toBe(july.transferMinor);
    // Fixed + variable partition the SAME expense total, never a different one.
    const split = fixedVsVariable(transactions, "2026-07-01", "2026-07-31", TODAY);
    expect(split.fixedMinor + split.variableMinor).toBe(july.expenseMinor);
    expect({ fixedMinor: model.fixedMinor, variableMinor: model.variableMinor }).toEqual(split);
    // The pending row is a forecast, never part of the realized month.
    expect(model.projectedMinor).toBe(july.closingMinor - tl("1.500,00"));
  });

  it("renders matrix columns straight from the ledger it was built with", () => {
    const { ledger } = anchoredLedger();
    const yearMonths = ledger.filter((month) => month.month.startsWith("2026"));
    const categories = [
      { id: GROCERIES, name: "Market" },
      { id: RENT, name: "Kira" },
      { id: SALARY, name: "Maaş" },
      { id: INVESTMENT, name: "Yatırım" },
    ];
    const model = buildCashFlowMatrixModel({
      year: 2026,
      yearMonths,
      categories,
      computedColumns: [],
      transactions,
      creditCardIds: new Set<string>(),
      liveCategoryIds: new Set(categories.map((category) => category.id)),
      today: TODAY,
      openingLabel: "Ay Başı",
      closingLabel: "Güncel Bakiye",
    });
    const july = monthOf("2026-07");
    for (const category of categories) {
      const column = required(model.columns.find((entry) => entry.key === category.id));
      expect(column.values.get("2026-07") ?? 0).toBe(july.byCategory.get(category.id) ?? 0);
    }
    expect(required(model.columns.find((column) => column.key === "opening")).values.get("2026-07")).toBe(july.openingMinor);
    expect(required(model.columns.find((column) => column.key === "closing")).values.get("2026-07")).toBe(july.closingMinor);
    // The uncategorized expense is reported as an actionable leftover, not
    // folded into a category column that would silently absorb it.
    expect(model.hasUncategorized).toBe(true);
    expect(model.uncategorizedTotal).toBe(tl("310,00"));

    // Analysis' per-category matrix must not invent a different category total.
    const analysisRows = categoryRangeMatrix(transactions, "2026-07", "2026-07", TODAY);
    for (const category of categories) {
      const row = analysisRows.get(category.id);
      const ledgerValue = july.byCategory.get(category.id) ?? 0;
      // Transfers are excluded from the default category matrix by design; every
      // other category has to match the ledger cell exactly.
      if (category.id === INVESTMENT) expect(row).toBeUndefined();
      else expect(row?.monthly.get("2026-07") ?? 0).toBe(ledgerValue);
    }
  });

  it("keeps a refund and a mis-categorised legacy row out of income", () => {
    const july = monthOf("2026-07");
    // Only the salary is income: the legacy income-in-an-expense-category row is
    // a reversal of that category, and the refund reduces its own category.
    expect(july.incomeMinor).toBe(tl("45.000,00"));
    expect(july.byCategory.get(GROCERIES)).toBe(tl("1.234,56") - tl("234,56") - tl("500,00"));
    // Stated as one number so another person's 9.999,00, the pending 1.500,00
    // and the transfer cannot slip into the expense total unnoticed.
    expect(july.expenseMinor).toBe(tl("18.810,00"));
    expect(july.transferMinor).toBe(tl("5.000,00"));
  });
});

describe("correcting the current balance", () => {
  it("lands in the month it was made, leaving every earlier month untouched", () => {
    const withAdjustment = anchoredLedger();
    const without = anchoredLedger([]);
    const july = required(withAdjustment.ledger.find((month) => month.month === "2026-07"));
    const januaryBefore = required(without.ledger.find((month) => month.month === "2026-01"));
    const januaryAfter = required(withAdjustment.ledger.find((month) => month.month === "2026-01"));

    expect(july.adjustmentMinor).toBe(tl("-750,00"));
    // The correction belongs to July. A correction that defaulted to the start
    // of the year would rewrite January's closing and every chained month after
    // it — the whole reason corrections are dated rows and not an opening edit.
    expect(januaryAfter).toEqual(januaryBefore);
    for (const month of ["2026-02", "2026-03", "2026-06"]) {
      expect(required(withAdjustment.ledger.find((entry) => entry.month === month)))
        .toEqual(required(without.ledger.find((entry) => entry.month === month)));
    }
  });

  it("converges on the target when corrected repeatedly on the same day", () => {
    const computedNow = required(anchoredLedger([]).ledger.find((month) => month.month === "2026-07")).closingMinor;
    const target = tl("120.000,00");
    const first = reconciliationDelta(target, computedNow);
    expect(
      required(anchoredLedger([{ date: TODAY, amountMinor: first }]).ledger.find((month) => month.month === "2026-07"))
        .closingMinor,
    ).toBe(target);

    // Correcting again the same day replaces that row instead of stacking on it.
    const shownAfterFirst = computedNow + first;
    const second = reconciliationDelta(tl("118.500,00"), shownAfterFirst, first);
    expect(
      required(anchoredLedger([{ date: TODAY, amountMinor: second }]).ledger.find((month) => month.month === "2026-07"))
        .closingMinor,
    ).toBe(tl("118.500,00"));
  });
});
