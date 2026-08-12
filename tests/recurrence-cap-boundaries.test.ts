import { describe, expect, it } from "vitest";
import { addDaysISO } from "../src/domain/dates";
import { dayIntervalDatesInRange, nextDueAfter } from "../src/domain/recurrence";

describe("recurrence iteration cap", () => {
  it("stops a monthly next-due walk after exactly 6,000 advances", () => {
    expect(nextDueAfter("2000-01-01", "3000-01-01", 1, 1)).toBe("2500-01-01");
  });

  it("returns exactly 6,000 daily occurrences across a wider valid window", () => {
    const dates = dayIntervalDatesInRange("2000-01-01", 1, "2000-01-01", "2100-01-01");

    expect(dates).toHaveLength(6_000);
    expect(dates[0]).toBe("2000-01-01");
    expect(dates.at(-1)).toBe(addDaysISO("2000-01-01", 5_999));
  });
});
