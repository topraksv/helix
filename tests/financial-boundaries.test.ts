import { describe, expect, it, vi } from "vitest";
import { budgetProgress } from "../src/domain/budgets";
import { evaluateComputedColumn, parseDefinition, type MonthAggregates } from "../src/domain/computed-columns";
import { deriveStartMonth, planAmounts, planProgress } from "../src/domain/installments";
import {
  hasUnknownAmount,
  isVariableSubscriptionOccurrence,
  needsVariableAmountEntry,
  occurrenceAmountText,
} from "../src/domain/subscriptions";
import { signedBalanceEffectOf } from "../src/domain/transactions";
import { tx } from "./helpers";

describe("financial helper boundaries", () => {
  it("drops unusable budgets and gives equal ratios deterministic category order", () => {
    const result = budgetProgress(
      [
        { id: "z", categoryId: "zebra", month: "2026-07", amountMinor: 10_000 },
        { id: "a", categoryId: "armut", month: "2026-07", amountMinor: 10_000 },
        { id: "zero", categoryId: "zero", month: "2026-07", amountMinor: 0 },
        { id: "other", categoryId: "other", month: "2026-08", amountMinor: 10_000 },
      ],
      [
        tx({ type: "expense", amountTryMinor: 2_000, effectiveDate: "2026-07-10", categoryId: "zebra", categoryKind: "expense" }),
        tx({ type: "expense", amountTryMinor: 2_000, effectiveDate: "2026-07-10", categoryId: "armut", categoryKind: "expense" }),
      ],
      "2026-07",
      "2026-07-18",
    );

    expect(result.map(({ id, spentMinor, ratio }) => ({ id, spentMinor, ratio }))).toEqual([
      { id: "a", spentMinor: 2_000, ratio: 0.2 },
      { id: "z", spentMinor: 2_000, ratio: 0.2 },
    ]);
  });

  it("treats a missing computed category as zero in both arithmetic operations", () => {
    const data: MonthAggregates = {
      month: "2026-07",
      byCategory: new Map([["known", 500]]),
      incomeMinor: 0,
      expenseMinor: 0,
      ccSingleMinor: 0,
      ccInstallmentMinor: 0,
    };

    expect(evaluateComputedColumn(parseDefinition({ op: "sum", categoryIds: ["missing"] }), data)).toBe(0);
    expect(evaluateComputedColumn(parseDefinition({
      op: "difference",
      plusCategoryIds: ["missing-plus"],
      minusCategoryIds: ["missing-minus"],
    }), data)).toBe(0);
  });

  it("rejects impossible plan inputs and reports a fully paid plan exactly", () => {
    expect(() => planAmounts({ totalAmountMinor: null, monthlyAmountMinor: null, installmentCount: 2 })).toThrow(
      "Plan needs either totalAmountMinor or monthlyAmountMinor",
    );
    expect(() => deriveStartMonth(-1, "2026-07")).toThrow("paidCount cannot be negative");
    expect(() => planProgress([])).toThrow("Plan has no installments");
    expect(planProgress([
      { installmentNo: 1, month: "2026-07", amountMinor: 500, effectiveDate: "2026-07-01", status: "realized" },
    ])).toEqual({ paid: 1, total: 1, remaining: 0, remainingMinor: 0, monthlyMinor: 0, endMonth: "2026-07" });
  });

  it("distinguishes fixed, estimated, and unknown subscription amounts", () => {
    const subscriptions = new Map([
      ["variable", { amountMode: "variable" as const }],
      ["fixed", { amountMode: "fixed" as const }],
    ]);
    const variable = { kind: "subscription", refId: "variable", amountIsEstimated: true };

    expect(isVariableSubscriptionOccurrence(variable, subscriptions)).toBe(true);
    expect(isVariableSubscriptionOccurrence({ kind: "recurring_income", refId: "variable" }, subscriptions)).toBe(false);
    expect(isVariableSubscriptionOccurrence({ kind: "subscription", refId: "missing" }, subscriptions)).toBe(false);
    expect(needsVariableAmountEntry(variable, subscriptions)).toBe(true);
    expect(needsVariableAmountEntry({ ...variable, amountIsEstimated: false }, subscriptions)).toBe(false);
    expect(hasUnknownAmount({ amountMinor: 0, currency: "TRY", amountIsEstimated: true })).toBe(true);
    expect(hasUnknownAmount({ amountMinor: 0, currency: "TRY", amountIsEstimated: false })).toBe(false);

    const format = vi.fn((amountMinor: number, currency: string) => `${currency}:${amountMinor}`);
    const labels = { unknown: "bilinmiyor", estimated: "tahmini" };
    expect(occurrenceAmountText({ amountMinor: 500, currency: "TRY" }, format, labels)).toBe("TRY:500");
    expect(occurrenceAmountText({ amountMinor: 0, currency: "TRY", amountIsEstimated: true }, format, labels)).toBe("bilinmiyor");
    expect(occurrenceAmountText({ amountMinor: 500, currency: "TRY", amountIsEstimated: true }, format, labels)).toBe("TRY:500 · tahmini");
  });

  it("preserves signed cash effect across income, expense, transfer, and legacy category mismatches", () => {
    expect(signedBalanceEffectOf("income", 500, "income")).toBe(500);
    expect(signedBalanceEffectOf("expense", 500, "expense")).toBe(-500);
    expect(signedBalanceEffectOf("transfer", 500, "expense")).toBe(-500);
    expect(signedBalanceEffectOf("income", 500, "expense")).toBe(500);
    expect(signedBalanceEffectOf("expense", 500, "income")).toBe(-500);
    expect(signedBalanceEffectOf("income", -500, "expense")).toBe(-500);
  });
});
