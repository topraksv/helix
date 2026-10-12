import { afterEach, describe, expect, it } from "vitest";
import { addDaysISO, localDayOfTimestamp, todayISO } from "../../src/domain/dates";
import { formatMinor, readTRAmount } from "../../src/domain/money";
import { dayIntervalDatesInRange } from "../../src/domain/recurrence";

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone == null) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

function parseTR(input: string): number | null {
  const read = readTRAmount(input);
  return read.ok ? read.minor : null;
}

describe("Turkish locale and calendar boundaries", () => {
  it("round-trips grouped TRY values with comma decimals", () => {
    const formatted = formatMinor(123_456_789);
    expect(formatted).toBe("₺1.234.567,89");
    expect(parseTR(formatted)).toBe(123_456_789);
    expect(parseTR("1,234,56")).toBeNull();
  });

  it("derives the user's calendar day instead of slicing UTC", () => {
    const instant = new Date("2026-03-28T22:30:00.000Z");
    process.env.TZ = "UTC";
    expect(todayISO(instant)).toBe("2026-03-28");
    process.env.TZ = "Europe/Istanbul";
    expect(todayISO(instant)).toBe("2026-03-29");
  });

  /**
   * `created_at` is UTC; every date compared against it is local. The
   * subscription auto-pay guard turns on this conversion — reading the UTC day
   * would let an auto-pay rule created after local midnight confirm its own
   * creation-day charge and drop the balance on the spot.
   */
  it("reads a stored UTC timestamp as the user's local calendar day", () => {
    process.env.TZ = "Europe/Istanbul";
    expect(localDayOfTimestamp("2026-08-18T22:30:00.000Z")).toBe("2026-08-19");
    process.env.TZ = "UTC";
    expect(localDayOfTimestamp("2026-08-18T22:30:00.000Z")).toBe("2026-08-18");
    process.env.TZ = "America/New_York";
    expect(localDayOfTimestamp("2026-08-19T01:30:00.000Z")).toBe("2026-08-18");
  });

  it("keeps calendar-day arithmetic stable at leap and DST boundaries", () => {
    expect(addDaysISO("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysISO("2026-10-24", 1)).toBe("2026-10-25");
  });

  it("keeps interval schedules identical across host timezones", () => {
    const expected = ["2026-03-29", "2026-04-05", "2026-04-12", "2026-04-19"];
    for (const timezone of ["UTC", "Europe/Istanbul", "America/New_York", "Pacific/Auckland"]) {
      process.env.TZ = timezone;
      expect(dayIntervalDatesInRange("2026-03-01", 7, "2026-03-29", "2026-04-19")).toEqual(expected);
    }
  });
});
