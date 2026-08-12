import { describe, expect, it } from "vitest";
import { MAX_COMPUTED_CATEGORY_IDS, parseDefinition } from "../src/domain/computed-columns";
import { convertToTryMinor, pickRate } from "../src/domain/fx";
import {
  deriveStartMonth,
  generateSchedule,
  installmentDisplayTitle,
  MAX_INSTALLMENT_COUNT,
  planAmounts,
} from "../src/domain/installments";
import { InvestmentDomainError, parseInvestmentQuantity } from "../src/domain/investments";
import type { InstallmentPlanLike } from "../src/domain/types";

const plan = (overrides: Partial<InstallmentPlanLike> = {}): InstallmentPlanLike => ({
  id: "plan", kind: "card_installment", startMonth: "2026-07", installmentCount: 1,
  totalAmountMinor: 100, monthlyAmountMinor: null, currency: "TRY", dueDay: 18,
  personIsSelf: true, ...overrides,
});

describe("surviving mutation contracts", () => {
  it("accepts multi-category definitions and rejects duplicates across difference sides", () => {
    expect(parseDefinition({ op: "sum", categoryIds: ["a", "b"] }))
      .toEqual({ op: "sum", categoryIds: ["a", "b"] });
    expect(parseDefinition({ op: "difference", plusCategoryIds: ["a", "b"], minusCategoryIds: ["c", "d"] }))
      .toEqual({ op: "difference", plusCategoryIds: ["a", "b"], minusCategoryIds: ["c", "d"] });
    expect(() => parseDefinition({ op: "difference", plusCategoryIds: ["a"], minusCategoryIds: ["a"] }))
      .toThrow("Computed categories must be unique");
    try {
      parseDefinition({ op: "difference", plusCategoryIds: ["a"], minusCategoryIds: ["a"] });
    } catch (error) {
      expect(error).toMatchObject({ issues: [expect.objectContaining({ code: "custom" })] });
    }
    expect(() => parseDefinition({
      op: "difference",
      plusCategoryIds: Array.from({ length: MAX_COMPUTED_CATEGORY_IDS + 1 }, (_, index) => String(index)),
      minusCategoryIds: ["other"],
    })).toThrow();
  });

  it("pins FX failure messages and stable tie selection", () => {
    expect(() => convertToTryMinor(100, 0)).toThrow("Invalid FX rate: 0");
    expect(() => convertToTryMinor(Number.MAX_SAFE_INTEGER, 2))
      .toThrow("Converted amount exceeds safe minor-unit range");
    const first = { currency: "USD", rateDate: "2026-07-18", rateTry: 40 };
    const duplicate = { currency: "USD", rateDate: "2026-07-18", rateTry: 41 };
    expect(pickRate([first, duplicate], "USD", "2026-07-18")?.rate).toBe(first);
    expect(pickRate([
      { currency: "USD", rateDate: "2026-07-17", rateTry: 39 }, first,
    ], "USD", "2026-07-18")?.rate).toBe(first);
  });

  it("pins installment whitespace, error, and same-day boundaries", () => {
    expect(installmentDisplayTitle(null, "Laptop   taksiti", "fallback")).toBe("Laptop taksiti");
    expect(() => planAmounts({ totalAmountMinor: 100, monthlyAmountMinor: null, installmentCount: 0 }))
      .toThrow(`Installment count out of range (1–${MAX_INSTALLMENT_COUNT}): 0`);
    expect(generateSchedule(plan(), "2026-07-18")[0]?.status).toBe("realized");
    expect(generateSchedule(plan({ dueDay: -1 }), "2026-07-18")[0]?.effectiveDate).toBe("2026-07-01");
    expect(deriveStartMonth(0, "2026-07", 18, "2026-07-18")).toBe("2026-08");
  });

  it("rejects a quantity with no integer part", () => {
    expect(() => parseInvestmentQuantity(".5")).toThrow(InvestmentDomainError);
    try {
      parseInvestmentQuantity(".5");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_quantity" });
    }
  });
});
