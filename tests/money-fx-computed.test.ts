import { describe, expect, it } from "vitest";
import {
  COMPACT_MONEY_THRESHOLD_MINOR,
  MAX_ABS_AMOUNT_MINOR,
  formatMinor,
  formatMinorCompact,
  formatMinorCompactAtScale,
  formatMinorInput,
  formatMoneyInputLive,
  formatTRInputLive,
  majorToMinor,
  parseAmountExpression,
  parseTRAmountToMinor,
  usesCompactMoneyScale,
} from "../src/domain/money";
import { convertToTryMinor, pickRate } from "../src/domain/fx";
import {
  evaluateComputedColumn,
  MAX_COMPUTED_CATEGORY_IDS,
  parseDefinition,
  type MonthAggregates,
} from "../src/domain/computed-columns";

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
    expect(parseTRAmountToMinor("18.822,92")).toBe(1882292);
    expect(parseTRAmountToMinor("1234,5")).toBe(123450);
  });

  it("parses spreadsheet-style sum expressions", () => {
    expect(parseAmountExpression("300+400+500")).toBe(120000);
    expect(parseAmountExpression("+300+400,50")).toBe(70050);
    expect(parseAmountExpression("1.250,50-250,50")).toBe(100000);
    expect(parseAmountExpression("750")).toBe(75000);
    expect(parseAmountExpression("300++400")).toBeNull();
    expect(parseAmountExpression("abc+3")).toBeNull();
    expect(parseAmountExpression("")).toBeNull();
    expect(parseTRAmountToMinor("1234")).toBe(123400);
    expect(parseTRAmountToMinor("-2.024,99")).toBe(-202499);
    expect(parseTRAmountToMinor("₺ 500")).toBe(50000);
  });

  it("rejects malformed input instead of guessing", () => {
    expect(parseTRAmountToMinor("")).toBeNull();
    expect(parseTRAmountToMinor("12.34")).toBeNull(); // dot is a thousands separator in TR
    expect(parseTRAmountToMinor("1,234.56")).toBeNull();
    expect(parseTRAmountToMinor("abc")).toBeNull();
    expect(parseTRAmountToMinor("12,345")).toBeNull(); // 3 decimal digits
  });

  it("rejects amounts beyond the product limit before they can break layouts", () => {
    expect(parseTRAmountToMinor("99999999999999999999")).toBeNull();
    expect(parseAmountExpression("99999999999999999999+1")).toBeNull();
    // Just past the ~1 trillion ceiling → refused.
    expect(parseTRAmountToMinor("1000000000000")).toBeNull();
    expect(parseAmountExpression("600000000000+600000000000")).toBeNull();
    // Exactly the ceiling parses to MAX; a billion is now comfortably inside it.
    expect(parseTRAmountToMinor("999999999999,99")).toBe(MAX_ABS_AMOUNT_MINOR);
    expect(parseTRAmountToMinor("1000000000")).toBe(100_000_000_000); // 1 milyar TL kabul edilir
    expect(majorToMinor(999_999_999_999.99)).toBe(MAX_ABS_AMOUNT_MINOR);
    expect(majorToMinor(1_000_000_000_000)).toBeNull();
    expect(majorToMinor(Number.NaN)).toBeNull();
  });

  it("keeps an over-limit typed value visible but refuses to parse it", () => {
    const formatted = formatTRInputLive("1234567890123");
    expect(formatted).toBe("1.234.567.890.123");
    expect(parseTRAmountToMinor(formatted)).toBeNull();
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
    expect(formatTRInputLive(",5")).toBe("0,5");
    expect(formatTRInputLive("₺ 1.250,50")).toBe("1.250,50"); // idempotent on formatted
  });

  it("loads saved values into the one exact editable input format", () => {
    expect(formatMinorInput(123_456_789)).toBe("1.234.567,89");
    expect(formatMinorInput(-230_000_000_000)).toBe("-2.300.000.000,00");
  });

  it("live-format output is always parseable back to minor units", () => {
    for (const raw of ["15000", "1234,5", "1.250,50", "9999999", "42,9"]) {
      const formatted = formatTRInputLive(raw);
      expect(parseTRAmountToMinor(formatted)).not.toBeNull();
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
});

describe("computed columns", () => {
  const data: MonthAggregates = {
    month: "2026-07",
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

  // The shapes a schema library used to refuse on this file's behalf. They are
  // pinned here because the validator is hand-written now: every one of these
  // reaches it from `JSON.parse` of a synced or restored row, so "not an
  // object" and "not a string" are inputs, not hypotheticals.
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
});

// (spreadsheet import parsing moved to tests/spreadsheet-import.test.ts)
