import { describe, expect, it } from "vitest";
import { addDaysISO, assertISODate, clampDayToMonth, dateForMonthEntry, isISODate, isMonthDay } from "../src/domain/dates";
import { resolveYearColumns } from "../src/domain/year-columns";

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
    for (const value of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-1-01", null]) {
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
});
