import { describe, expect, it } from "vitest";
import { advanceDueDate, dueDatesInRange, nextDueAfter } from "../src/domain/recurrence";

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
});
