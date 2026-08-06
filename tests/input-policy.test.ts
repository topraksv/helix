import { describe, expect, it } from "vitest";
import { INPUT_LIMITS, MIN_NEW_PASSWORD_LENGTH, assertInputWithinLimit, isInputWithinLimit, isValidNewPassword, textLength, utf8ByteLength } from "../src/domain/input";

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

  it("counts UTF-8 bytes without confusing code units and code points", () => {
    expect(utf8ByteLength("Ağrı 🧭")).toBe(new TextEncoder().encode("Ağrı 🧭").byteLength);
  });

  it("uses the same Unicode code-point length as PostgreSQL", () => {
    expect(textLength("🧭".repeat(INPUT_LIMITS.text))).toBe(INPUT_LIMITS.text);
    expect(isInputWithinLimit("🧭".repeat(INPUT_LIMITS.text), "text")).toBe(true);
    expect(isInputWithinLimit("🧭".repeat(INPUT_LIMITS.text + 1), "text")).toBe(false);
  });

  it("requires at least eight characters for every newly chosen password", () => {
    expect(MIN_NEW_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    expect(isValidNewPassword("1234567")).toBe(false);
    expect(isValidNewPassword("12345678")).toBe(true);
    expect(isValidNewPassword("x".repeat(INPUT_LIMITS.password + 1))).toBe(false);
  });
});
