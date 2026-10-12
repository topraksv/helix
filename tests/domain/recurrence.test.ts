import { describe, expect, it } from "vitest";
import { addDaysISO, daysInMonth, isISODate } from "../../src/domain/dates";
import { advanceDueDate, dayIntervalDatesInRange, dueDatesInRange, nextDueAfter } from "../../src/domain/recurrence";

describe("advanceDueDate — month-end clamping", () => {
  it("clamps Jan 31 → Feb 28 but recovers to Mar 31 (non-sticky)", () => {
    const feb = advanceDueDate("2026-01-31", 1, 31);
    expect(feb).toBe("2026-02-28");
    const mar = advanceDueDate(feb, 1, 31);
    expect(mar).toBe("2026-03-31");
  });

  it("uses Feb 29 in leap years", () => {
    expect(advanceDueDate("2028-01-31", 1, 31)).toBe("2028-02-29");
  });

  it("advances yearly subscriptions by 12 months", () => {
    expect(advanceDueDate("2026-03-15", 12, 15)).toBe("2027-03-15");
  });

  it("supports custom intervals", () => {
    expect(advanceDueDate("2026-01-10", 3, 10)).toBe("2026-04-10");
  });
});

describe("nextDueAfter", () => {
  it("finds the first due date strictly after the anchor", () => {
    expect(nextDueAfter("2026-07-05", "2026-07-05", 1, 5)).toBe("2026-08-05");
    expect(nextDueAfter("2026-07-01", "2026-07-05", 1, 20)).toBe("2026-07-20");
  });
});

describe("dueDatesInRange", () => {
  it("lists monthly dues inside an inclusive window", () => {
    expect(dueDatesInRange("2026-07-10", 1, 10, "2026-07-01", "2026-09-30")).toEqual([
      "2026-07-10",
      "2026-08-10",
      "2026-09-10",
    ]);
  });

  it("returns empty when the anchor is beyond the window", () => {
    expect(dueDatesInRange("2026-10-01", 1, 1, "2026-07-01", "2026-09-30")).toEqual([]);
  });

  // A corrupt interval (backup or sync) must terminate with no dates, never loop.
  it("does not loop forever on a zero/negative/NaN interval (returns empty, finite)", () => {
    expect(dueDatesInRange("2026-07-10", 0, 10, "2026-07-01", "2026-09-30")).toEqual([]);
    expect(dueDatesInRange("2026-07-10", -1, 10, "2026-07-01", "2026-09-30")).toEqual([]);
    expect(dueDatesInRange("2026-07-10", NaN, 10, "2026-07-01", "2026-09-30")).toEqual([]);
    expect(dueDatesInRange("2026-07-10", 1.5, 10, "2026-07-01", "2026-09-30")).toEqual([]);
    expect(dueDatesInRange("2026-07-10", 13, 10, "2026-07-01", "2026-09-30")).toEqual([]);
  });

  it("stays finite even across a very wide window (iteration cap)", () => {
    const dates = dueDatesInRange("1900-01-10", 1, 10, "1900-01-01", "3000-01-01");
    expect(dates).toHaveLength(6_000);
    expect(dates[0]).toBe("1900-01-10");
    expect(dates.at(-1)).toBe("2399-12-10");
  });

  it("keeps leap/year schedules strictly increasing for every month-end sentinel", () => {
    for (const billingDay of [28, 29, 30, 31]) {
      for (const intervalMonths of [1, 2, 3, 12]) {
        const dates = dueDatesInRange(
          `2000-01-${String(billingDay).padStart(2, "0")}`,
          intervalMonths,
          billingDay,
          "2000-01-01",
          "2400-12-31",
        );
        expect(dates.length).toBeGreaterThan(0);
        expect(new Set(dates).size).toBe(dates.length);
        for (let index = 0; index < dates.length; index += 1) {
          const date = dates[index]!;
          expect(isISODate(date)).toBe(true);
          if (index > 0) expect(dates[index - 1]! < date).toBe(true);
          const year = Number(date.slice(0, 4));
          const month = Number(date.slice(5, 7));
          const day = Number(date.slice(8, 10));
          expect(day).toBe(Math.min(billingDay, daysInMonth(year, month)));
        }
      }
    }
  });
});

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

describe("weekly recurring income", () => {
  it("walks calendar dates by 7/14 days across month boundaries", () => {
    expect(dayIntervalDatesInRange("2026-01-28", 7, "2026-02-01", "2026-02-28")).toEqual([
      "2026-02-04", "2026-02-11", "2026-02-18", "2026-02-25",
    ]);
    expect(dayIntervalDatesInRange("2026-02-20", 14, "2026-02-20", "2026-03-31")).toEqual([
      "2026-02-20", "2026-03-06", "2026-03-20",
    ]);
  });
});

describe("recurrence boundaries", () => {
  it("keeps next-due comparisons strict on both the source and target dates", () => {
    expect(nextDueAfter("2026-07-20", "2026-07-19", 1, 20)).toBe("2026-07-20");
    expect(nextDueAfter("2026-07-20", "2026-07-20", 1, 20)).toBe("2026-08-20");
    expect(nextDueAfter("2026-07-25", "2026-07-25", 1, 20)).toBe("2026-08-20");
  });

  it("includes exact monthly range endpoints", () => {
    expect(dueDatesInRange("2026-07-18", 1, 18, "2026-07-18", "2026-09-18"))
      .toEqual(["2026-07-18", "2026-08-18", "2026-09-18"]);
    expect(dueDatesInRange("2026-07-17", 1, 17, "2026-07-18", "2026-09-18"))
      .toEqual(["2026-08-17", "2026-09-17"]);
  });

  it("aligns day intervals mathematically and includes both endpoints", () => {
    expect(dayIntervalDatesInRange("2026-07-01", 7, "2026-07-08", "2026-07-22"))
      .toEqual(["2026-07-08", "2026-07-15", "2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-01", 7, "2026-07-09", "2026-07-22"))
      .toEqual(["2026-07-15", "2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-01", 3, "2026-07-06", "2026-07-10"))
      .toEqual(["2026-07-07", "2026-07-10"]);
    expect(dayIntervalDatesInRange("2026-07-22", 7, "2026-07-01", "2026-07-22")).toEqual(["2026-07-22"]);
    expect(dayIntervalDatesInRange("2026-07-23", 7, "2026-07-01", "2026-07-22")).toEqual([]);
    for (const interval of [0, -1, 1.5, Number.NaN]) {
      expect(dayIntervalDatesInRange("2026-07-01", interval, "2026-07-01", "2026-07-22"), String(interval)).toEqual([]);
    }
    expect(dayIntervalDatesInRange("2000-01-01", 1, "2200-01-01", "2200-01-01"))
      .toEqual(["2200-01-01"]);
    expect(dayIntervalDatesInRange("2000-01-01", 2, "2200-01-01", "2200-01-02"))
      .toEqual(["2200-01-02"]);
  });
});

describe("dueDatesInRange — corrupt billing day", () => {
  it("produces no due dates for an out-of-range billing day", () => {
    expect(dueDatesInRange("2026-07-15", 1, 15, "2026-07-01", "2026-10-01").length).toBeGreaterThan(0);
    for (const day of [0, -1, 45, NaN]) {
      expect(dueDatesInRange("2026-07-15", 1, day, "2026-07-01", "2026-10-01")).toEqual([]);
    }
  });
});

describe("nextDueAfter — malformed interval", () => {
  it("falls back to a single-month step instead of looping on interval <= 0", () => {
    // With a broken interval it must still return a finite date strictly after.
    expect(nextDueAfter("2026-07-05", "2026-07-05", 0, 5)).toBe("2026-08-05");
    expect(nextDueAfter("2026-07-05", "2026-07-05", NaN, 5)).toBe("2026-08-05");
  });
});
