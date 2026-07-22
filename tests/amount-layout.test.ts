import { describe, expect, it } from "vitest";
import { initialAmountFontSize, nextAmountFontSize, type AmountScale } from "../src/ui/amount-layout";

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
