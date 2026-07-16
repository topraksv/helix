import { describe, expect, it } from "vitest";
import { INPUT_LIMITS, assertInputWithinLimit, isInputWithinLimit } from "../src/domain/input";

describe("shared input limits", () => {
  it.each(Object.entries(INPUT_LIMITS))("enforces the %s field boundary", (kind, limit) => {
    expect(isInputWithinLimit("x".repeat(limit), kind as keyof typeof INPUT_LIMITS)).toBe(true);
    expect(isInputWithinLimit("x".repeat(limit + 1), kind as keyof typeof INPUT_LIMITS)).toBe(false);
    expect(() => assertInputWithinLimit("x".repeat(limit + 1), kind as keyof typeof INPUT_LIMITS)).toThrow();
  });

  it("accepts optional empty values without weakening non-empty limits", () => {
    expect(isInputWithinLimit(null, "note")).toBe(true);
    expect(isInputWithinLimit(undefined, "text")).toBe(true);
  });
});
