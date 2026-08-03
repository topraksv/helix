import { describe, expect, it } from "vitest";
import { resolveBarAxis } from "../src/ui/chart-axis";

describe("column chart axis", () => {
  it("returns no axis for an empty or non-finite series", () => {
    expect(resolveBarAxis([])).toBeNull();
    expect(resolveBarAxis([null, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it("does not invent a positive range for all-negative data", () => {
    const axis = resolveBarAxis([-100_000, -75_000]);
    expect(axis).not.toBeNull();
    expect(axis!.max).toBe(0);
    expect(axis!.min).toBeLessThan(-100_000);
    expect(axis!.ticks).toContain(0);
  });

  it("keeps zero and a small readable pad for positive data", () => {
    const axis = resolveBarAxis([100]);
    expect(axis).not.toBeNull();
    expect(axis!.min).toBe(0);
    expect(axis!.max).toBeGreaterThan(100);
    expect(axis!.ticks).toContain(0);
    expect(axis!.ticks.every((tick, index, ticks) => index === 0 || tick < ticks[index - 1]!)).toBe(true);
  });

  it("keeps mixed signed values truthful and finite", () => {
    const axis = resolveBarAxis([-1_000, 0, 2_500, null]);
    expect(axis).not.toBeNull();
    expect(axis!.min).toBeLessThanOrEqual(-1_000);
    expect(axis!.max).toBeGreaterThanOrEqual(2_500);
    expect(axis!.ticks).toContain(0);
    expect(axis!.ticks.every(Number.isFinite)).toBe(true);
  });

  it("does not let a zero-heavy set push the visible values into an extreme range", () => {
    const axis = resolveBarAxis([0, 0, 5, 6, 7]);
    expect(axis).not.toBeNull();
    expect(axis!.max / 7).toBeLessThanOrEqual(3);
  });

  it("gives an all-zero series a truthful symmetric ruler", () => {
    expect(resolveBarAxis([0, 0])).toEqual({ min: -1, max: 1, step: 1, ticks: [1, 0, -1], valueTicks: [] });
  });

  /**
   * The complaint this exists for: an income of 120.000 sat between a 100.000
   * and a 150.000 gridline, so the only number written beside it said 100.
   */
  it("labels the real extremes, not just the rounded ruler", () => {
    const axis = resolveBarAxis([12_000_000, 4_500_000])!;
    expect(axis.valueTicks).toContain(12_000_000);
    expect(axis.ticks).toContain(0);
    // The ruler still exists — the real figure is added to it, not swapped in.
    expect(axis.ticks.length).toBeGreaterThan(1);
    expect(axis.max).toBeGreaterThanOrEqual(12_000_000);
  });

  it("labels both ends when the data crosses zero", () => {
    const axis = resolveBarAxis([-8_000, 3_000])!;
    expect(axis.valueTicks).toEqual([3_000, -8_000]);
  });

  it("drops only the reference line that would print on top of a real one", () => {
    const axis = resolveBarAxis([100_000])!;
    for (const value of axis.valueTicks) {
      for (const tick of axis.ticks) {
        if (tick === 0) continue;
        expect(Math.abs(tick - value)).toBeGreaterThan(axis.step * 0.34);
      }
    }
  });

  it("keeps equal and outlier values inside a rounded domain", () => {
    for (const values of [[250, 250], [1, 1, 1], [1, 1, 10_000]]) {
      const axis = resolveBarAxis(values);
      expect(axis).not.toBeNull();
      expect(axis!.min).toBeLessThanOrEqual(0);
      expect(axis!.max).toBeGreaterThanOrEqual(Math.max(...values));
      expect(axis!.ticks).toContain(0);
    }
  });
});
