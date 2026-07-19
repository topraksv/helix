import { describe, expect, it } from "vitest";
import { addMonthsToKey, isCurrentOrFutureMonth, isMonthKey, lastDayOf, monthKeyOf } from "../src/domain/dates";

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
    for (const bad of ["garbage", "2026-13", "2026-00", "2026-99", "2026-7", "", "../etc", "2026", null, undefined, 202607]) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  // The reason the guard exists: without it these calls reach the helpers.
  it("documents that the unguarded helpers throw on exactly those values", () => {
    for (const bad of ["garbage", "2026-13", "", "../etc"]) {
      expect(() => lastDayOf(bad)).toThrow(/Invalid month/);
    }
    // A valid key never throws, so the guard's accept-set is safe to pass on.
    expect(() => lastDayOf("2026-02")).not.toThrow();
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29"); // leap year
  });
});
