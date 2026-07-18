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
});
