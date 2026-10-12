/**
 * The calculator (`docs/SPEC.md` 11.5) as a pure state machine: chained
 * four operations, Turkish decimal comma, no eval.
 */

import { describe, expect, it } from "vitest";

import { CALC_START, feedbackOf, keyFrom, press, previewOf, resultOf, shownOf, type CalcKey } from "../../src/domain/calculator";

const typed = (keys: string) => [...keys].reduce((state, key) => press(state, key as CalcKey), CALC_START);

describe("press", () => {
  it("chains operations left to right, and = gives the result", () => {
    expect(resultOf(typed("12+30="))).toBe(42);
    expect(resultOf(typed("2+3×4="))).toBe(20);
    expect(resultOf(typed("45,9×3="))).toBeCloseTo(137.7);
    expect(resultOf(typed("100÷8="))).toBe(12.5);
    expect(resultOf(typed("5-8="))).toBe(-3);
  });

  it("repeats nothing on a second =, and an operator after = goes on from the result", () => {
    expect(resultOf(typed("2+3=="))).toBe(5);
    expect(resultOf(typed("2+3=×2="))).toBe(10);
  });

  it("starts a new number after =, rather than typing onto the result", () => {
    expect(resultOf(typed("2+3=7"))).toBe(7);
  });

  it("changes its mind about an operator pressed twice", () => {
    expect(resultOf(typed("6+×2="))).toBe(12);
  });

  it("keeps one comma, and a leading comma is zero point", () => {
    expect(shownOf(typed(",5"))).toBe("0,5");
    expect(shownOf(typed("1,2,3"))).toBe("1,23");
  });

  it("erases the last digit, back to zero, and C starts over", () => {
    expect(shownOf(typed("123⌫"))).toBe("12");
    expect(shownOf(typed("1⌫⌫"))).toBe("0");
    expect(typed("12+3C")).toEqual(CALC_START);
  });

  it("refuses to divide by zero, and the next key starts fresh", () => {
    const failed = typed("5÷0=");
    expect(failed.error).toBe(true);
    expect(Number.isNaN(resultOf(failed))).toBe(true);
    expect(resultOf(press(failed, "7"))).toBe(7);
    expect(typed("5÷0+").error).toBe(true);
  });

  it("divides zero by zero as an error, but adds and multiplies zero as any number", () => {
    expect(typed("0÷0=").error).toBe(true);
    expect(resultOf(typed("5+0="))).toBe(5);
    expect(resultOf(typed("5-0="))).toBe(5);
    expect(resultOf(typed("5×0="))).toBe(0);
  });

  it("takes a result up to the largest amount an amount field holds and refuses the one past it", () => {
    expect(resultOf(typed("999999999999+0,99="))).toBe(999_999_999_999.99);
    expect(typed("999999999999+1=").error).toBe(true);
    expect(typed("999999999999+1+").error).toBe(true);
  });

  it("erases nothing while an operator waits or a result stands, and a number erased to nothing is zero", () => {
    expect(resultOf(typed("12+⌫="))).toBe(24);
    expect(shownOf(typed("12+⌫"))).toBe("12");
    expect(shownOf(typed("2+3=⌫"))).toBe("5");
    expect(resultOf(typed("5+3⌫="))).toBe(5);
    expect(typed("5+3⌫").current).toBe("0");
  });

  it("starts the number at zero point when the comma follows an operator or a result", () => {
    expect(shownOf(typed("5+,"))).toBe("0,");
    expect(shownOf(typed("2+3=,"))).toBe("0,");
    expect(shownOf(typed("2+3=,5"))).toBe("0,5");
  });

  it("caps a number at twelve whole digits and six decimals, and a result too large is an error", () => {
    expect(shownOf(typed("1234567890123"))).toBe("123.456.789.012");
    expect(shownOf(typed("1,1234567"))).toBe("1,123456");
    expect(typed("999999999999×999999999999=").error).toBe(true);
  });
});

describe("what it shows", () => {
  it("groups the whole part and keeps the decimals as typed", () => {
    expect(shownOf(typed("1234,50"))).toBe("1.234,50");
    expect(shownOf(typed("12,"))).toBe("12,");
    expect(shownOf(typed("12+"))).toBe("12");
    expect(shownOf(typed("1234+"))).toBe("1.234");
    expect(shownOf(typed("0,123456+"))).toBe("0,123456");
    expect(shownOf(typed("0,1+0,2="))).toBe("0,3");
    expect(shownOf(typed("1,0"))).toBe("1,0");
  });

  it("previews the pending operation before =", () => {
    expect(previewOf(typed("3×5"))).toBe(15);
    expect(previewOf(typed("3×"))).toBeNull();
    expect(previewOf(typed("3"))).toBeNull();
    expect(previewOf(typed("3÷0"))).toBeNull();
  });
});

describe("resultOf", () => {
  it("takes the previewed result, not the operand, while an operation waits", () => {
    const pending = typed("45,9×3");
    expect(previewOf(pending)).toBeCloseTo(137.7);
  });

  it("is what = would give while an operation waits, so the result used is the one previewed", () => {
    expect(resultOf(typed("45,9×3"))).toBeCloseTo(137.7);
    expect(resultOf(typed("45,9×"))).toBe(45.9);
    expect(resultOf(typed("12"))).toBe(12);
    expect(Number.isNaN(resultOf(typed("5÷0")))).toBe(true);
    expect(Number.isNaN(resultOf(typed("5÷0=")))).toBe(true);
  });
});

describe("feedbackOf", () => {
  it("stays quiet on digits, taps on operators and C, and marks = and an error", () => {
    expect(feedbackOf(CALC_START, "7")).toBe("none");
    expect(feedbackOf(typed("7"), "+")).toBe("selection");
    expect(feedbackOf(typed("7"), "C")).toBe("selection");
    expect(feedbackOf(typed("7+2"), "=")).toBe("success");
    expect(feedbackOf(typed("7"), "=")).toBe("none");
    expect(feedbackOf(typed("7÷0"), "=")).toBe("error");
    expect(feedbackOf(typed("7÷0"), "+")).toBe("error");
    expect(feedbackOf(typed("7+2"), "+")).toBe("selection");
    expect(feedbackOf(typed("7+2"), "3")).toBe("none");
    expect(feedbackOf(typed("7+"), "=")).toBe("success");
    expect(feedbackOf(typed("0÷"), "+")).toBe("selection");
    expect(feedbackOf(typed("999999999999+1"), "=")).toBe("error");
  });
});

describe("keyFrom", () => {
  it("reads a physical keyboard's keys as the pad's", () => {
    expect(["7", ".", ",", "*", "x", "/", "Enter", "=", "Backspace", "Delete", "c", "q"].map(keyFrom)).toEqual([
      "7", ",", ",", "×", "×", "÷", "=", "=", "⌫", "C", "C", null,
    ]);
    expect(["+", "-", "X", "C", "12", "7a", "a7"].map(keyFrom)).toEqual(["+", "-", "×", "C", null, null, null]);
  });
});
