import { describe, expect, it, vi } from "vitest";
import {
  AMOUNT_LABELS,
  findSubscriptionCategory,
  hasUnknownAmount,
  isVariableSubscriptionOccurrence,
  lastRealizedCharges,
  needsVariableAmountEntry,
  occurrenceAmountText,
  subscriptionCostSummary,
  variableAmountBand,
} from "../../src/domain/subscriptions";

describe("subscription category reuse", () => {
  it("reuses the same live expense category with Turkish-aware normalization", () => {
    const categories = [
      { id: "existing", name: "  ABONELİKLER ", kind: "expense" as const, deletedAt: null },
      { id: "income", name: "Abonelikler", kind: "income" as const, deletedAt: null },
    ];
    expect(findSubscriptionCategory(categories, "Abonelikler")?.id).toBe("existing");
    expect(findSubscriptionCategory(categories, "abonelikler")?.id).toBe("existing");
    expect(findSubscriptionCategory([categories[1]!], "Abonelikler")).toBeNull();
  });

  it("does not revive a deleted category through the read path", () => {
    expect(
      findSubscriptionCategory(
        [{ id: "deleted", name: "Abonelikler", kind: "expense", deletedAt: "2026-07-15T10:00:00Z" }],
        "Abonelikler",
      ),
    ).toBeNull();
  });

  it("normalizes category names without changing category eligibility", () => {
    const categories = [
      { id: "match", name: "  ABONELİKLER   VE SERVİSLER ", kind: "expense" as const, deletedAt: null },
      { id: "income", name: "Abonelikler ve Servisler", kind: "income" as const, deletedAt: null },
    ];
    expect(findSubscriptionCategory(categories, "abonelikler ve servisler")?.id).toBe("match");
    expect(findSubscriptionCategory([
      { id: "wrong", name: "Market", kind: "expense", deletedAt: null },
      { id: "right", name: "Abonelikler", kind: "expense", deletedAt: null },
    ], "abonelikler")?.id).toBe("right");
    expect(findSubscriptionCategory([
      { id: "spacing", name: "ab c", kind: "expense", deletedAt: null },
    ], "a bc")).toBeNull();
    expect(AMOUNT_LABELS).toEqual({ unknown: "Tutar belirtilmedi", estimated: "Tahmini tutar" });
  });
});

/** What reading `price_history` means, so a stored row is never presented as a change it is not. */
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
  ) => subscriptionCostSummary(subs, history, TODAY, limit);

  it("states the yearly cost as what the rules charge in a year, not twelve rounded months", () => {
    const result = summary([
      rule(),
      rule({ id: "sub-2", name: "Yıllık", amountMinor: 1_199_00, intervalMonths: 12 }),
    ]);
    expect(result.monthlyTryMinor).toBe(299_92);
    expect(result.annualTryMinor).toBe(3_599_00);
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

/** A variable bill stores 0 for "invoice not arrived"; it must never render as ₺0,00 or join the total silently. */
describe("variable subscription amounts", () => {
  const TODAY = "2026-08-23";
  const variable = (over = {}) => ({
    id: "elektrik",
    name: "Elektrik",
    amountMinor: 0,
    currency: "TRY",
    intervalMonths: 1,
    nextDueDate: "2026-08-28",
    isActive: true,
    amountMode: "variable" as const,
    ...over,
  });

  it("counts an active variable rule with no invoice yet", () => {
    const result = subscriptionCostSummary(
      [variable(), { ...variable({ id: "netflix", name: "Netflix", amountMinor: 200_00, amountMode: "fixed" as const }) }],
      [],
      TODAY,
    );
    expect(result.unknownAmountCount).toBe(1);
    // The total is still stated; what changes is that the omission is declared.
    expect(result.monthlyTryMinor).toBe(200_00);
  });

  it("does not count a variable rule whose invoice is already entered", () => {
    const result = subscriptionCostSummary(
      [variable({ amountMinor: 1_450_00 })],
      [],
      TODAY,
    );
    expect(result.unknownAmountCount).toBe(0);
    expect(result.monthlyTryMinor).toBe(1_450_00);
  });

  it("does not count a fixed rule at zero, which is a stated amount", () => {
    expect(subscriptionCostSummary([variable({ amountMode: "fixed" as const })], [], TODAY).unknownAmountCount).toBe(0);
  });

  it("does not count a cancelled variable rule", () => {
    expect(
      subscriptionCostSummary([variable({ isActive: false })], [], TODAY).unknownAmountCount,
    ).toBe(0);
  });

  it("builds a band from what the bill has actually charged", () => {
    const band = variableAmountBand([
      { subscriptionId: "elektrik", amountMinor: 1_100_00, currency: "TRY", effectiveFrom: "2026-05-01" },
      { subscriptionId: "elektrik", amountMinor: 1_800_00, currency: "TRY", effectiveFrom: "2026-06-01" },
      { subscriptionId: "elektrik", amountMinor: 1_450_00, currency: "TRY", effectiveFrom: "2026-07-01" },
    ], "TRY");
    expect(band).toEqual({ minMinor: 1_100_00, maxMinor: 1_800_00, currency: "TRY", samples: 3 });
  });

  it("ignores the zero sentinel and other currencies when building the band", () => {
    const band = variableAmountBand([
      { subscriptionId: "elektrik", amountMinor: 0, currency: "TRY", effectiveFrom: "2026-05-01" },
      { subscriptionId: "elektrik", amountMinor: 900_00, currency: "USD", effectiveFrom: "2026-06-01" },
      { subscriptionId: "elektrik", amountMinor: 1_450_00, currency: "TRY", effectiveFrom: "2026-07-01" },
    ], "TRY");
    expect(band).toEqual({ minMinor: 1_450_00, maxMinor: 1_450_00, currency: "TRY", samples: 1 });
  });

  it("has no band at all when nothing has been charged", () => {
    expect(variableAmountBand([], "TRY")).toBeNull();
    expect(variableAmountBand([
      { subscriptionId: "elektrik", amountMinor: 0, currency: "TRY", effectiveFrom: "2026-05-01" },
    ], "TRY")).toBeNull();
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
});

describe("each subscription's last realized charge", () => {
  it("keeps the latest realized date per subscription and ignores the rest", () => {
    const latest = lastRealizedCharges([
      { subscriptionId: "s1", status: "realized", effectiveDate: "2026-05-01" },
      { subscriptionId: "s1", status: "realized", effectiveDate: "2026-06-01" },
      { subscriptionId: "s1", status: "realized", effectiveDate: "2026-04-01" },
      { subscriptionId: "s1", status: "pending", effectiveDate: "2026-07-01" },
      { subscriptionId: "s2", status: "realized", effectiveDate: "2026-06-15" },
      { subscriptionId: "s2", status: "realized", effectiveDate: "2026-06-15" },
      { subscriptionId: null, status: "realized", effectiveDate: "2026-08-01" },
      { subscriptionId: "", status: "realized", effectiveDate: "2026-08-01" },
      { status: "realized", effectiveDate: "2026-08-01" },
      { subscriptionId: "s3", status: "pending", effectiveDate: "2026-08-01" },
    ]);
    expect(latest).toEqual(new Map([["s1", "2026-06-01"], ["s2", "2026-06-15"]]));
  });

  it("is empty with no rows", () => {
    expect(lastRealizedCharges([]).size).toBe(0);
  });
});
