import { describe, expect, it } from "vitest";
import {
  confirmEffectiveDate,
  findAutoConfirmable,
  findLate,
  generateExpected,
  obsoleteExpectedIds,
} from "../src/domain/expected";
import {
  dayIntervalDatesInRange,
  dueDatesInRange,
  nextDueAfter,
} from "../src/domain/recurrence";
import type { ExpectedPaymentLike, RecurringIncomeLike, SubscriptionLike } from "../src/domain/types";

const expected = (overrides: Partial<ExpectedPaymentLike> = {}): ExpectedPaymentLike => ({
  id: "e", direction: "out", kind: "subscription", refId: "s", dueDate: "2026-07-18",
  amountMinor: 100, currency: "TRY", status: "pending", ...overrides,
});

const subscription = (overrides: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: "s", name: "Abonelik", amountMinor: 100, currency: "TRY", cycle: "monthly", intervalMonths: 1,
  billingDay: 18, nextDueDate: "2026-07-18", isActive: true, autoPay: false, personIsSelf: true,
  trialEndDate: null, amountMode: "fixed", ...overrides,
});

const income = (overrides: Partial<RecurringIncomeLike> = {}): RecurringIncomeLike => ({
  id: "i", name: "Gelir", defaultAmountMinor: 200, currency: "TRY", payDay: 18,
  isActive: true, personIsSelf: true, ...overrides,
});

describe("mutation-sensitive recurrence boundaries", () => {
  it("keeps next-due comparisons strict on both the source and target dates", () => {
    expect(nextDueAfter("2026-07-20", "2026-07-19", 1, 20)).toBe("2026-07-20");
    expect(nextDueAfter("2026-07-20", "2026-07-20", 1, 20)).toBe("2026-08-20");
    expect(nextDueAfter("2026-07-25", "2026-07-25", 1, 20)).toBe("2026-08-20");
  });

  it("includes exact monthly range endpoints and rejects every invalid schedule field", () => {
    expect(dueDatesInRange("2026-07-18", 1, 18, "2026-07-18", "2026-09-18"))
      .toEqual(["2026-07-18", "2026-08-18", "2026-09-18"]);
    expect(dueDatesInRange("2026-07-17", 1, 17, "2026-07-18", "2026-09-18"))
      .toEqual(["2026-08-17", "2026-09-17"]);
    for (const interval of [0, -1, 1.5, 13, Number.NaN]) {
      expect(dueDatesInRange("2026-07-18", interval, 18, "2026-07-18", "2026-09-18"), String(interval)).toEqual([]);
    }
    for (const day of [0, 32, 1.5, Number.NaN]) {
      expect(dueDatesInRange("2026-07-18", 1, day, "2026-07-18", "2026-09-18"), String(day)).toEqual([]);
    }
  });

  it("aligns day intervals mathematically and includes both endpoints", () => {
    expect(dayIntervalDatesInRange("2026-07-01", 7, "2026-07-08", "2026-07-22"))
      .toEqual(["2026-07-08", "2026-07-15", "2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-01", 7, "2026-07-09", "2026-07-22"))
      .toEqual(["2026-07-15", "2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-01", 3, "2026-07-06", "2026-07-10"))
      .toEqual(["2026-07-07", "2026-07-10"]);
    expect(dayIntervalDatesInRange("2026-07-22", 7, "2026-07-01", "2026-07-22")).toEqual(["2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-23", 7, "2026-07-01", "2026-07-22")).toEqual([]);
    for (const interval of [0, -1, 1.5, Number.NaN]) {
      expect(dayIntervalDatesInRange("2026-07-01", interval, "2026-07-01", "2026-07-22"), String(interval)).toEqual([]);
    }
    expect(dayIntervalDatesInRange("2000-01-01", 1, "2200-01-01", "2200-01-01"))
      .toEqual(["2200-01-01"]);
    expect(dayIntervalDatesInRange("2000-01-01", 2, "2200-01-01", "2200-01-02"))
      .toEqual(["2200-01-02"]);
  });
});

describe("mutation-sensitive expected-item contract", () => {
  it("pins obsolete-row status, activity, date, identity, and output id", () => {
    const rows = [
      expected({ id: "past-pending", dueDate: "2026-07-17" }),
      expected({ id: "today-pending", dueDate: "2026-07-18" }),
      expected({ id: "future-late", dueDate: "2026-07-19", status: "late" }),
      expected({ id: "future-paid", dueDate: "2026-07-19", status: "paid" }),
    ];
    const draft = [{ direction: "out" as const, kind: "subscription" as const, refId: "s", dueDate: "2026-07-19", amountMinor: 100, amountIsEstimated: false, currency: "TRY" }];
    expect(obsoleteExpectedIds(rows, draft, "2026-07-18", true)).toEqual(["today-pending"]);
    expect(obsoleteExpectedIds(rows, [], "2026-07-18", false)).toEqual(["past-pending", "today-pending", "future-late"]);
  });

  it("generates exact fixed, variable, weekly, and biweekly draft fields in sorted order", () => {
    const drafts = generateExpected(
      [
        subscription({ id: "fixed" }),
        subscription({ id: "variable", amountMode: "variable", nextDueDate: "2026-07-19", billingDay: 19 }),
      ],
      [
        income({ id: "weekly", recurrence: "weekly", anchorDate: "2026-07-18" }),
        income({ id: "biweekly", recurrence: "biweekly", anchorDate: "2026-07-19" }),
      ],
      [], "2026-07-18", 0,
    );
    expect(drafts).toEqual([
      { direction: "out", kind: "subscription", refId: "fixed", dueDate: "2026-07-18", amountMinor: 100, amountIsEstimated: false, currency: "TRY" },
      { direction: "in", kind: "recurring_income", refId: "weekly", dueDate: "2026-07-18", amountMinor: 200, amountIsEstimated: false, currency: "TRY" },
      { direction: "out", kind: "subscription", refId: "variable", dueDate: "2026-07-19", amountMinor: 100, amountIsEstimated: true, currency: "TRY" },
      { direction: "in", kind: "recurring_income", refId: "biweekly", dueDate: "2026-07-19", amountMinor: 200, amountIsEstimated: false, currency: "TRY" },
      { direction: "in", kind: "recurring_income", refId: "weekly", dueDate: "2026-07-25", amountMinor: 200, amountIsEstimated: false, currency: "TRY" },
    ]);
  });

  it("keeps an earlier trial anchor and emits a monthly income due today exactly once", () => {
    const existing = [{ kind: "recurring_income" as const, refId: "duplicate", dueDate: "2026-07-18" }];
    expect(generateExpected(
      [subscription({ id: "trial-ended", nextDueDate: "2026-07-20", billingDay: 20, trialEndDate: "2026-07-01" })],
      [income({ id: "monthly", recurrence: "monthly", payDay: 18 }), income({ id: "duplicate", recurrence: "monthly", payDay: 18 })],
      existing, "2026-07-18", 0,
    )).toEqual([
      { direction: "in", kind: "recurring_income", refId: "monthly", dueDate: "2026-07-18", amountMinor: 200, amountIsEstimated: false, currency: "TRY" },
      { direction: "out", kind: "subscription", refId: "trial-ended", dueDate: "2026-07-20", amountMinor: 100, amountIsEstimated: false, currency: "TRY" },
    ]);
  });

  it("does not move the stored next due date backward after a trial already ended", () => {
    expect(generateExpected([
      subscription({ id: "ended", nextDueDate: "2026-08-20", billingDay: 20, trialEndDate: "2026-07-01" }),
    ], [], [], "2026-07-18", 1).map((draft) => draft.dueDate)).toEqual(["2026-08-20"]);
  });

  it("anchors trials on or after their exact end boundary", () => {
    expect(generateExpected([subscription({ nextDueDate: "2026-07-10", billingDay: 18, trialEndDate: "2026-07-18" })], [], [], "2026-07-01", 0)
      .map((draft) => draft.dueDate)).toEqual(["2026-07-18"]);
    expect(generateExpected([subscription({ nextDueDate: "2026-07-10", billingDay: 18, trialEndDate: "2026-07-19" })], [], [], "2026-07-01", 1)
      .map((draft) => draft.dueDate)).toEqual(["2026-08-18"]);
  });

  it("pins confirmation, lateness and autopay equality boundaries", () => {
    expect(confirmEffectiveDate("2026-07-18", "2026-07-18", "2026-07-18")).toBe("2026-07-18");
    expect(confirmEffectiveDate("2026-07-17", "2026-07-18", "2026-07-19")).toBe("2026-07-17");
    expect(confirmEffectiveDate("2026-07-17", "2026-07-18", "2026-07-18")).toBe("2026-07-18");
    expect(findLate([expected({ id: "yesterday", dueDate: "2026-07-17" }), expected({ id: "today", dueDate: "2026-07-18" })], "2026-07-18").map((row) => row.id)).toEqual(["yesterday"]);
    expect(findAutoConfirmable([
      expected({ id: "today", dueDate: "2026-07-18" }),
      expected({ id: "income", dueDate: "2026-07-18", kind: "recurring_income" }),
      expected({ id: "estimated", dueDate: "2026-07-18", amountIsEstimated: true }),
    ], new Map([["s", "2026-07-01"]]), "2026-07-18").map((row) => row.id)).toEqual(["today"]);
    expect(findAutoConfirmable([
      expected({ id: "late", dueDate: "2026-07-17", status: "late" }),
    ], new Map([["s", "2026-07-01"]]), "2026-07-18")).toEqual([]);
  });
});
