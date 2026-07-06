import { describe, expect, it } from "vitest";
import { formatMinor, parseAmountExpression, parseTRAmountToMinor } from "../src/domain/money";
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

describe("spreadsheet import parsing", async () => {
  const { parseMonthLabel, parseSheet, parseSheetAmount } = await import("../src/services/spreadsheet-import");

  it("parses month labels in common formats", () => {
    expect(parseMonthLabel("Ocak 2025")).toBe("2025-01");
    expect(parseMonthLabel("oca 25")).toBe("2025-01");
    expect(parseMonthLabel("2025-03")).toBe("2025-03");
    expect(parseMonthLabel("03.2025")).toBe("2025-03");
    expect(parseMonthLabel("Toplam")).toBeNull();
  });

  it("parses sheet amounts in TR/EN/number forms", () => {
    expect(parseSheetAmount(1234.5)).toBe(123450);
    expect(parseSheetAmount("1.234,56")).toBe(123456);
    expect(parseSheetAmount("1,234.56")).toBe(123456);
    expect(parseSheetAmount("")).toBeNull();
  });

  it("normalizes months-as-columns sheets and skips balance columns", () => {
    const sheet = parseSheet([
      ["Kalem", "Ocak 2025", "Şubat 2025"],
      ["Market", "1.000", "1.200"],
      ["Maaş", "50.000", "50.000"],
      ["Ay Başı Bakiye", "10.000", "12.000"],
    ]);
    expect(sheet).not.toBeNull();
    expect(sheet!.months).toEqual(["2025-01", "2025-02"]);
    expect(sheet!.columns.map((c) => c.label)).toEqual(["Market", "Maaş"]);
    expect(sheet!.columns[1].kindGuess).toBe("income");
    expect(sheet!.skippedColumns).toEqual(["Ay Başı Bakiye"]);
    expect(sheet!.cells[0][0]).toBe(100000);
  });
});
