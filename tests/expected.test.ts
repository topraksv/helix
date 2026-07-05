import { describe, expect, it } from "vitest";
import {
  findAutoConfirmable,
  findLate,
  generateExpected,
  isDueWithin,
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
