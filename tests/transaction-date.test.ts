import { describe, expect, it } from "vitest";
import { transactionDateText } from "../src/ui/transaction-date";

describe("transaction date display", () => {
  it("shows both purchase and statement due dates for card charges", () => {
    expect(transactionDateText({
      purchaseDate: "2026-07-20",
      effectiveDate: "2026-08-05",
      isAggregate: false,
      installmentPlanId: null,
    })).toBe("Harcama 20 Temmuz 2026 · Son ödeme 5 Ağustos 2026");
  });

  it("keeps installment rows month-only and ordinary rows dated", () => {
    expect(transactionDateText({
      purchaseDate: null,
      effectiveDate: "2026-08-05",
      isAggregate: false,
      installmentPlanId: "plan-1",
    })).toBe("Ağustos 2026");
    expect(transactionDateText({
      purchaseDate: null,
      effectiveDate: "2026-08-05",
      isAggregate: false,
      installmentPlanId: null,
    })).toBe("5 Ağustos 2026");
  });
});
