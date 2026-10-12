import { describe, expect, it } from "vitest";
import {
  autoConfirmedTransactionIds,
  confirmEffectiveDate,
  findAutoConfirmable,
  findLate,
  expectationEffect,
  generateExpected,
  obsoleteExpectedIds,
  plannedExpectations,
  selfCellEffect,
} from "../../src/domain/expected";
import type { ExpectedPaymentLike, RecurringIncomeLike, SubscriptionLike } from "../../src/domain/types";
import { tx } from "../helpers";

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
    amountMode: "fixed",
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

  it("marks variable subscription dues as estimates while fixed dues stay known", () => {
    const fixed = generateExpected([sub({})], [], [], "2026-07-05", 0);
    const variable = generateExpected([sub({ amountMode: "variable" })], [], [], "2026-07-05", 0);
    expect(fixed[0]?.amountIsEstimated).toBe(false);
    expect(variable[0]?.amountIsEstimated).toBe(true);
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

  it("keeps a yearly rule's phase when a trial pushes its first charge", () => {
    const drafts = generateExpected(
      [sub({ nextDueDate: "2026-01-10", intervalMonths: 12, cycle: "yearly", trialEndDate: "2026-03-01" })],
      [],
      [],
      "2026-02-15",
      12,
    );
    const dates = drafts.map((draft) => draft.dueDate);
    expect(dates).toEqual(["2027-01-10"]);
    expect(dates).not.toContain("2026-03-10");
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
    const drafts = [{ direction: "out" as const, kind: "subscription" as const, refId: "sub-1", dueDate: "2026-08-10", amountMinor: 1, amountIsEstimated: false, currency: "TRY" }];
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
    const confirmable = findAutoConfirmable(items, new Map([["sub-auto", "2026-06-01"]]), "2026-07-05");
    expect(confirmable.map((e) => e.id)).toEqual(["auto-due"]);
  });

  it("never auto-confirms a variable subscription before its actual amount is entered", () => {
    const items = [expected({ refId: "sub-auto", amountIsEstimated: true, dueDate: "2026-07-05" })];
    expect(findAutoConfirmable(items, new Map([["sub-auto", "2026-06-01"]]), "2026-07-05")).toEqual([]);
  });

  /**
   * Saving a rule is not paying a bill. Without this, an auto-pay subscription
   * created on its own billing day confirmed a realized expense immediately
   * and the current balance fell by its amount before any money moved.
   */
  it("never auto-confirms a billing date the rule was only created on", () => {
    const items = [expected({ id: "same-day", refId: "sub-auto", dueDate: "2026-07-05" })];
    expect(findAutoConfirmable(items, new Map([["sub-auto", "2026-07-05"]]), "2026-07-05")).toEqual([]);
  });

  it("never auto-confirms a billing date that predates the rule", () => {
    const items = [expected({ id: "before", refId: "sub-auto", dueDate: "2026-07-05" })];
    expect(findAutoConfirmable(items, new Map([["sub-auto", "2026-07-09"]]), "2026-07-10")).toEqual([]);
  });

  it("auto-confirms the first billing date that arrives after the rule exists", () => {
    const items = [expected({ id: "next-cycle", refId: "sub-auto", dueDate: "2026-08-05" })];
    expect(
      findAutoConfirmable(items, new Map([["sub-auto", "2026-07-05"]]), "2026-08-05").map((e) => e.id),
    ).toEqual(["next-cycle"]);
  });

  /** A corrupt row must not silently switch a user's automation off. */
  it("keeps documented auto-pay behavior when the creation day is unknown", () => {
    const items = [expected({ id: "unknown-origin", refId: "sub-auto", dueDate: "2026-07-05" })];
    expect(
      findAutoConfirmable(items, new Map([["sub-auto", null]]), "2026-07-05").map((e) => e.id),
    ).toEqual(["unknown-origin"]);
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
    // Paid early: realize on the paid day, not the due date and not today.
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

describe("plannedExpectations", () => {
  const today = "2026-07-18" as const;
  const due = (overrides: Partial<ExpectedPaymentLike>): ExpectedPaymentLike => ({
    id: "e-1",
    direction: "out",
    kind: "subscription",
    refId: "netflix",
    dueDate: "2026-07-28",
    amountMinor: 100_00,
    currency: "TRY",
    status: "pending",
    ...overrides,
  });
  const rules = new Map([["netflix", { categoryId: "cat-fun", name: "Netflix" }]]);
  const planned = (expected: ExpectedPaymentLike[], transactions = [tx({ type: "expense", amountTryMinor: 1, effectiveDate: "2026-07-01" })]) =>
    plannedExpectations({
      expected,
      transactions,
      today,
      toTryMinor: (currency, amountMinor) => (currency === "TRY" ? amountMinor : currency === "USD" ? amountMinor * 40 : null),
      ruleOf: (_kind, refId) => rules.get(refId),
    });

  it("draws an unpaid expectation due today or later in its rule's category, in TRY", () => {
    expect(planned([due({}), due({ id: "e-usd", dueDate: today, amountMinor: 10_00, currency: "USD" })])).toEqual([
      { id: "e-1", kind: "subscription", refId: "netflix", direction: "out", dueDate: "2026-07-28", amountTryMinor: 100_00, categoryId: "cat-fun", name: "Netflix" },
      { id: "e-usd", kind: "subscription", refId: "netflix", direction: "out", dueDate: today, amountTryMinor: 400_00, categoryId: "cat-fun", name: "Netflix" },
    ]);
  });

  it("leaves out what is settled, what is already late, and what has no rate", () => {
    expect(planned([
      due({ id: "paid", status: "paid" }),
      due({ id: "skipped", status: "skipped" }),
      due({ id: "late", status: "late", dueDate: "2026-07-17" }),
      due({ id: "overdue", dueDate: "2026-07-17" }),
      due({ id: "no-rate", currency: "CHF" }),
    ])).toEqual([]);
  });

  it("counts one obligation once when a pending row already carries it", () => {
    const pendingRow = tx({ type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-28", status: "pending", subscriptionId: "netflix" });
    expect(planned([due({})], [pendingRow])).toEqual([]);
    // Another day of the same rule is another occurrence.
    expect(planned([due({ dueDate: "2026-08-28" })], [pendingRow])).toHaveLength(1);
  });

  it("lets only the owner's own pending row stand in for it", () => {
    const sameOccurrence = { type: "expense", amountTryMinor: 100_00, effectiveDate: "2026-07-28", subscriptionId: "netflix" } as const;
    expect(planned([due({})], [tx({ ...sameOccurrence, status: "pending", personIsSelf: false })])).toHaveLength(1);
    expect(planned([due({})], [tx({ ...sameOccurrence, status: "realized" })])).toHaveLength(1);
  });

  it("lets the due date decide, not a late mark", () => {
    expect(planned([due({ status: "late" })])).toHaveLength(1);
  });

  it("moves the balance the way a row in its direction would", () => {
    expect(expectationEffect({ direction: "in", amountTryMinor: 500_00 })).toBe(500_00);
    expect(expectationEffect({ direction: "out", amountTryMinor: 100_00 })).toBe(-100_00);
  });

  it("keeps an expectation whose rule is gone, uncategorised and unnamed", () => {
    expect(planned([due({ refId: "deleted-rule" })])[0]).toMatchObject({ categoryId: null, name: null });
  });
});

describe("autoConfirmedTransactionIds", () => {
  it("names the rows auto-pay recorded, and none the owner confirmed", () => {
    expect(autoConfirmedTransactionIds([
      { autoConfirmed: true, transactionId: "tx-auto" },
      { autoConfirmed: false, transactionId: "tx-confirmed" },
      // A mark with no row behind it has nothing to label.
      { autoConfirmed: true, transactionId: null },
    ])).toEqual(new Set(["tx-auto"]));
  });
});

describe("weekly recurring income", () => {
  it("generates weekly expecteds and requires an anchor", () => {
    const income = {
      id: "weekly", name: "Vardiya", defaultAmountMinor: 100_00, currency: "TRY", payDay: 18,
      recurrence: "weekly" as const, anchorDate: "2026-07-18", isActive: true, personIsSelf: true,
    };
    const first = generateExpected([], [income], [], "2026-07-18", 1);
    expect(first.map((draft) => draft.dueDate)).toEqual([
      "2026-07-18", "2026-07-25", "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29",
    ]);
    expect(generateExpected([], [{ ...income, anchorDate: null }], [], "2026-07-18", 1)).toEqual([]);
  });
});

describe("schedule generation fails closed on a corrupt day", () => {
  const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  it("generates nothing for a subscription whose billing day is corrupt", () => {
    const healthy = generateExpected([sub({})], [], [], "2026-07-01", 3);
    expect(healthy.length).toBeGreaterThan(0);
    for (const d of healthy) expect(d.dueDate).toMatch(ISO_DATE);

    expect(generateExpected([sub({ billingDay: 0 })], [], [], "2026-07-01", 3)).toEqual([]);
    expect(generateExpected([sub({ billingDay: NaN })], [], [], "2026-07-01", 3)).toEqual([]);
  });

  it("generates nothing for a monthly income whose pay day is corrupt", () => {
    expect(generateExpected([], [income({})], [], "2026-07-01", 3).length).toBeGreaterThan(0);
    expect(generateExpected([], [income({ payDay: 0 })], [], "2026-07-01", 3)).toEqual([]);
  });
});

describe("expected-item draft and boundary contract", () => {
  const dueRow = (overrides: Partial<ExpectedPaymentLike> = {}): ExpectedPaymentLike => ({
    id: "e", direction: "out", kind: "subscription", refId: "s", dueDate: "2026-07-18",
    amountMinor: 100, currency: "TRY", status: "pending", ...overrides,
  });

  const dueSub = (overrides: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
    id: "s", name: "Abonelik", amountMinor: 100, currency: "TRY", cycle: "monthly", intervalMonths: 1,
    billingDay: 18, nextDueDate: "2026-07-18", isActive: true, autoPay: false, personIsSelf: true,
    trialEndDate: null, amountMode: "fixed", ...overrides,
  });

  const dueIncome = (overrides: Partial<RecurringIncomeLike> = {}): RecurringIncomeLike => ({
    id: "i", name: "Gelir", defaultAmountMinor: 200, currency: "TRY", payDay: 18,
    isActive: true, personIsSelf: true, ...overrides,
  });

  it("pins obsolete-row status, activity, date, identity, and output id", () => {
    const rows = [
      dueRow({ id: "past-pending", dueDate: "2026-07-17" }),
      dueRow({ id: "today-pending", dueDate: "2026-07-18" }),
      dueRow({ id: "future-late", dueDate: "2026-07-19", status: "late" }),
      dueRow({ id: "future-paid", dueDate: "2026-07-19", status: "paid" }),
    ];
    const draft = [{ direction: "out" as const, kind: "subscription" as const, refId: "s", dueDate: "2026-07-19", amountMinor: 100, amountIsEstimated: false, currency: "TRY" }];
    expect(obsoleteExpectedIds(rows, draft, "2026-07-18", true)).toEqual(["today-pending"]);
    expect(obsoleteExpectedIds(rows, [], "2026-07-18", false)).toEqual(["past-pending", "today-pending", "future-late"]);
  });

  it("generates exact fixed, variable, weekly, and biweekly draft fields in sorted order", () => {
    const drafts = generateExpected(
      [
        dueSub({ id: "fixed" }),
        dueSub({ id: "variable", amountMode: "variable", nextDueDate: "2026-07-19", billingDay: 19 }),
      ],
      [
        dueIncome({ id: "weekly", recurrence: "weekly", anchorDate: "2026-07-18" }),
        dueIncome({ id: "biweekly", recurrence: "biweekly", anchorDate: "2026-07-19" }),
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
      [dueSub({ id: "trial-ended", nextDueDate: "2026-07-20", billingDay: 20, trialEndDate: "2026-07-01" })],
      [dueIncome({ id: "monthly", recurrence: "monthly", payDay: 18 }), dueIncome({ id: "duplicate", recurrence: "monthly", payDay: 18 })],
      existing, "2026-07-18", 0,
    )).toEqual([
      { direction: "in", kind: "recurring_income", refId: "monthly", dueDate: "2026-07-18", amountMinor: 200, amountIsEstimated: false, currency: "TRY" },
      { direction: "out", kind: "subscription", refId: "trial-ended", dueDate: "2026-07-20", amountMinor: 100, amountIsEstimated: false, currency: "TRY" },
    ]);
  });

  it("does not move the stored next due date backward after a trial already ended", () => {
    expect(generateExpected([
      dueSub({ id: "ended", nextDueDate: "2026-08-20", billingDay: 20, trialEndDate: "2026-07-01" }),
    ], [], [], "2026-07-18", 1).map((draft) => draft.dueDate)).toEqual(["2026-08-20"]);
  });

  it("anchors trials on or after their exact end boundary", () => {
    expect(generateExpected([dueSub({ nextDueDate: "2026-07-10", billingDay: 18, trialEndDate: "2026-07-18" })], [], [], "2026-07-01", 0)
      .map((draft) => draft.dueDate)).toEqual(["2026-07-18"]);
    expect(generateExpected([dueSub({ nextDueDate: "2026-07-10", billingDay: 18, trialEndDate: "2026-07-19" })], [], [], "2026-07-01", 1)
      .map((draft) => draft.dueDate)).toEqual(["2026-08-18"]);
  });

  it("leaves a stored next due date off the billing day alone once the trial is over", () => {
    // Re-anchoring would snap 07-10 forward to the billing day, 07-18.
    for (const trialEndDate of ["2026-07-01", "2026-07-10"]) {
      expect(generateExpected([dueSub({ nextDueDate: "2026-07-10", billingDay: 18, trialEndDate })], [], [], "2026-07-01", 0)
        .map((draft) => draft.dueDate), trialEndDate).toEqual(["2026-07-10"]);
    }
  });

  it("pins confirmation, lateness and autopay equality boundaries", () => {
    expect(confirmEffectiveDate("2026-07-18", "2026-07-18", "2026-07-18")).toBe("2026-07-18");
    expect(confirmEffectiveDate("2026-07-17", "2026-07-18", "2026-07-19")).toBe("2026-07-17");
    expect(confirmEffectiveDate("2026-07-17", "2026-07-18", "2026-07-18")).toBe("2026-07-18");
    expect(findLate([dueRow({ id: "yesterday", dueDate: "2026-07-17" }), dueRow({ id: "today", dueDate: "2026-07-18" })], "2026-07-18").map((row) => row.id)).toEqual(["yesterday"]);
    expect(findAutoConfirmable([
      dueRow({ id: "today", dueDate: "2026-07-18" }),
      dueRow({ id: "income", dueDate: "2026-07-18", kind: "recurring_income" }),
      dueRow({ id: "estimated", dueDate: "2026-07-18", amountIsEstimated: true }),
    ], new Map([["s", "2026-07-01"]]), "2026-07-18").map((row) => row.id)).toEqual(["today"]);
    expect(findAutoConfirmable([
      dueRow({ id: "late", dueDate: "2026-07-17", status: "late" }),
    ], new Map([["s", "2026-07-01"]]), "2026-07-18")).toEqual([]);
  });
});

describe("what a category's cell does to the owner's balance", () => {
  const self = new Set(["me"]);

  it("signs the owner's rows by the category's kind and adds planned effects", () => {
    const rows = [
      { personId: "me", type: "expense" as const, amountTryMinor: 1_000 },
      { personId: "me", type: "expense" as const, amountTryMinor: -250 },
      { personId: "other", type: "expense" as const, amountTryMinor: 9_999 },
    ];
    expect(selfCellEffect(rows, self, "expense", [])).toBe(-750);
    expect(selfCellEffect(rows, self, "expense", [
      { direction: "out", amountTryMinor: 100 },
      { direction: "in", amountTryMinor: 30 },
    ])).toBe(-820);
  });

  it("reads income rows as money in, and a transfer as money out", () => {
    expect(selfCellEffect([{ personId: "me", type: "income", amountTryMinor: 500 }], self, "income", [])).toBe(500);
    expect(selfCellEffect([{ personId: "me", type: "transfer", amountTryMinor: 500 }], self, "expense", [])).toBe(-500);
  });

  it("is zero with nothing of the owner's and nothing planned", () => {
    expect(selfCellEffect([{ personId: "other", type: "income", amountTryMinor: 500 }], self, null, [])).toBe(0);
    expect(selfCellEffect([], new Set(), null, [{ direction: "in", amountTryMinor: 1 }])).toBe(1);
  });
});
