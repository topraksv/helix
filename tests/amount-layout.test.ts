import { describe, expect, it } from "vitest";
import { initialAmountFontSize, nextAmountFontSize, type AmountScale, shouldMeasureAmountFit } from "../src/ui/amount-layout";

describe("exact amount responsive font steps", () => {
  it("shrinks every scale monotonically and stops at a stable minimum", () => {
    const minimum: Record<AmountScale, number> = { regular: 11, large: 15, hero: 15 };
    for (const scale of ["regular", "large", "hero"] satisfies AmountScale[]) {
      const seen = [initialAmountFontSize(scale)];
      for (let i = 0; i < 20; i += 1) seen.push(nextAmountFontSize(scale, seen.at(-1)!));
      expect(seen.every((size, index) => index === 0 || size <= seen[index - 1]!)).toBe(true);
      expect(seen.at(-1)).toBe(minimum[scale]);
      expect(nextAmountFontSize(scale, seen.at(-1)!)).toBe(minimum[scale]);
    }
  });

  it("recovers to the scale's first step when given an unknown stale size", () => {
    expect(nextAmountFontSize("hero", 999)).toBe(initialAmountFontSize("hero"));
  });
});

/**
 * The probe bound decides whether a figure is measured before it is trusted to
 * fit. It was `> 10`, and 10 is the length of "₺90.500,00" — the dashboard's
 * month strip — so at 320px that figure was never measured and overlapped the
 * one beside it by a measured 2px.
 */
describe("when an amount has to be measured", () => {
  it("measures every scale above regular, whatever the length", () => {
    expect(shouldMeasureAmountFit("large", "₺0,00")).toBe(true);
    expect(shouldMeasureAmountFit("hero", "₺0,00")).toBe(true);
  });

  it("measures a ten-character regular amount, which is the one that overlapped", () => {
    expect("₺90.500,00").toHaveLength(10);
    expect(shouldMeasureAmountFit("regular", "₺90.500,00")).toBe(true);
  });

  it("still skips the probe for figures that cannot overflow the narrowest column", () => {
    expect(shouldMeasureAmountFit("regular", "₺0,00")).toBe(false);
    expect(shouldMeasureAmountFit("regular", "₺9.500,00")).toBe(false);
  });
});
