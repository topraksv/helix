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
    expect(resolveBarAxis([0, 0])).toEqual({ min: -1, max: 1, step: 1, ticks: [1, 0, -1] });
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
