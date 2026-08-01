import { describe, expect, it } from "vitest";
import { examplePlaceholder, numericPlaceholderColor } from "../src/ui/input-placeholder";

describe("input placeholder presentation", () => {
  it("adds the example prefix exactly once", () => {
    expect(examplePlaceholder("1.250,50")).toBe("Ör. 1.250,50");
    expect(examplePlaceholder("Ör. Market alışverişi")).toBe("Ör. Market alışverişi");
  });

  it("preserves empty placeholders", () => {
    expect(examplePlaceholder("")).toBe("");
    expect(examplePlaceholder(undefined)).toBeUndefined();
  });

  it("makes numeric guidance visually distinct from entered values", () => {
    expect(numericPlaceholderColor("#62564C")).toBe("#62564C66");
  });
});
