import { describe, expect, it } from "vitest";
import { distributionForRange, fixedVsVariable } from "../src/domain/analytics";
import { buildDashboardModel } from "../src/domain/dashboard";
import { projectedBalance } from "../src/domain/balance";
import { projectedTransactionFlow } from "../src/domain/transactions";
import { tx } from "./helpers";

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
    const model = buildDashboardModel({
      transactions,
      expected,
      ledger: [],
      actualBalanceMinor: 1_000_00,
      today,
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
      currentMonth: "2026-07",
      year: 2026,
      expectedTryMinor: (_currency, amount) => amount,
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
    const model = buildDashboardModel({
      transactions: [futureTransaction],
      expected: [{
        id: "electricity-expected",
        direction: "out",
        kind: "subscription",
        refId: "electricity",
        dueDate: "2026-07-28",
        amountMinor: 125_00,
        currency: "TRY",
        status: "pending",
      }],
      ledger: [],
      actualBalanceMinor: 1_000_00,
      today: "2026-07-18",
      monthStart: "2026-07-01",
      monthEnd: "2026-07-31",
      currentMonth: "2026-07",
      year: 2026,
      expectedTryMinor: (_currency, amount) => amount,
    });

    expect(model.outgoingMinor).toBe(125_00);
    expect(model.projectedMinor).toBe(875_00);
  });
});

/**
 * The forecast used to assume the rest of the month costs nothing.
 *
 * `projectedMinor` is the balance plus every KNOWN flow, and nothing the owner
 * has not already told the app about is known. On the tenth of the month that
 * silently claims twenty days of groceries, fuel and eating out will not
 * happen — so the headline was wrong every month, in the same direction.
 *
 * The estimate is deliberately the crudest one that is defensible: the median
 * of what completed months actually cost, minus what this month has cost so
 * far. Median rather than mean because one boiler repair should not become the
 * new normal, and no pro-rating by days remaining because that would model a
 * spending rhythm nobody has measured — the plain subtraction errs toward
 * expecting more spending than may arrive, which is the safe direction for a
 * balance.
 */
describe("expected variable spending", () => {
  const monthly = (month: string, day: string, amount: number, id: string) =>
    tx({ id, type: "expense", amountTryMinor: amount, effectiveDate: `${month}-${day}` as const, categoryId: "market" });

  const buildWith = (transactions: ReturnType<typeof tx>[]) => buildDashboardModel({
    transactions,
    expected: [],
    ledger: [],
    actualBalanceMinor: 10_000_00,
    today: "2026-07-10",
    monthStart: "2026-07-01",
    monthEnd: "2026-07-31",
    currentMonth: "2026-07",
    year: 2026,
    expectedTryMinor: (_currency, amountMinor) => amountMinor,
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
