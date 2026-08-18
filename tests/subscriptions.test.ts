import { describe, expect, it } from "vitest";
import { findSubscriptionCategory, subscriptionCostSummary } from "../src/domain/subscriptions";
import { normalizedMonthlyLoadMinor } from "../src/domain/analytics";

describe("subscription category reuse", () => {
  it("reuses the same live expense category with Turkish-aware normalization", () => {
    const categories = [
      { id: "existing", name: "  ABONELİKLER ", kind: "expense" as const, deletedAt: null },
      { id: "income", name: "Abonelikler", kind: "income" as const, deletedAt: null },
    ];
    expect(findSubscriptionCategory(categories, "Abonelikler")?.id).toBe("existing");
    expect(findSubscriptionCategory(categories, "abonelikler")?.id).toBe("existing");
  });

  it("does not revive a deleted category through the read path", () => {
    expect(
      findSubscriptionCategory(
        [{ id: "deleted", name: "Abonelikler", kind: "expense", deletedAt: "2026-07-15T10:00:00Z" }],
        "Abonelikler",
      ),
    ).toBeNull();
  });
});

/**
 * `price_history` has been written on every price edit since the table
 * existed and read by nothing. These fix what reading it means, so a stored
 * row can never be presented as a change it is not.
 */
describe("subscription cost summary", () => {
  const TODAY = "2026-08-18";
  const rule = (over: Partial<Parameters<typeof subscriptionCostSummary>[0][number]> = {}) => ({
    id: "sub-1",
    name: "Netflix",
    amountMinor: 200_00,
    currency: "TRY",
    intervalMonths: 1,
    nextDueDate: "2026-09-05",
    isActive: true,
    ...over,
  });
  const summary = (
    subs: Parameters<typeof subscriptionCostSummary>[0],
    history: Parameters<typeof subscriptionCostSummary>[1] = [],
    limit?: number,
  ) => subscriptionCostSummary(subs, history, TODAY, normalizedMonthlyLoadMinor, limit);

  it("states the yearly cost as twelve of the same monthly load", () => {
    const result = summary([
      rule(),
      rule({ id: "sub-2", name: "Yıllık", amountMinor: 1_200_00, intervalMonths: 12 }),
    ]);
    expect(result.monthlyTryMinor).toBe(300_00);
    expect(result.annualTryMinor).toBe(3_600_00);
  });

  it("counts a rule it cannot convert instead of dropping it from the total", () => {
    const result = summary([rule(), rule({ id: "sub-2", name: "Spotify", currency: "USD", amountMinor: 10_00 })]);
    expect(result.monthlyTryMinor).toBe(200_00);
    expect(result.excludedCurrencyCount).toBe(1);
  });

  it("ignores cancelled rules in both the cost and the next renewal", () => {
    const result = summary([rule({ isActive: false })]);
    expect(result.monthlyTryMinor).toBe(0);
    expect(result.annualTryMinor).toBe(0);
    expect(result.nextRenewal).toBeNull();
  });

  /** Deliberately given out of order: the soonest is found, not the first. */
  it("reports the soonest upcoming charge, never one already past", () => {
    const result = summary([
      rule({ id: "later", name: "Uzak", nextDueDate: "2026-12-01" }),
      rule({ id: "late", name: "Geçmiş", nextDueDate: "2026-08-01" }),
      rule({ id: "soon", name: "Yakın", nextDueDate: "2026-08-20" }),
      rule({ id: "mid", name: "Orta", nextDueDate: "2026-09-15" }),
    ]);
    expect(result.nextRenewal).toMatchObject({ subscriptionId: "soon", dueDate: "2026-08-20" });
  });

  /** Due today is still due: a charge dated today has not been paid yet. */
  it("counts a charge due today as the next renewal", () => {
    const result = summary([
      rule({ id: "tomorrow", name: "Yarın", nextDueDate: "2026-08-19" }),
      rule({ id: "today", name: "Bugün", nextDueDate: TODAY }),
    ]);
    expect(result.nextRenewal).toMatchObject({ subscriptionId: "today", dueDate: TODAY });
  });

  it("treats a rule's first stored price as its opening price, not a change", () => {
    const result = summary([rule()], [
      { subscriptionId: "sub-1", amountMinor: 150_00, currency: "TRY", effectiveFrom: "2026-01-01" },
    ]);
    expect(result.recentChanges).toEqual([]);
  });

  it("reads consecutive stored prices as one change each, newest first", () => {
    const result = summary([rule()], [
      { subscriptionId: "sub-1", amountMinor: 150_00, currency: "TRY", effectiveFrom: "2026-01-01" },
      { subscriptionId: "sub-1", amountMinor: 200_00, currency: "TRY", effectiveFrom: "2026-06-01" },
      { subscriptionId: "sub-1", amountMinor: 180_00, currency: "TRY", effectiveFrom: "2026-03-01" },
    ]);
    expect(result.recentChanges).toEqual([
      { subscriptionId: "sub-1", name: "Netflix", currency: "TRY", fromMinor: 180_00, toMinor: 200_00, changedOn: "2026-06-01" },
      { subscriptionId: "sub-1", name: "Netflix", currency: "TRY", fromMinor: 150_00, toMinor: 180_00, changedOn: "2026-03-01" },
    ]);
  });

  it("never reads a currency switch as a rise or a fall", () => {
    const result = summary([rule()], [
      { subscriptionId: "sub-1", amountMinor: 100_00, currency: "TRY", effectiveFrom: "2026-01-01" },
      { subscriptionId: "sub-1", amountMinor: 5_00, currency: "USD", effectiveFrom: "2026-02-01" },
    ]);
    expect(result.recentChanges).toEqual([]);
  });

  it("keeps history for a deleted rule out of the report", () => {
    const result = summary([], [
      { subscriptionId: "gone", amountMinor: 100_00, currency: "TRY", effectiveFrom: "2026-01-01" },
      { subscriptionId: "gone", amountMinor: 120_00, currency: "TRY", effectiveFrom: "2026-02-01" },
    ]);
    expect(result.recentChanges).toEqual([]);
  });

  /**
   * `upsertSubscription` only appends when the price actually moved, but a
   * restored backup or a sync merge can still land two equal rows. An equal
   * pair is not a change and must not be reported as one.
   */
  it("does not read two equal stored prices as a change", () => {
    const result = summary([rule()], [
      { subscriptionId: "sub-1", amountMinor: 150_00, currency: "TRY", effectiveFrom: "2026-01-01" },
      { subscriptionId: "sub-1", amountMinor: 150_00, currency: "TRY", effectiveFrom: "2026-02-01" },
      { subscriptionId: "sub-1", amountMinor: 175_00, currency: "TRY", effectiveFrom: "2026-03-01" },
    ]);
    expect(result.recentChanges).toEqual([
      { subscriptionId: "sub-1", name: "Netflix", currency: "TRY", fromMinor: 150_00, toMinor: 175_00, changedOn: "2026-03-01" },
    ]);
  });

  /**
   * Same-day changes fall back to the name, collated in Turkish: "Su" comes
   * before "Şarap" because s precedes ş, which the default collation reverses.
   * Three rules, so the comparator is exercised on more than one pair.
   */
  it("orders same-day changes by Turkish-collated name", () => {
    const priced = (id: string, day: string, from: number, to: number) => [
      { subscriptionId: id, amountMinor: from, currency: "TRY", effectiveFrom: "2026-01-01" },
      { subscriptionId: id, amountMinor: to, currency: "TRY", effectiveFrom: day },
    ];
    const result = summary(
      [
        rule({ id: "sarap", name: "Şarap" }),
        rule({ id: "su", name: "Su" }),
        rule({ id: "tuz", name: "Tuz" }),
      ],
      [
        ...priced("sarap", "2026-05-01", 100_00, 110_00),
        ...priced("su", "2026-05-01", 200_00, 220_00),
        ...priced("tuz", "2026-05-01", 300_00, 330_00),
      ],
      5,
    );
    expect(result.recentChanges.map((change) => change.name)).toEqual(["Su", "Şarap", "Tuz"]);
  });

  it("puts the newest change first regardless of the order it was stored in", () => {
    const result = summary([rule()], [
      { subscriptionId: "sub-1", amountMinor: 100_00, currency: "TRY", effectiveFrom: "2026-02-01" },
      { subscriptionId: "sub-1", amountMinor: 130_00, currency: "TRY", effectiveFrom: "2026-07-01" },
      { subscriptionId: "sub-1", amountMinor: 110_00, currency: "TRY", effectiveFrom: "2026-04-01" },
      { subscriptionId: "sub-1", amountMinor: 120_00, currency: "TRY", effectiveFrom: "2026-05-01" },
    ], 5);
    expect(result.recentChanges.map((change) => change.changedOn))
      .toEqual(["2026-07-01", "2026-05-01", "2026-04-01"]);
  });

  it("keeps the list short", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      subscriptionId: "sub-1",
      amountMinor: 100_00 + index * 10_00,
      currency: "TRY",
      effectiveFrom: `2026-0${index + 1}-01`,
    }));
    expect(summary([rule()], history, 3).recentChanges).toHaveLength(3);
    expect(summary([rule()], history, 0).recentChanges).toEqual([]);
  });
});
