import { describe, expect, it } from "vitest";
import { categoryRangeMatrix, distributionForRange, fixedVsVariable } from "../src/domain/analytics";
import { buildLedger } from "../src/domain/balance";
import {
  categoryAcceptsTransaction,
  financialFlow,
  projectedTransactionFlow,
} from "../src/domain/transactions";
import { required, tx } from "./helpers";

const TODAY = "2026-07-31";

describe("canonical transaction classification", () => {
  it("requires income/expense categories and keeps transfers in expense columns", () => {
    expect(categoryAcceptsTransaction("expense", "expense")).toBe(true);
    expect(categoryAcceptsTransaction("income", "income")).toBe(true);
    expect(categoryAcceptsTransaction("income", "expense")).toBe(false);
    expect(categoryAcceptsTransaction("transfer", "expense")).toBe(true);
    expect(categoryAcceptsTransaction("transfer", "income")).toBe(false);
  });

  it("normalizes a legacy mismatched refund without changing its cash effect", () => {
    const legacy = tx({
      type: "income",
      amountTryMinor: 20_00,
      effectiveDate: "2026-07-10",
      categoryId: "market",
      categoryKind: "expense",
    });
    expect(financialFlow(legacy)).toEqual({ type: "expense", amountTryMinor: -20_00 });
    expect(projectedTransactionFlow(legacy)).toEqual({ direction: "in", amountTryMinor: 20_00 });
  });

  it("nets refunds identically in ledger, distribution and category cells", () => {
    const rows = [
      tx({
        type: "expense",
        amountTryMinor: 100_00,
        effectiveDate: "2026-07-05",
        categoryId: "market",
        categoryKind: "expense",
      }),
      tx({
        type: "expense",
        amountTryMinor: -20_00,
        effectiveDate: "2026-07-10",
        categoryId: "market",
        categoryKind: "expense",
      }),
    ];
    const ledger = required(buildLedger({
      openingBalanceMinor: 1_000_00,
      startMonth: "2026-07",
      endMonth: "2026-07",
      transactions: rows,
      adjustments: [],
      today: TODAY,
    })[0]);
    const distribution = distributionForRange(rows, "2026-07-01", "2026-07-31", TODAY);
    const matrix = categoryRangeMatrix(rows, "2026-07", "2026-07", TODAY);

    expect(ledger.expenseMinor).toBe(80_00);
    expect(ledger.byCategory.get("market")).toBe(80_00);
    expect(ledger.closingMinor).toBe(920_00);
    expect(distribution.expenseByCategory.get("market")).toBe(80_00);
    expect(distribution.expenseTotalMinor).toBe(80_00);
    expect(matrix.get("market")?.ytdMinor).toBe(80_00);
  });

  it("keeps fixed and variable totals reconciled after reversals", () => {
    const rows = [
      tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-05", subscriptionId: "s1" }),
      tx({ type: "expense", amountTryMinor: -10_00, effectiveDate: "2026-07-06", subscriptionId: "s1" }),
      tx({ type: "expense", amountTryMinor: 30_00, effectiveDate: "2026-07-07" }),
    ];
    const split = fixedVsVariable(rows, "2026-07-01", "2026-07-31", TODAY);
    const distribution = distributionForRange(rows, "2026-07-01", "2026-07-31", TODAY);
    expect(split).toEqual({ fixedMinor: 90_00, variableMinor: 30_00 });
    expect(split.fixedMinor + split.variableMinor).toBe(distribution.expenseTotalMinor);
  });
});
