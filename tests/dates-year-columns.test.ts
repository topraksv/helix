import { describe, expect, it } from "vitest";
import { addDaysISO } from "../src/domain/dates";
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

describe("resolveYearColumns", () => {
  const cat = (id: string, isColumn = true) => ({ id, isColumn });

  it("falls back to all active columns when the year has no recording", () => {
    const cats = [cat("a"), cat("b"), cat("hidden", false)];
    expect(resolveYearColumns(cats, {}, 2026, 2026, new Set())).toEqual([cat("a"), cat("b")]);
  });

  it("shows exactly the recorded columns in order for a recorded year", () => {
    const cats = [cat("a"), cat("b"), cat("c")];
    const out = resolveYearColumns(cats, { "2025": ["c", "a"] }, 2025, 2026, new Set());
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
});
