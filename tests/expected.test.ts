import { describe, expect, it } from "vitest";
import {
  confirmEffectiveDate,
  findAutoConfirmable,
  findLate,
  generateExpected,
  isDueWithin,
  obsoleteExpectedIds,
} from "../src/domain/expected";
import type { ExpectedPaymentLike, RecurringIncomeLike, SubscriptionLike } from "../src/domain/types";

function sub(overrides: Partial<SubscriptionLike>): SubscriptionLike {
  return {
    id: "sub-1",
    name: "Netflix",
    amountMinor: 229_99,
    currency: "TRY",
    cycle: "monthly",
    intervalMonths: 1,
    billingDay: 10,
    nextDueDate: "2026-07-10",
    isActive: true,
    autoPay: false,
    personIsSelf: true,
    trialEndDate: null,
    ...overrides,
  };
}

function income(overrides: Partial<RecurringIncomeLike>): RecurringIncomeLike {
  return {
    id: "inc-1",
    name: "Maaş",
    defaultAmountMinor: 170_600_30,
    currency: "TRY",
    payDay: 15,
    isActive: true,
    personIsSelf: true,
    ...overrides,
  };
}

function expected(overrides: Partial<ExpectedPaymentLike>): ExpectedPaymentLike {
  return {
    id: "exp-1",
    direction: "out",
    kind: "subscription",
    refId: "sub-1",
    dueDate: "2026-07-10",
    amountMinor: 229_99,
    currency: "TRY",
    status: "pending",
    ...overrides,
  };
}

describe("generateExpected", () => {
  it("creates monthly subscription dues through the horizon", () => {
    const drafts = generateExpected([sub({})], [], [], "2026-07-05", 2);
    const dues = drafts.filter((d) => d.kind === "subscription").map((d) => d.dueDate);
    expect(dues).toEqual(["2026-07-10", "2026-08-10", "2026-09-10"]);
    expect(drafts.every((d) => d.direction === "out" || d.kind === "recurring_income")).toBe(true);
  });

  it("is idempotent: existing items are not re-drafted", () => {
    const first = generateExpected([sub({})], [], [], "2026-07-05", 2);
    const second = generateExpected([sub({})], [], first.map((d) => ({ kind: d.kind, refId: d.refId, dueDate: d.dueDate })), "2026-07-05", 2);
    expect(second).toEqual([]);
  });

  it("skips inactive subscriptions and incomes", () => {
    const drafts = generateExpected([sub({ isActive: false })], [income({ isActive: false })], [], "2026-07-05", 2);
    expect(drafts).toEqual([]);
  });

  it("never creates balance-affecting expected rows for watch-only people", () => {
    const drafts = generateExpected(
      [sub({ personIsSelf: false })],
      [income({ personIsSelf: false })],
      [],
      "2026-07-05",
      2,
    );
    expect(drafts).toEqual([]);
  });

  it("does not bill a subscription before its free trial ends", () => {
    const drafts = generateExpected(
      [sub({ nextDueDate: "2026-07-10", trialEndDate: "2026-08-12" })],
      [],
      [],
      "2026-07-05",
      2,
    );
    expect(drafts.map((draft) => draft.dueDate)).toEqual(["2026-09-10"]);
  });

  it("generates salary as incoming expected with the pay day per month", () => {
    const drafts = generateExpected([], [income({})], [], "2026-07-05", 1);
    expect(drafts.map((d) => [d.direction, d.dueDate])).toEqual([
      ["in", "2026-07-15"],
      ["in", "2026-08-15"],
    ]);
  });

  it("does not generate a salary already past this month", () => {
    const drafts = generateExpected([], [income({ payDay: 1 })], [], "2026-07-05", 0);
    expect(drafts).toEqual([]); // July 1 already passed on July 5, horizon 0 → nothing
  });

  it("clamps subscription billing day in short months", () => {
    const drafts = generateExpected([sub({ nextDueDate: "2026-01-31", billingDay: 31 })], [], [], "2026-01-01", 2);
    expect(drafts.map((d) => d.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("state transitions", () => {
  it("reconciles future unpaid rows without erasing active overdue history", () => {
    const rows = [
      expected({ id: "late", dueDate: "2026-07-01", status: "late" }),
      expected({ id: "future-old", dueDate: "2026-07-20" }),
      expected({ id: "future-kept", dueDate: "2026-08-10" }),
      expected({ id: "paid", dueDate: "2026-09-10", status: "paid" }),
    ];
    const drafts = [{ direction: "out" as const, kind: "subscription" as const, refId: "sub-1", dueDate: "2026-08-10", amountMinor: 1, currency: "TRY" }];
    expect(obsoleteExpectedIds(rows, drafts, "2026-07-15", true)).toEqual(["future-old"]);
    expect(obsoleteExpectedIds(rows, [], "2026-07-15", false)).toEqual(["late", "future-old", "future-kept"]);
  });

  it("flags pending items past due as late", () => {
    const items = [expected({ dueDate: "2026-07-01" }), expected({ id: "e2", dueDate: "2026-07-09" })];
    expect(findLate(items, "2026-07-05").map((e) => e.id)).toEqual(["exp-1"]);
  });

  it("does not flag paid/skipped items", () => {
    const items = [expected({ dueDate: "2026-07-01", status: "paid" }), expected({ id: "e2", dueDate: "2026-07-01", status: "skipped" })];
    expect(findLate(items, "2026-07-05")).toEqual([]);
  });

  it("auto-confirms only auto-pay subscriptions that reached their due date", () => {
    const items = [
      expected({ id: "auto-due", refId: "sub-auto", dueDate: "2026-07-05" }),
      expected({ id: "auto-future", refId: "sub-auto", dueDate: "2026-07-20" }),
      expected({ id: "manual-due", refId: "sub-manual", dueDate: "2026-07-05" }),
    ];
    const confirmable = findAutoConfirmable(items, new Set(["sub-auto"]), "2026-07-05");
    expect(confirmable.map((e) => e.id)).toEqual(["auto-due"]);
  });
});

describe("reminder window", () => {
  it("matches items due within N days, inclusive", () => {
    expect(isDueWithin(expected({ dueDate: "2026-07-08" }), "2026-07-05", 3)).toBe(true);
    expect(isDueWithin(expected({ dueDate: "2026-07-09" }), "2026-07-05", 3)).toBe(false);
    expect(isDueWithin(expected({ dueDate: "2026-07-05" }), "2026-07-05", 0)).toBe(true);
    expect(isDueWithin(expected({ dueDate: "2026-07-04" }), "2026-07-05", 3)).toBe(false); // past → late, not upcoming
  });
});

describe("confirmEffectiveDate", () => {
  it("uses the due date once it has passed", () => {
    expect(confirmEffectiveDate("2026-07-10", "2026-07-15")).toBe("2026-07-10");
  });

  it("uses today for a not-yet-due item (never a future ledger date)", () => {
    expect(confirmEffectiveDate("2026-07-20", "2026-07-15")).toBe("2026-07-15");
  });

  it("uses today when due exactly today", () => {
    expect(confirmEffectiveDate("2026-07-15", "2026-07-15")).toBe("2026-07-15");
  });

  it("honours a manual early paidOn (due the 15th, paid the 12th)", () => {
    // The core B1 case: a bill due in the future, paid early — it must realize
    // on the day it was actually paid, not the due date and not today.
    expect(confirmEffectiveDate("2026-07-15", "2026-07-13", "2026-07-12")).toBe("2026-07-12");
  });

  it("honours a manual paidOn that differs from an already-passed due date", () => {
    expect(confirmEffectiveDate("2026-07-10", "2026-07-15", "2026-07-12")).toBe("2026-07-12");
  });

  it("accepts a paidOn equal to today", () => {
    expect(confirmEffectiveDate("2026-07-20", "2026-07-15", "2026-07-15")).toBe("2026-07-15");
  });

  it("rejects a future paidOn and falls back to the default", () => {
    // You cannot have already paid a bill on a day that hasn't arrived.
    expect(confirmEffectiveDate("2026-07-20", "2026-07-15", "2026-07-18")).toBe("2026-07-15");
    expect(confirmEffectiveDate("2026-07-10", "2026-07-15", "2026-07-18")).toBe("2026-07-10");
  });

  it("ignores a null/undefined paidOn", () => {
    expect(confirmEffectiveDate("2026-07-20", "2026-07-15", null)).toBe("2026-07-15");
    expect(confirmEffectiveDate("2026-07-20", "2026-07-15", undefined)).toBe("2026-07-15");
  });
});
