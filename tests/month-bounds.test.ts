import { describe, expect, it } from "vitest";
import { addMonthsToKey, isCurrentOrFutureMonth, monthKeyOf } from "../src/domain/dates";

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
