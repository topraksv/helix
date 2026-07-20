/**
 * Corrupt nominal days and intervals reach the domain from two places the forms
 * do not guard: a hand-edited JSON backup and a tampered/merged sync row. Each
 * of the three failures below was reproduced before the fix.
 */

import { describe, expect, it } from "vitest";

import { normalizedMonthlyLoadMinor } from "../src/domain/analytics";
import { clampDayToMonth } from "../src/domain/dates";
import { generateExpected } from "../src/domain/expected";
import { generateSchedule } from "../src/domain/installments";
import { dueDatesInRange } from "../src/domain/recurrence";
import { resolveYearColumns } from "../src/domain/year-columns";
import type { Minor } from "../src/domain/money";
import type { RecurringIncomeLike, SubscriptionLike } from "../src/domain/types";

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function subscription(overrides: Partial<SubscriptionLike>): SubscriptionLike {
  return {
    id: "sub-1",
    name: "Netflix",
    amountMinor: 10_000 as Minor,
    currency: "TRY",
    cycle: "monthly",
    intervalMonths: 1,
    billingDay: 15,
    nextDueDate: "2026-07-15",
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
    defaultAmountMinor: 50_000 as Minor,
    currency: "TRY",
    payDay: 1,
    recurrence: "monthly",
    anchorDate: null,
    isActive: true,
    personIsSelf: true,
    ...overrides,
  };
}

describe("clampDayToMonth", () => {
  it("still clamps a legitimate nominal day into a short month", () => {
    expect(clampDayToMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(clampDayToMonth(2024, 2, 31)).toBe("2024-02-29");
    expect(clampDayToMonth(2026, 3, 15)).toBe("2026-03-15");
  });

  it("refuses to fabricate a date from a day outside 1–31", () => {
    // Before the fix these returned "2026-03-00", "2026-03-NaN" and "2026-03--5",
    // which then sorted and compared as if they were real dates.
    for (const day of [0, -5, 32, 99, NaN, 1.5, Infinity]) {
      expect(() => clampDayToMonth(2026, 3, day)).toThrow(/invalid day of month/i);
    }
  });
});

describe("schedule generation fails closed on a corrupt day", () => {
  it("produces no due dates for an out-of-range billing day", () => {
    expect(dueDatesInRange("2026-07-15", 1, 15, "2026-07-01", "2026-10-01").length).toBeGreaterThan(0);
    for (const day of [0, -1, 45, NaN]) {
      expect(dueDatesInRange("2026-07-15", 1, day, "2026-07-01", "2026-10-01")).toEqual([]);
    }
  });

  it("generates nothing for a subscription whose billing day is corrupt", () => {
    const healthy = generateExpected([subscription({})], [], [], "2026-07-01", 3);
    expect(healthy.length).toBeGreaterThan(0);
    for (const d of healthy) expect(d.dueDate).toMatch(ISO_DATE);

    expect(generateExpected([subscription({ billingDay: 0 })], [], [], "2026-07-01", 3)).toEqual([]);
    expect(generateExpected([subscription({ billingDay: NaN })], [], [], "2026-07-01", 3)).toEqual([]);
  });

  it("generates nothing for a monthly income whose pay day is corrupt", () => {
    expect(generateExpected([], [income({})], [], "2026-07-01", 3).length).toBeGreaterThan(0);
    expect(generateExpected([], [income({ payDay: 0 })], [], "2026-07-01", 3)).toEqual([]);
  });

  it("falls back to day 1 rather than throwing inside an installment schedule", () => {
    const schedule = generateSchedule(
      {
        id: "plan-1",
        kind: "card_installment",
        startMonth: "2026-07",
        installmentCount: 3,
        totalAmountMinor: 30_000 as Minor,
        monthlyAmountMinor: null,
        currency: "TRY",
        dueDay: 0,
        personIsSelf: true,
      },
      "2026-07-20",
    );
    expect(schedule).toHaveLength(3);
    for (const item of schedule) expect(item.effectiveDate).toMatch(ISO_DATE);
    expect(schedule[0]?.effectiveDate).toBe("2026-07-01");
  });
});

describe("normalizedMonthlyLoadMinor", () => {
  it("divides a real interval", () => {
    expect(normalizedMonthlyLoadMinor(120_000 as Minor, 12)).toBe(10_000);
  });

  it("never returns a non-integer that formatMinor would throw on", () => {
    // interval 0 produced Infinity, which reached formatMinor and threw
    // assertMinor during render of the subscriptions screen.
    for (const interval of [0, -1, NaN, 1.5]) {
      const value = normalizedMonthlyLoadMinor(120_000 as Minor, interval);
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });
});

describe("resolveYearColumns", () => {
  const categories = [
    { id: "a", isColumn: true },
    { id: "b", isColumn: true },
  ];

  it("keeps honouring a well-formed membership record", () => {
    expect(resolveYearColumns(categories, { "2026": ["a"] }, 2026, 2026, new Set()).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(resolveYearColumns(categories, { "2026": ["a"] }, 2026, 2030, new Set()).map((c) => c.id)).toEqual(["a"]);
  });

  it("ignores a malformed entry instead of crashing the matrix render", () => {
    // `column_years` is a synced settings value parsed with an unchecked cast,
    // so a non-array entry threw "ids is not iterable" during render.
    for (const malformed of [5, "abc", null, { nested: true }]) {
      const record = { "2026": malformed } as unknown as Record<string, string[]>;
      expect(() => resolveYearColumns(categories, record, 2026, 2026, new Set())).not.toThrow();
    }
    const otherYearMalformed = { "2025": 5, "2026": ["a"] } as unknown as Record<string, string[]>;
    expect(() => resolveYearColumns(categories, otherYearMalformed, 2026, 2030, new Set())).not.toThrow();
  });
});
