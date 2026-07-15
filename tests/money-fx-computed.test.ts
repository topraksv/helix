import { describe, expect, it } from "vitest";
import { formatMinor, formatMoneyInputLive, formatTRInputLive, parseAmountExpression, parseTRAmountToMinor } from "../src/domain/money";
import { convertToTryMinor, pickRate } from "../src/domain/fx";
import {
  evaluateComputedColumn,
  parseDefinition,
  type MonthAggregates,
} from "../src/domain/computed-columns";

describe("TR money formatting/parsing", () => {
  it("formats minor units in Turkish locale", () => {
    expect(formatMinor(1882292)).toBe("₺18.822,92");
    expect(formatMinor(-1877303)).toBe("-₺18.773,03");
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

  it("rejects amounts beyond the safe-integer range", () => {
    expect(parseTRAmountToMinor("99999999999999999999")).toBeNull();
    expect(parseAmountExpression("99999999999999999999+1")).toBeNull();
    // sanity: a large but safe amount still parses
    expect(parseTRAmountToMinor("999999999999")).toBe(99999999999900);
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
  });
});

// (spreadsheet import parsing moved to tests/spreadsheet-import.test.ts)
