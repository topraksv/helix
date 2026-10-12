import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  addMonthsToKey,
  assertISODate,
  clampDayToMonth,
  dateForMonthEntry,
  daysBetweenISO,
  daysInMonth,
  firstDayOf,
  isCurrentOrFutureMonth,
  isISODate,
  isMonthDay,
  isMonthKey,
  lastDayOf,
  localDayOfTimestamp,
  makeMonthKey,
  monthKeyOf,
  monthRange,
} from "../../src/domain/dates";
import { orderLedgerCategories, resolveYearColumns } from "../../src/domain/year-columns";

describe("addDaysISO", () => {
  it("adds and subtracts days without timezone drift", () => {
    expect(addDaysISO("2026-07-15", -3)).toBe("2026-07-12");
    expect(addDaysISO("2026-07-15", 3)).toBe("2026-07-18");
    expect(addDaysISO("2026-07-11", 30)).toBe("2026-08-10");
  });

  it("crosses month/year/leap boundaries", () => {
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDaysISO("2025-02-28", 1)).toBe("2025-03-01"); // non-leap
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("delta 0 is identity", () => {
    expect(addDaysISO("2026-07-11", 0)).toBe("2026-07-11");
  });

  it("preserves month/day algebra across the full 400-year Gregorian cycle", () => {
    for (let year = 2000; year < 2400; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const key = makeMonthKey(year, month);
        const next = addMonthsToKey(key, 1);
        const first = firstDayOf(key);
        const nextFirst = firstDayOf(next);
        const last = lastDayOf(key);

        expect(monthRange(key, next)).toEqual([key, next]);
        expect(isISODate(last)).toBe(true);
        expect(addDaysISO(last, 1)).toBe(nextFirst);
        expect(daysBetweenISO(first, nextFirst)).toBe(daysInMonth(year, month));
      }
    }
  });
});

describe("daysBetweenISO", () => {
  it("returns signed calendar-day distance across month and leap boundaries", () => {
    expect(daysBetweenISO("2026-07-15", "2026-07-18")).toBe(3);
    expect(daysBetweenISO("2026-07-18", "2026-07-15")).toBe(-3);
    expect(daysBetweenISO("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("dateForMonthEntry", () => {
  it("uses today for the current month so a quick entry affects today's balance", () => {
    expect(dateForMonthEntry("2026-07", "2026-07-16")).toBe("2026-07-16");
  });

  it("uses a deterministic day when another month was explicitly selected", () => {
    expect(dateForMonthEntry("2026-06", "2026-07-16")).toBe("2026-06-15");
    expect(dateForMonthEntry("2026-08", "2026-07-16")).toBe("2026-08-15");
  });
});

describe("ISO calendar dates", () => {
  it("accepts real dates, including leap day", () => {
    expect(isISODate("2024-02-29")).toBe(true);
    expect(assertISODate("2026-12-31")).toBe("2026-12-31");
  });

  it("rejects impossible and malformed dates", () => {
    for (const value of ["0000-01-01", "2026-02-29", "2026-02-31", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-01", null]) {
      expect(isISODate(value)).toBe(false);
    }
    expect(() => assertISODate("2026-02-31")).toThrow(/Invalid ISO date/);
  });
});

describe("recurring month days", () => {
  it("accepts 31 as the stable month-end sentinel", () => {
    expect(isMonthDay("31")).toBe(true);
    expect(clampDayToMonth(2026, 2, 31)).toBe("2026-02-28");
    expect(clampDayToMonth(2024, 2, 31)).toBe("2024-02-29");
    expect(clampDayToMonth(2026, 4, 31)).toBe("2026-04-30");
    expect(clampDayToMonth(2026, 3, 15)).toBe("2026-03-15");
  });

  it("refuses to fabricate a date from a day outside 1–31", () => {
    // A fabricated "2026-03-00" would sort and compare as a real date.
    for (const day of [0, -5, 32, 99, NaN, 1.5, Infinity]) {
      expect(() => clampDayToMonth(2026, 3, day)).toThrow(/invalid day of month/i);
    }
  });

  it("rejects days outside a calendar month", () => {
    for (const value of ["", "0", "32", "2.5", "not-a-day"]) {
      expect(isMonthDay(value)).toBe(false);
    }
  });
});

describe("resolveYearColumns", () => {
  const cat = (id: string, isColumn = true) => ({ id, isColumn });

  it("falls back to all active columns when the year has no recording", () => {
    const cats = [cat("a"), cat("b"), cat("hidden", false)];
    expect(resolveYearColumns(cats, {}, 2026, 2026, new Set())).toEqual([cat("a"), cat("b")]);
  });

  it("shows exactly the recorded columns for a recorded year, ordered by sortOrder", () => {
    const cats = [cat("a"), cat("b"), cat("c")];
    // Membership is {a, c} (from column_years), but the DISPLAY order follows
    // the category order (sortOrder), so reordering columns reflects in the
    // table — NOT the stored column_years order (which would be ["c","a"]).
    const out = resolveYearColumns(cats, { "2025": ["c", "a"] }, 2025, 2026, new Set());
    expect(out.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("reordering categories (sortOrder) reorders a recorded year's columns", () => {
    // Same membership, categories now in a different order → columns follow it.
    const reordered = [cat("c"), cat("b"), cat("a")];
    const out = resolveYearColumns(reordered, { "2025": ["a", "c"] }, 2025, 2026, new Set());
    expect(out.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("surfaces an unrecorded column that gained data in the year", () => {
    const cats = [cat("a"), cat("b")];
    const out = resolveYearColumns(cats, { "2025": ["a"] }, 2025, 2026, new Set(["b"]));
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("live year shows unclaimed columns but keeps claimed ones confined", () => {
    const cats = [cat("a"), cat("b"), cat("manual")];
    // "b" is claimed by 2025 only → it must NOT bleed into 2026;
    // "manual" is unclaimed → it appears in the live year.
    const out = resolveYearColumns(cats, { "2025": ["b"], "2026": ["a"] }, 2026, 2026, new Set());
    expect(out.map((c) => c.id)).toEqual(["a", "manual"]);
  });

  it("ignores dangling ids and de-duplicates", () => {
    const cats = [cat("a")];
    const out = resolveYearColumns(cats, { "2025": ["ghost", "a", "a"] }, 2025, 2026, new Set());
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("honors the visibility toggle even for recorded columns with data", () => {
    const cats = [cat("visible"), cat("hidden", false)];
    const out = resolveYearColumns(
      cats,
      { "2025": ["visible", "hidden"] },
      2025,
      2026,
      new Set(["hidden"]),
    );
    expect(out.map((category) => category.id)).toEqual(["visible"]);
  });

  it("never admits inactive recorded ids or duplicates active recorded members", () => {
    const categories = [cat("active"), cat("inactive", false), cat("new")];
    expect(resolveYearColumns(categories, { "2026": ["active", "inactive", "active"] }, 2026, 2027, new Set()))
      .toEqual([cat("active")]);
  });

  describe("synced membership records", () => {
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
      // `column_years` is a synced value parsed with an unchecked cast.
      for (const malformed of [5, "abc", null, { nested: true }]) {
        const record = { "2026": malformed } as unknown as Record<string, string[]>;
        expect(resolveYearColumns(categories, record, 2026, 2026, new Set()).map((category) => category.id))
          .toEqual(["a", "b"]);
      }
      const otherYearMalformed = { "2025": 5, "2026": ["a"] } as unknown as Record<string, string[]>;
      expect(resolveYearColumns(categories, otherYearMalformed, 2026, 2030, new Set()).map((category) => category.id))
        .toEqual(["a"]);
    });
  });
});

describe("orderLedgerCategories", () => {
  it("keeps the two settings lists grouped and preserves each list's drag order", () => {
    const categories = [
      { id: "salary", kind: "income" as const, sortOrder: 1 },
      { id: "rent", kind: "expense" as const, sortOrder: 4 },
      { id: "freelance", kind: "income" as const, sortOrder: 0 },
      { id: "market", kind: "expense" as const, sortOrder: 2 },
      { id: "bills", kind: "expense" as const, sortOrder: 3 },
    ];

    expect(orderLedgerCategories(categories).map((category) => category.id)).toEqual([
      "market",
      "bills",
      "rent",
      "freelance",
      "salary",
    ]);
    expect(categories.map((category) => category.id)).toEqual([
      "salary",
      "rent",
      "freelance",
      "market",
      "bills",
    ]);
  });
});

/** The timezone-dependent half lives in locale-timezone.test.ts (mutation-excluded); the deterministic half is here, where it is mutated. */
describe("localDayOfTimestamp", () => {
  it("reads a real timestamp as a calendar day", () => {
    expect(localDayOfTimestamp("2026-08-18T09:00:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("reports an unknown day rather than inventing one", () => {
    expect(localDayOfTimestamp(null)).toBeNull();
    expect(localDayOfTimestamp(undefined)).toBeNull();
    expect(localDayOfTimestamp("")).toBeNull();
    expect(localDayOfTimestamp("not a timestamp")).toBeNull();
    expect(localDayOfTimestamp("2026-13-45T99:00:00.000Z")).toBeNull();
    // A number is a plausible timestamp everywhere except this contract.
    expect(localDayOfTimestamp(1_755_000_000_000)).toBeNull();
    expect(localDayOfTimestamp({ createdAt: "2026-08-18" })).toBeNull();
  });
});

describe("date and month formats", () => {
  it("anchors date and month formats at both ends", () => {
    expect(isMonthKey("0001-01")).toBe(true);
    expect(isMonthKey("0000-01")).toBe(false);
    expect(isMonthKey("x2026-01")).toBe(false);
    expect(isMonthKey("2026-01x")).toBe(false);
    expect(isISODate("0001-01-01")).toBe(true);
    expect(isISODate("0000-01-01")).toBe(false);
    expect(isISODate("x2026-01-01")).toBe(false);
    expect(isISODate("2026-01-01x")).toBe(false);
    expect(makeMonthKey(7, 2)).toBe("0007-02");
    expect(monthRange("2026-02", "2026-01")).toEqual([]);
    expect(monthRange("2026-03", "2026-01")).toEqual([]);
    const monthLike = { toString: () => "2026-01", slice: (start: number, end: number) => "2026-01".slice(start, end) };
    const dateLike = { toString: () => "2026-01-01", slice: (start: number, end: number) => "2026-01-01".slice(start, end) };
    expect(isMonthKey(monthLike)).toBe(false);
    expect(isISODate(dateLike)).toBe(false);
    expect(isMonthKey("2026-012026-01")).toBe(false);
    expect(isISODate("2026-01-012026-01-01")).toBe(false);
  });
});

// The start-month pickers (onboarding, opening-balance) and the bulk-entry
// stepper all guard against choosing a FUTURE month with this helper. The
// current calendar month is the latest allowed value.
describe("isCurrentOrFutureMonth", () => {
  const today = "2026-07-12";
  const thisMonth = monthKeyOf(today); // "2026-07"

  it("is false for any past month (past entry is allowed)", () => {
    expect(isCurrentOrFutureMonth("2026-06", today)).toBe(false);
    expect(isCurrentOrFutureMonth("2025-12", today)).toBe(false);
    expect(isCurrentOrFutureMonth(addMonthsToKey(thisMonth, -1), today)).toBe(false);
  });

  it("is true for the current month (it is the upper bound, so +1 is blocked)", () => {
    expect(isCurrentOrFutureMonth(thisMonth, today)).toBe(true);
  });

  it("is true for any future month", () => {
    expect(isCurrentOrFutureMonth("2026-08", today)).toBe(true);
    expect(isCurrentOrFutureMonth("2027-01", today)).toBe(true);
    expect(isCurrentOrFutureMonth(addMonthsToKey(thisMonth, 1), today)).toBe(true);
  });

  it("handles year boundaries (December current month)", () => {
    const dec = "2026-12-31";
    expect(isCurrentOrFutureMonth("2026-11", dec)).toBe(false);
    expect(isCurrentOrFutureMonth("2026-12", dec)).toBe(true);
    expect(isCurrentOrFutureMonth("2027-01", dec)).toBe(true);
  });
});

// A dynamic route segment (`/cash-flow/[month]`) carries whatever the URL
// says. Two screens derive their SQLite range from that param, and the range
// helpers throw on a malformed month — during render, so the screen white-
// screens before any handler can react. `isMonthKey` is the guard both use.
describe("isMonthKey guards route params against the throwing range helpers", () => {
  it("accepts a well-formed month key", () => {
    for (const key of ["2026-01", "2026-07", "2026-12", "1999-10"]) {
      expect(isMonthKey(key)).toBe(true);
    }
  });

  it("rejects malformed, out-of-range and non-string params", () => {
    for (const bad of ["garbage", "0000-01", "2026-13", "2026-00", "2026-99", "2026-7", "", "../etc", "2026", null, undefined, 202607]) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  // The reason the guard exists: without it these calls reach the helpers.
  it("documents that the unguarded helpers throw on exactly those values", () => {
    for (const bad of ["garbage", "2026-13", "", "../etc"]) {
      expect(() => lastDayOf(bad)).toThrow(/Invalid month/);
    }
    // Direct values prove the guard's accept-set is safe to pass on.
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29"); // leap year
  });
});
