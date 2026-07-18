import { afterEach, describe, expect, it } from "vitest";
import { addDaysISO, todayISO } from "../src/domain/dates";
import { formatMinor, parseTRAmountToMinor } from "../src/domain/money";
import { dayIntervalDatesInRange } from "../src/domain/recurrence";

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone == null) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("Turkish locale and calendar boundaries", () => {
  it("round-trips grouped TRY values with comma decimals", () => {
    const formatted = formatMinor(123_456_789);
    expect(formatted).toBe("₺1.234.567,89");
    expect(parseTRAmountToMinor(formatted)).toBe(123_456_789);
    expect(parseTRAmountToMinor("1,234,56")).toBeNull();
  });

  it("derives the user's calendar day instead of slicing UTC", () => {
    const instant = new Date("2026-03-28T22:30:00.000Z");
    process.env.TZ = "UTC";
    expect(todayISO(instant)).toBe("2026-03-28");
    process.env.TZ = "Europe/Istanbul";
    expect(todayISO(instant)).toBe("2026-03-29");
  });

  it("keeps calendar-day arithmetic stable at leap and DST boundaries", () => {
    expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysISO("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysISO("2026-10-24", 1)).toBe("2026-10-25");
  });

  it("generates weekly and biweekly income dates across month boundaries", () => {
    expect(dayIntervalDatesInRange("2026-01-28", 7, "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-04",
      "2026-02-11",
      "2026-02-18",
      "2026-02-25",
    ]);
    expect(dayIntervalDatesInRange("2026-02-20", 14, "2026-02-01", "2026-03-31")).toEqual([
      "2026-02-20",
      "2026-03-06",
      "2026-03-20",
    ]);
  });
});
