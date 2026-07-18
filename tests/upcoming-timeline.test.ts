import { describe, expect, it } from "vitest";
import { buildUpcomingTimeline } from "../src/domain/upcoming";

describe("unified upcoming timeline", () => {
  it("combines late rules, future entries and one card statement in date order", () => {
    const result = buildUpcomingTimeline({
      today: "2026-07-18",
      horizonDays: 60,
      expected: [
        { id: "late", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-07-10", amountMinor: 1000, currency: "TRY", status: "late" },
        { id: "income", direction: "in", kind: "recurring_income", refId: "income", dueDate: "2026-07-20", amountMinor: 5000, currency: "TRY", status: "pending" },
      ],
      expectedSources: [
        { id: "sub", name: "Müzik", sourceType: "subscription", categoryName: "Abonelikler" },
        { id: "income", name: "Maaş", sourceType: "recurring_income", categoryName: "Gelir" },
      ],
      categories: [{ id: "bill", name: "Fatura" }],
      cards: [],
      statements: [],
      transactions: [{
        id: "tx", type: "expense", amountTryMinor: 2500, effectiveDate: "2026-07-22", status: "pending",
        categoryId: "bill", categoryKind: "expense", paymentSourceId: null, personIsSelf: true,
        installmentPlanId: null, subscriptionId: null, isAggregate: false,
      }],
    });
    expect(result.map((item) => item.key)).toEqual(["expected:late", "expected:income", "transaction:tx"]);
    expect(result[0]?.status).toBe("late");
    expect(result[1]?.direction).toBe("in");
  });

  it("omits completed rules, watched transactions and items past the horizon", () => {
    const result = buildUpcomingTimeline({
      today: "2026-07-18",
      horizonDays: 10,
      expected: [
        { id: "paid", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-07-20", amountMinor: 1000, currency: "TRY", status: "paid" },
        { id: "far", direction: "out", kind: "subscription", refId: "sub", dueDate: "2026-09-20", amountMinor: 1000, currency: "TRY", status: "pending" },
      ],
      expectedSources: [], categories: [], cards: [], statements: [],
      transactions: [{
        id: "watched", type: "expense", amountTryMinor: 2500, effectiveDate: "2026-07-20", status: "pending",
        categoryId: null, categoryKind: null, paymentSourceId: null, personIsSelf: false,
        installmentPlanId: null, subscriptionId: null, isAggregate: false,
      }],
    });
    expect(result).toEqual([]);
  });
});
