import { describe, expect, it } from "vitest";
import {
  COMPACT_MONEY_THRESHOLD_MINOR,
  MAX_ABS_AMOUNT_MINOR,
  formatMinor,
  formatMinorCompact,
  compactMoneyScale,
  formatMinorCompactAtScale,
  formatMinorInput,
  formatMoneyInputLive,
  formatTRInputLive,
  majorToMinor,
  parseAmountExpression,
  readAmountExpression,
  readTRAmount,
  splitIntoInstallments,
  usesCompactMoneyScale,
} from "../../src/domain/money";
import { converterRate, convertToTryMinor, crossConvertMinor, pickRate } from "../../src/domain/fx";
import {
  evaluateComputedColumn,
  MAX_COMPUTED_CATEGORY_IDS,
  parseDefinition,
  type MonthAggregates,
} from "../../src/domain/computed-columns";

function parseTR(input: string): number | null {
  const read = readTRAmount(input);
  return read.ok ? read.minor : null;
}

describe("TR money formatting/parsing", () => {
  it("formats minor units in Turkish locale", () => {
    expect(formatMinor(1882292)).toBe("₺18.822,92");
    expect(formatMinor(-1877303)).toBe("-₺18.773,03");
  });

  // Screens negate a sum for display (`-expenseMinor`), so an empty month
  // handed the formatter `-0` and it printed a minus sign in front of nothing.
  it("never signs a zero", () => {
    expect(formatMinor(-0)).toBe("₺0,00");
    expect(formatMinor(0)).toBe("₺0,00");
    expect(formatMinor(-0)).toBe(formatMinor(0));
    expect(formatMinorCompact(-0)).toBe(formatMinorCompact(0));
  });

  it("parses Turkish-formatted input", () => {
    expect(parseTR("18.822,92")).toBe(1882292);
    expect(parseTR("1234,5")).toBe(123450);
  });

  it("parses spreadsheet-style sum expressions", () => {
    expect(parseAmountExpression("300+400+500")).toBe(120000);
    expect(parseAmountExpression("+300+400,50")).toBe(70050);
    expect(parseAmountExpression("1.250,50-250,50")).toBe(100000);
    expect(parseAmountExpression("750")).toBe(75000);
    expect(parseAmountExpression("300++400")).toBeNull();
    expect(parseAmountExpression("abc+3")).toBeNull();
    expect(parseAmountExpression("")).toBeNull();
    expect(parseTR("1234")).toBe(123400);
    expect(parseTR("-2.024,99")).toBe(-202499);
    expect(parseTR("₺ 500")).toBe(50000);
  });

  /** An unreadable amount and an over-limit amount must never report the same reason. */
  describe("says WHY an amount was refused", () => {
    it("calls unfinished and unreadable input malformed, never over the limit", () => {
      for (const input of ["0,", ",", "1+", "1-", "abc", "12.34", "1,234.56", "12,345", "300++400", "abc+3", "1,2,"]) {
        expect(readAmountExpression(input), input).toEqual({ ok: false, reason: "malformed" });
      }
    });

    it("calls an amount past the ceiling over-limit, never malformed", () => {
      for (const input of ["1000000000000", "99999999999999999999", "600000000000+600000000000", "999999999999,99+0,01"]) {
        expect(readAmountExpression(input), input).toEqual({ ok: false, reason: "over-limit" });
      }
    });

    it("separates nothing typed yet from something typed wrong", () => {
      expect(readAmountExpression("")).toEqual({ ok: false, reason: "empty" });
      expect(readAmountExpression("  ₺ ")).toEqual({ ok: false, reason: "empty" });
      expect(readTRAmount("")).toEqual({ ok: false, reason: "empty" });
      expect(readTRAmount("₺")).toEqual({ ok: false, reason: "empty" });
    });

    it("lets a single bad term answer for the whole expression", () => {
      // One term unreadable and one term too large are different reports even
      // though the sum is refused either way.
      expect(readAmountExpression("1+abc")).toEqual({ ok: false, reason: "malformed" });
      expect(readAmountExpression("1+99999999999999999999")).toEqual({ ok: false, reason: "over-limit" });
    });

    it("carries the value itself when there is nothing to refuse", () => {
      expect(readAmountExpression("300+400")).toEqual({ ok: true, minor: 70000 });
      expect(readTRAmount("-2.024,99")).toEqual({ ok: true, minor: -202499 });
      expect(readTRAmount("999999999999,99")).toEqual({ ok: true, minor: MAX_ABS_AMOUNT_MINOR });
    });

    it("keeps the thin parsers answering exactly what the reader does", () => {
      // The two must not drift: a null here and an ok there would put the
      // field back to guessing.
      for (const input of ["", "0,", "1+", "300+400", "1000000000000", "750", "abc"]) {
        const read = readAmountExpression(input);
        expect(parseAmountExpression(input), input).toBe(read.ok ? read.minor : null);
      }
    });
  });

  it("rejects malformed input instead of guessing", () => {
    expect(parseTR("")).toBeNull();
    expect(parseTR("12.34")).toBeNull(); // dot is a thousands separator in TR
    expect(parseTR("1,234.56")).toBeNull();
    expect(parseTR("abc")).toBeNull();
    expect(parseTR("12,345")).toBeNull(); // 3 decimal digits
  });

  it("rejects amounts beyond the product limit before they can break layouts", () => {
    expect(parseTR("99999999999999999999")).toBeNull();
    expect(parseAmountExpression("99999999999999999999+1")).toBeNull();
    // Just past the ~1 trillion ceiling → refused.
    expect(parseTR("1000000000000")).toBeNull();
    expect(parseAmountExpression("600000000000+600000000000")).toBeNull();
    // Exactly the ceiling parses to MAX; a billion is now comfortably inside it.
    expect(parseTR("999999999999,99")).toBe(MAX_ABS_AMOUNT_MINOR);
    expect(parseTR("1000000000")).toBe(100_000_000_000); // 1 milyar TL kabul edilir
    expect(majorToMinor(999_999_999_999.99)).toBe(MAX_ABS_AMOUNT_MINOR);
    expect(majorToMinor(1_000_000_000_000)).toBeNull();
    expect(majorToMinor(Number.NaN)).toBeNull();
  });

  it("keeps an over-limit typed value visible but refuses to parse it", () => {
    const formatted = formatTRInputLive("1234567890123");
    expect(formatted).toBe("1.234.567.890.123");
    expect(parseTR(formatted)).toBeNull();
  });

  it("abbreviates only very large values for fixed-width table cells", () => {
    expect(usesCompactMoneyScale(COMPACT_MONEY_THRESHOLD_MINOR - 1)).toBe(false);
    expect(usesCompactMoneyScale(COMPACT_MONEY_THRESHOLD_MINOR)).toBe(true);
    expect(formatMinorCompact(1882292)).toBe("₺18.822,92"); // everyday amount stays full
    expect(formatMinorCompact(-1877303)).toBe("-\u2060₺18.773,03");
    // 999.999,99 TL — just below the 1.000.000 TL threshold, still written in full
    // (fits a narrow matrix cell, so no truncation/wrap is ever needed).
    expect(formatMinorCompact(99_999_999)).toBe(formatMinor(99_999_999));
    // 1.000.000 TL and up use deterministic Turkish scale labels on Hermes and web.
    expect(formatMinorCompact(100_000_000)).toBe("₺1 Mn");
    expect(formatMinorCompact(150_000_000)).toBe("₺1.5 Mn");
    expect(formatMinorCompact(230_000_000_000)).toBe("₺2.3 Mr");
    expect(formatMinorCompact(-230_000_000_000)).toBe("-\u2060₺2.3 Mr");
    expect(formatMinorCompact(-99_999_995_999_900)).toBe("-\u2060₺1 Tr");
  });

  it("formats a selected compact scale consistently for chart rulers", () => {
    expect(formatMinorCompactAtScale(134_500_000, "Mn")).toBe("₺1.345 Mn");
    expect(formatMinorCompactAtScale(345_600_000_000, "Mr")).toBe("₺3.456 Mr");
    expect(formatMinorCompactAtScale(1_250_000_000_000_00, "Tr")).toBe("₺1.25 Tr");
    expect(formatMinorCompactAtScale(-230_000_000_000, "Mr")).toBe("-\u2060₺2.3 Mr");
    expect(formatMinorCompactAtScale(0, "Mn")).toBe("₺0 Mn");
  });

  it("live-formats input with TR thousands separators, kuruş optional", () => {
    expect(formatTRInputLive("15000")).toBe("15.000");
    expect(formatTRInputLive("1234567")).toBe("1.234.567");
    expect(formatTRInputLive("1234,5")).toBe("1.234,5");
    expect(formatTRInputLive("1234,567")).toBe("1.234,56"); // max 2 kuruş
    expect(formatTRInputLive("300")).toBe("300");
    expect(formatTRInputLive("")).toBe("");
    expect(formatTRInputLive("-2024,99")).toBe("-2.024,99");
    expect(formatTRInputLive("007")).toBe("7"); // drop leading zeros
    expect(formatTRInputLive("0,5")).toBe("0,5"); // keep a lone zero
    expect(formatTRInputLive("45.")).toBe("45,"); // a dot-only keypad's decimal key
    expect(formatTRInputLive("45,9.")).toBe("45,9");
    expect(formatTRInputLive("1.234")).toBe("1.234");
    expect(formatTRInputLive(",5")).toBe("0,5");
    expect(formatTRInputLive("₺ 1.250,50")).toBe("1.250,50"); // idempotent on formatted
    // A sign after the currency symbol is still a sign; the live formatter and the parser must agree.
    expect(formatTRInputLive("₺-5")).toBe("-5");
    expect(formatTRInputLive("₺ -1.250,50")).toBe("-1.250,50");
    expect(formatTRInputLive("-₺5")).toBe("-5");
    expect(parseAmountExpression(formatMoneyInputLive("₺-5"))).toBe(-500);
    expect(parseAmountExpression(formatMoneyInputLive("₺-5"))).toBe(parseTR("₺-5"));
    // An operator is not a leading sign, and the expression path still owns it.
    expect(formatMoneyInputLive("5-3")).toBe("5-3");
    // A second comma is what a person produces by correcting a typo without
    // clearing the field first, and the kuruş are read from everything AFTER
    // the first comma — so the digits either side of a stray one must still
    // land in the right half. Nothing else in the suite types two.
    expect(formatTRInputLive("1,2,3")).toBe("1,23");
    expect(formatTRInputLive("1.234,5,6")).toBe("1.234,56");
    expect(formatTRInputLive(",,")).toBe("0,");
  });

  it("loads saved values into the one exact editable input format", () => {
    expect(formatMinorInput(123_456_789)).toBe("1.234.567,89");
    expect(formatMinorInput(-230_000_000_000)).toBe("-2.300.000.000,00");
  });

  it("live-format output is always parseable back to minor units", () => {
    for (const raw of ["15000", "1234,5", "1.250,50", "9999999", "42,9"]) {
      const formatted = formatTRInputLive(raw);
      expect(parseTR(formatted)).not.toBeNull();
    }
  });

  it("expression-aware live format groups each term and keeps operators", () => {
    expect(formatMoneyInputLive("400+500")).toBe("400+500");
    expect(formatMoneyInputLive("1250+500")).toBe("1.250+500");
    expect(formatMoneyInputLive("15000")).toBe("15.000"); // single amount still grouped
    expect(formatMoneyInputLive("1000+250+90")).toBe("1.000+250+90");
    expect(formatMoneyInputLive("-400")).toBe("-400"); // leading minus is not an operator
    expect(formatMoneyInputLive("1.250,50-250,50")).toBe("1.250,50-250,50");
    // and the grouped expression still evaluates
    expect(parseAmountExpression(formatMoneyInputLive("400+500"))).toBe(90000);
    expect(parseAmountExpression(formatMoneyInputLive("1250+500"))).toBe(175000);
  });
});

/** The exact boundary values, the empty branch halves and the inserted characters. */
describe("money edges", () => {
  it("refuses a value that is not a finite number rather than storing NaN", () => {
    // `>= <=` comparisons against NaN are all false, so an unguarded path
    // returns a minor amount of NaN and stores it.
    expect(majorToMinor(Number.NaN)).toBeNull();
    expect(majorToMinor(Number.POSITIVE_INFINITY)).toBeNull();
    expect(majorToMinor(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("switches compact scale at each threshold, in both directions", () => {
    // 1.000.000,00 is the figure a person is most likely to type, and the two
    // sides of it are different units.
    expect(compactMoneyScale(1_000_000 * 100)).toBe("Mn");
    expect(compactMoneyScale(1_000_000 * 100 - 1)).toBe("Mn");
    expect(compactMoneyScale(1_000_000_000 * 100)).toBe("Mr");
    expect(compactMoneyScale(1_000_000_000_000 * 100)).toBe("Tr");
    // Negative amounts scale by magnitude; an expense is not a smaller number.
    expect(compactMoneyScale(-1_000_000_000 * 100)).toBe("Mr");
    // Mid-range, where nothing is promoted: the plain answer for each unit.
    expect(compactMoneyScale(150_000_000)).toBe("Mn");
    expect(compactMoneyScale(150_000_000_000)).toBe("Mr");
    // Each entry point refuses a figure that is not a whole kuruş, rather than formatting it.
    for (const call of [
      () => compactMoneyScale(1.5),
      () => usesCompactMoneyScale(1.5),
      () => formatMinorCompactAtScale(1.5, "Mn"),
      () => formatMinorInput(1.5),
    ]) expect(call).toThrow();
    expect(compactMoneyScale(150_000_000_000_000)).toBe("Tr");
  });

  it("promotes a value that would round up into the next scale", () => {
    // 999.999.999,99 renders as "1.000 Mn" at three decimals, which reads as a
    // milyar written in the wrong unit. Promotion is also why the function
    // needs no separate trilyon guard: anything at or above a trilyon divides
    // into a milyar figure that rounds past the same threshold, so the extra
    // branch could only ever agree with the one below it.
    expect(compactMoneyScale(99_999_999_999)).toBe("Mr");
    expect(compactMoneyScale(99_999_999_999_999)).toBe("Tr");
  });

  it("groups thousands with a full stop and keeps the comma for kuruş", () => {
    // The separator characters themselves, which no example above asserts:
    // swap them and every amount in the app still parses and still looks like
    // a number.
    expect(formatTRInputLive("1234567")).toBe("1.234.567");
    expect(formatTRInputLive("1234,5")).toBe("1.234,5");
    expect(formatTRInputLive("₺ 1 234 567")).toBe("1.234.567");
  });

  it("gives a bare kuruş entry its leading zero", () => {
    expect(formatTRInputLive(",5")).toBe("0,5");
    expect(formatTRInputLive(",")).toBe("0,");
  });

  it("keeps a lone minus so the field can be typed into", () => {
    // Deleting back to just the sign must not erase the sign as well; the
    // next keystroke is the amount it belongs to.
    expect(formatTRInputLive("-")).toBe("-");
    expect(formatTRInputLive("")).toBe("");
  });

  it("keeps every operator in a sum expression", () => {
    // The operators are what makes it an expression. Dropping one turns
    // "300+400" into "300400" under the user's cursor.
    expect(formatMoneyInputLive("300+400")).toBe("300+400");
    expect(formatMoneyInputLive("1250+500")).toBe("1.250+500");
    expect(formatMoneyInputLive("+300+1250,50-100")).toBe("+300+1.250,50-100");
  });

  it("reads an amount that arrived with whitespace around it", () => {
    expect(readTRAmount("  1.234,56  ")).toEqual({ ok: true, minor: 123456 });
    expect(readTRAmount("   ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("FX", () => {
  const rates = [
    { currency: "USD", rateDate: "2026-07-03", rateTry: 41.2345 },
    { currency: "USD", rateDate: "2026-07-02", rateTry: 41.1 },
    { currency: "EUR", rateDate: "2026-07-03", rateTry: 48.5 },
  ];

  it("converts with half-away-from-zero rounding", () => {
    expect(convertToTryMinor(100_00, 41.2345)).toBe(412345);
    expect(convertToTryMinor(1, 41.2345)).toBe(41);
  });

  it("rejects invalid rates", () => {
    expect(() => convertToTryMinor(100, 0)).toThrow();
    expect(() => convertToTryMinor(100, NaN)).toThrow();
    expect(() => convertToTryMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });

  it("picks the exact-date rate when present", () => {
    const hit = pickRate(rates, "USD", "2026-07-03")!;
    expect(hit.rate.rateTry).toBe(41.2345);
    expect(hit.isStale).toBe(false);
  });

  it("falls back to the last known rate and flags staleness (weekend)", () => {
    const hit = pickRate(rates, "USD", "2026-07-05")!;
    expect(hit.rate.rateDate).toBe("2026-07-03");
    expect(hit.isStale).toBe(true);
  });

  it("returns null when no rate is cached", () => {
    expect(pickRate(rates, "GBP", "2026-07-05")).toBeNull();
  });

  it("pins FX failure messages and stable tie selection", () => {
    expect(() => convertToTryMinor(100, 0)).toThrow("Invalid FX rate: 0");
    expect(() => convertToTryMinor(Number.MAX_SAFE_INTEGER, 2))
      .toThrow("Converted amount exceeds safe minor-unit range");
    const first = { currency: "USD", rateDate: "2026-07-18", rateTry: 40 };
    const duplicate = { currency: "USD", rateDate: "2026-07-18", rateTry: 41 };
    expect(pickRate([first, duplicate], "USD", "2026-07-18")?.rate).toBe(first);
    expect(pickRate([
      { currency: "USD", rateDate: "2026-07-17", rateTry: 39 }, first,
    ], "USD", "2026-07-18")?.rate).toBe(first);
  });
});

describe("computed columns", () => {
  const data: MonthAggregates = {
    byCategory: new Map([
      ["fatura", 4424_03],
      ["abonelik", 1200_00],
      ["market", 500_00],
    ]),
    incomeMinor: 10_000_00,
    expenseMinor: 6_124_03,
    ccSingleMinor: 1_431_615,
    ccInstallmentMinor: 1_882_292,
  };

  it("evaluates sum over categories", () => {
    const def = parseDefinition({ op: "sum", categoryIds: ["fatura", "abonelik"] });
    expect(evaluateComputedColumn(def, data)).toBe(5624_03);
  });

  it("evaluates difference of category groups", () => {
    const def = parseDefinition({ op: "difference", plusCategoryIds: ["fatura"], minusCategoryIds: ["market"] });
    expect(evaluateComputedColumn(def, data)).toBe(3924_03);
  });

  it("evaluates income minus expense", () => {
    const def = parseDefinition({ op: "income_minus_expense" });
    expect(evaluateComputedColumn(def, data)).toBe(3_875_97);
  });

  it("evaluates credit-card split parts", () => {
    expect(evaluateComputedColumn(parseDefinition({ op: "cc_split", part: "single" }), data)).toBe(1_431_615);
    expect(evaluateComputedColumn(parseDefinition({ op: "cc_split", part: "installment" }), data)).toBe(1_882_292);
  });

  it("rejects unknown ops and malformed definitions (no formula engine)", () => {
    expect(() => parseDefinition({ op: "eval", code: "1+1" })).toThrow();
    expect(() => parseDefinition({ op: "sum", categoryIds: [] })).toThrow();
    expect(() => parseDefinition({ op: "difference", plusCategoryIds: ["a"] })).toThrow();
    expect(() => parseDefinition({ op: "income_minus_expense", code: "1+1" })).toThrow();
    expect(() => parseDefinition({ op: "sum", categoryIds: ["a", "a"] })).toThrow();
    expect(() => parseDefinition({
      op: "sum",
      categoryIds: Array.from({ length: MAX_COMPUTED_CATEGORY_IDS + 1 }, (_, index) => String(index)),
    })).toThrow();
  });

  // The validator is hand-written and reached from JSON.parse of synced rows, so these shapes are real inputs.
  it("refuses definitions that are not an object of the declared shape", () => {
    for (const raw of [null, undefined, 42, "sum", true, [], [{ op: "sum" }]]) {
      expect(() => parseDefinition(raw)).toThrow();
    }
    expect(() => parseDefinition({})).toThrow();
    expect(() => parseDefinition({ op: null })).toThrow();
    expect(() => parseDefinition({ op: { toString: () => "sum" } })).toThrow();
  });

  it("refuses category lists that are not lists of non-empty strings", () => {
    expect(() => parseDefinition({ op: "sum", categoryIds: "a" })).toThrow();
    expect(() => parseDefinition({ op: "sum", categoryIds: [1] })).toThrow();
    expect(() => parseDefinition({ op: "sum", categoryIds: [""] })).toThrow();
    expect(() => parseDefinition({ op: "sum", categoryIds: [null] })).toThrow();
    expect(() => parseDefinition({ op: "difference", plusCategoryIds: ["a"], minusCategoryIds: [] })).toThrow();
  });

  it("refuses a key the branch did not declare, including one JSON can smuggle", () => {
    expect(() => parseDefinition({ op: "cc_split", part: "single", extra: 1 })).toThrow();
    expect(() => parseDefinition({ op: "cc_split", part: "both" })).toThrow();
    // `JSON.parse` makes `__proto__` an OWN property, so strict keys are what
    // stop it rather than any prototype check.
    expect(() => parseDefinition(JSON.parse('{"op":"income_minus_expense","__proto__":{"x":1}}'))).toThrow();
  });

  it("returns only the declared keys, so a definition cannot carry a payload", () => {
    expect(parseDefinition({ op: "cc_split", part: "installment" }))
      .toEqual({ op: "cc_split", part: "installment" });
    expect(Object.keys(parseDefinition({ op: "income_minus_expense" }))).toEqual(["op"]);
  });

  it("accepts multi-category definitions and rejects duplicates across difference sides", () => {
    expect(parseDefinition({ op: "sum", categoryIds: ["a", "b"] }))
      .toEqual({ op: "sum", categoryIds: ["a", "b"] });
    expect(parseDefinition({ op: "difference", plusCategoryIds: ["a", "b"], minusCategoryIds: ["c", "d"] }))
      .toEqual({ op: "difference", plusCategoryIds: ["a", "b"], minusCategoryIds: ["c", "d"] });
    expect(() => parseDefinition({ op: "difference", plusCategoryIds: ["a"], minusCategoryIds: ["a"] }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining("Computed categories must be unique"), issues: [expect.objectContaining({ code: "custom" })] }));
    expect(() => parseDefinition({
      op: "difference",
      plusCategoryIds: Array.from({ length: MAX_COMPUTED_CATEGORY_IDS + 1 }, (_, index) => String(index)),
      minusCategoryIds: ["other"],
    })).toThrow();
  });

  it("treats a missing computed category as zero in both arithmetic operations", () => {
    const sparse: MonthAggregates = {
      byCategory: new Map([["known", 500]]),
      incomeMinor: 0,
      expenseMinor: 0,
      ccSingleMinor: 0,
      ccInstallmentMinor: 0,
    };

    expect(evaluateComputedColumn(parseDefinition({ op: "sum", categoryIds: ["missing"] }), sparse)).toBe(0);
    expect(evaluateComputedColumn(parseDefinition({
      op: "difference",
      plusCategoryIds: ["missing-plus"],
      minusCategoryIds: ["missing-minus"],
    }), sparse)).toBe(0);
  });
});

describe("compact scale and live-input edge contracts", () => {
  it("pins compact-scale promotion on both sides of each boundary", () => {
    expect(compactMoneyScale(1)).toBe("Mn");
    expect(compactMoneyScale(100_000_000)).toBe("Mn");
    expect(compactMoneyScale(100_000_000_000)).toBe("Mr");
    expect(compactMoneyScale(999_999_499_99)).toBe("Mn");
    expect(compactMoneyScale(999_999_500_00)).toBe("Mr");
    expect(compactMoneyScale(999_999_499_999_00)).toBe("Mr");
    expect(compactMoneyScale(999_999_500_000_00)).toBe("Tr");
    expect(compactMoneyScale(100_000_000_000_000)).toBe("Tr");
  });

  it("pins parser and live-format empty/operator behavior", () => {
    expect(splitIntoInstallments(1, 1)).toEqual([1]);
    expect(parseTR("  ₺  ")).toBeNull();
    expect(formatTRInputLive("-")).toBe("-");
    expect(formatTRInputLive("+")).toBe("");
    expect(formatMoneyInputLive("-400")).toBe("-400");
    expect(formatMoneyInputLive("400-200+50")).toBe("400-200+50");
    expect(parseAmountExpression("+")).toBeNull();
    expect(parseAmountExpression("400-200+50")).toBe(250_00);
    expect(parseTR("  ₺ 1.250,50 ")).toBe(125_050);
    expect(formatTRInputLive(" - 400")).toBe("-400");
    expect(formatTRInputLive("abc,5")).toBe("0,5");
    expect(formatMoneyInputLive(" ₺ 400 + 500 ")).toBe("400+500");
    expect(parseAmountExpression(" 1 + 2 ")).toBe(300);
    expect(formatMinorCompactAtScale(100_000_000, "Mn", "USD")).toBe("USD 1 Mn");
    expect(formatMinorCompactAtScale(123_456_789, "Mn")).toBe("₺1.235 Mn");
    expect(() => splitIntoInstallments(100, 0)).toThrow("Invalid installment count: 0");
    expect(() => splitIntoInstallments(100.5, 2)).toThrow("Amount must be an integer of minor units, got: 100.5");
  });
});

describe("the converter's rate and cross-conversion", () => {
  const noonOf = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime();
  const cached = (rateDate: string, isStale: boolean) => ({ rate: { currency: "USD", rateDate, rateTry: 40 }, isStale });

  it("uses a live quote silently, even over a newer cache", () => {
    expect(converterRate({ rateTry: 41, receivedAt: noonOf(2026, 4, 1), live: true }, cached("2026-04-10", true)))
      .toEqual({ rateTry: 41, badge: null });
  });

  it("uses the last-known quote with its receipt time unless the cache is strictly newer", () => {
    const market = { rateTry: 41, receivedAt: noonOf(2026, 4, 10), live: false };
    expect(converterRate(market, null)).toEqual({ rateTry: 41, badge: { kind: "market", receivedAt: market.receivedAt } });
    expect(converterRate(market, cached("2026-04-10", false))).toEqual({ rateTry: 41, badge: { kind: "market", receivedAt: market.receivedAt } });
    expect(converterRate(market, cached("2026-04-09", true))).toEqual({ rateTry: 41, badge: { kind: "market", receivedAt: market.receivedAt } });
    expect(converterRate(market, cached("2026-04-11", false))).toEqual({ rateTry: 40, badge: null });
  });

  it("dates a stale cached rate and has nothing without either source", () => {
    expect(converterRate(null, cached("2026-04-09", true))).toEqual({ rateTry: 40, badge: { kind: "fx", rateDate: "2026-04-09" } });
    expect(converterRate(null, cached("2026-04-09", false))).toEqual({ rateTry: 40, badge: null });
    expect(converterRate(null, null)).toBeNull();
  });

  it("cross-rates through TRY, rounding half away from zero", () => {
    expect(crossConvertMinor(10_000, 40, 1)).toBe(400_000);
    expect(crossConvertMinor(400_000, 1, 40)).toBe(10_000);
    expect(crossConvertMinor(1, 3, 2)).toBe(2);
    expect(crossConvertMinor(-1, 3, 2)).toBe(-2);
    expect(crossConvertMinor(1, 1, 3)).toBe(0);
    expect(crossConvertMinor(0, 40, 50)).toBe(0);
  });

  it("has no result outside the safe minor-unit range", () => {
    expect(crossConvertMinor(Number.MAX_SAFE_INTEGER, 1, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(crossConvertMinor(Number.MAX_SAFE_INTEGER, 2, 1)).toBeNull();
  });
});
