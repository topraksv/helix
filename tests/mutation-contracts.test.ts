import { describe, expect, it } from "vitest";
import {
  CURRENCY_INFO,
  FETCHED_FX_CURRENCIES,
  isSupportedCurrency,
  isValidRateDate,
  parseOpenExchangeRates,
  parseTcmbRates,
} from "../src/domain/fx-provider";
import { isISODate, isMonthKey, makeMonthKey, monthRange } from "../src/domain/dates";
import { INPUT_LIMITS, isValidNewPassword, utf8ByteLength } from "../src/domain/input";
import { foldForMatch, normalizeLogoDomain } from "../src/domain/logo-domain";
import { freshMarketQuote, validMarketQuote } from "../src/domain/market";
import {
  compactMoneyScale,
  formatMinorCompactAtScale,
  formatMoneyInputLive,
  formatTRInputLive,
  parseAmountExpression,
  parseTRAmountToMinor,
  splitIntoInstallments,
} from "../src/domain/money";
import { decodeSettingValue } from "../src/domain/settings";
import { filterTransactions } from "../src/domain/transaction-search";
import { PAYMENT_SOURCE_TYPES } from "../src/domain/types";
import { LOCAL_ONLY_USER_ID } from "../src/domain/user-id";
import { trustedSupabaseOrigin } from "../src/domain/web-security";

describe("mutation-sensitive external contracts", () => {
  it("pins the complete curated currency identity catalog", () => {
    expect(FETCHED_FX_CURRENCIES).toEqual([
      "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD", "SEK", "NOK", "DKK", "CNY", "KRW", "RON",
      "RUB", "AED", "SAR", "AZN", "KWD", "ALL", "BGN", "GEL",
    ]);
    expect(CURRENCY_INFO).toEqual({
      TRY: { flag: "🇹🇷", name: "Türk Lirası" },
      USD: { flag: "🇺🇸", name: "Amerikan Doları" },
      EUR: { flag: "🇪🇺", name: "Euro" },
      GBP: { flag: "🇬🇧", name: "İngiliz Sterlini" },
      CHF: { flag: "🇨🇭", name: "İsviçre Frangı" },
      JPY: { flag: "🇯🇵", name: "Japon Yeni" },
      AUD: { flag: "🇦🇺", name: "Avustralya Doları" },
      CAD: { flag: "🇨🇦", name: "Kanada Doları" },
      SEK: { flag: "🇸🇪", name: "İsveç Kronu" },
      NOK: { flag: "🇳🇴", name: "Norveç Kronu" },
      DKK: { flag: "🇩🇰", name: "Danimarka Kronu" },
      CNY: { flag: "🇨🇳", name: "Çin Yuanı" },
      KRW: { flag: "🇰🇷", name: "Güney Kore Wonu" },
      RON: { flag: "🇷🇴", name: "Rumen Leyi" },
      RUB: { flag: "🇷🇺", name: "Rus Rublesi" },
      AED: { flag: "🇦🇪", name: "BAE Dirhemi" },
      SAR: { flag: "🇸🇦", name: "Suudi Riyali" },
      AZN: { flag: "🇦🇿", name: "Azerbaycan Manatı" },
      KWD: { flag: "🇰🇼", name: "Kuveyt Dinarı" },
      ALL: { flag: "🇦🇱", name: "Arnavut Leki" },
      BGN: { flag: "🇧🇬", name: "Bulgar Levası" },
      GEL: { flag: "🇬🇪", name: "Gürcistan Larisi" },
    });
    for (const currency of [...FETCHED_FX_CURRENCIES, "TRY"] as const) expect(isSupportedCurrency(currency)).toBe(true);
  });

  it("anchors provider dates and XML attributes exactly", () => {
    expect(isValidRateDate("2026-07-18")).toBe(true);
    expect(isValidRateDate("x2026-07-18")).toBe(false);
    expect(isValidRateDate("2026-07-18x")).toBe(false);
    for (const xml of [
      '<Tarih_DateX Date="07/18/2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_DateX>',
      '<Tarih_Date Date="7/18/2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/8/2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/18/26"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
    ]) expect(() => parseTcmbRates(xml)).toThrow("TCMB response has no valid rate date");
    expect(parseTcmbRates('<Tarih_Date Date="07/18/2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>'))
      .toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 40 }] });
    expect(parseTcmbRates('<Tarih_Date Tarih="18.07.2026"><Currency CurrencyCode="USD"><Unit>2</Unit><ForexSelling>80</ForexSelling></Currency></Tarih_Date>'))
      .toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 40 }] });
    expect(parseTcmbRates('<Tarih_Date Source="TCMB" Date="07/18/2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>'))
      .toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 40 }] });
    expect(parseTcmbRates('<Tarih_Date Source="TCMB" Tarih="18.07.2026"><Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>'))
      .toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 40 }] });
    for (const xml of [
      '<Tarih_Date Date="07/18/2026"><Currency><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/18/2026"><Currency Foo="bar"><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/18/2026"><Currency CurrencyCode="USD"><Unit>0</Unit><ForexSelling>40</ForexSelling></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/18/2026"><Currency CurrencyCode="USD"><Unit>1</Unit></Currency></Tarih_Date>',
      '<Tarih_Date Date="07/18/2026"><Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>1000001</ForexSelling></Currency></Tarih_Date>',
    ]) expect(() => parseTcmbRates(xml)).toThrow("TCMB response has no supported rates");
    expect(parseTcmbRates('<Tarih_Date Date="07/18/2026"><Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>1000000</ForexSelling></Currency></Tarih_Date>'))
      .toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 1_000_000 }] });
  });

  // Correct behavior is pending under docs/SPEC.md, "Known defect — malformed TCMB unit values".
  it.todo("rejects a decimal TCMB Unit instead of treating it as the implicit unit");

  it("enforces quote boundaries rather than accepting zero or over-limit rates", () => {
    const published = 1_784_332_800;
    const batch = (rate: number) => parseOpenExchangeRates({ result: "success", time_last_update_unix: published, rates: { USD: rate } });
    expect(batch(0.000001).rates).toEqual([{ currency: "USD", rateTry: 1_000_000 }]);
    expect(() => batch(0)).toThrow("FX response has no supported rates");
    expect(() => batch(0.0000009)).toThrow("FX response has no supported rates");
    expect(() => parseOpenExchangeRates({ result: "success", time_last_update_unix: 0, rates: { USD: 0.025 } })).toThrow("Invalid FX response");
    for (const invalidPublished of [null, "1", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => parseOpenExchangeRates({ result: "success", time_last_update_unix: invalidPublished, rates: { USD: 0.025 } }))
        .toThrow("Invalid FX response");
    }
    for (const rates of [null, [], "rates"]) {
      expect(() => parseOpenExchangeRates({ result: "success", time_last_update_unix: published, rates }))
        .toThrow("Invalid FX response");
    }
    for (const rate of ["0.025", Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      expect(() => parseOpenExchangeRates({ result: "success", time_last_update_unix: published, rates: { USD: rate } }))
        .toThrow("FX response has no supported rates");
    }
    expect(() => batch(Number.MIN_VALUE)).toThrow("FX response has no supported rates");
    expect(isSupportedCurrency("toString")).toBe(false);
    expect(isSupportedCurrency({ toString: () => "TRY" })).toBe(false);
    expect(() => parseOpenExchangeRates({ result: "failure" })).toThrow("FX provider reported a failure");
  });

  it("pins persistence identity constants", () => {
    expect(PAYMENT_SOURCE_TYPES).toEqual([
      "credit_card", "debit_card", "virtual_card", "e_wallet", "cash", "direct_debit", "bank_transfer",
    ]);
    expect(LOCAL_ONLY_USER_ID).toBe("00000000-0000-0000-0000-000000000001");
  });
});

describe("mutation-sensitive boundary comparisons", () => {
  it("anchors date and month formats at both ends", () => {
    expect(isMonthKey("0001-01")).toBe(true);
    expect(isMonthKey("0000-01")).toBe(false);
    expect(isMonthKey("x2026-01")).toBe(false);
    expect(isMonthKey("2026-01x")).toBe(false);
    expect(isISODate("0001-01-01")).toBe(true);
    expect(isISODate("0000-01-01")).toBe(false);
    expect(isISODate("x2026-01-01")).toBe(false);
    expect(isISODate("2026-01-01x")).toBe(false);
    expect(makeMonthKey(7, 2)).toBe("0007-02");
    expect(monthRange("2026-02", "2026-01")).toEqual([]);
    expect(monthRange("2026-03", "2026-01")).toEqual([]);
    const monthLike = { toString: () => "2026-01", slice: (start: number, end: number) => "2026-01".slice(start, end) };
    const dateLike = { toString: () => "2026-01-01", slice: (start: number, end: number) => "2026-01-01".slice(start, end) };
    expect(isMonthKey(monthLike)).toBe(false);
    expect(isISODate(dateLike)).toBe(false);
    expect(isMonthKey("2026-012026-01")).toBe(false);
    expect(isISODate("2026-01-012026-01-01")).toBe(false);
  });

  it("counts UTF-8 code point thresholds inclusively", () => {
    expect(utf8ByteLength(String.fromCodePoint(0x7f))).toBe(1);
    expect(utf8ByteLength(String.fromCodePoint(0x7ff))).toBe(2);
    expect(utf8ByteLength(String.fromCodePoint(0xffff))).toBe(3);
    expect(isValidNewPassword("x".repeat(INPUT_LIMITS.password))).toBe(true);
  });

  it("accepts both exact market ceilings and exact freshness age", () => {
    expect(validMarketQuote(1_000_000, 1_000_000)).toBe(true);
    expect(validMarketQuote(1_000_001, 1)).toBe(false);
    expect(validMarketQuote(1, 1_000_001)).toBe(false);
    expect(validMarketQuote(Number.POSITIVE_INFINITY, 1)).toBe(false);
    expect(validMarketQuote(-1, 1)).toBe(false);
    expect(validMarketQuote(0, 1)).toBe(false);
    expect(freshMarketQuote(1_000, 1_600, 600)).toBe(true);
    expect(freshMarketQuote(1_000, 1_601, 600)).toBe(false);
  });

  it("keeps network host matching anchored to the entire hostname", () => {
    expect(trustedSupabaseOrigin("https://project.supabase.co")).toBe("https://project.supabase.co");
    expect(trustedSupabaseOrigin("https://evil-project.supabase.co.attacker.test")).toBeNull();
    expect(trustedSupabaseOrigin("https://attacker.test/project.supabase.co")).toBeNull();
  });

  it("pins Turkish folding and public-host validation details", () => {
    expect(foldForMatch("ıİşŞğĞüÜöÖçÇ")).toBe("iissgguuoocc");
    expect(normalizeLogoDomain("example.com")).toBe("example.com");
    expect(normalizeLogoDomain("127.0.0.1.example.com")).toBe("127.0.0.1.example.com");
    expect(normalizeLogoDomain("127.0.0.1")).toBeNull();
    expect(normalizeLogoDomain("example.com.attacker")).toBe("example.com.attacker");
    expect(normalizeLogoDomain(" example.com ")).toBe("example.com");
    expect(normalizeLogoDomain("https://:password@example.com")).toBeNull();
    expect(normalizeLogoDomain("local")).toBeNull();
    expect(normalizeLogoDomain("example")).toBeNull();
    expect(normalizeLogoDomain("x.local")).toBeNull();
    expect(normalizeLogoDomain("11.22.33.x")).toBe("11.22.33.x");
    expect(normalizeLogoDomain("11.22.33.44")).toBeNull();
    const maxHost = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
    expect(maxHost).toHaveLength(253);
    expect(normalizeLogoDomain(maxHost)).toBe(maxHost);
    const oversizedHost = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`;
    expect(oversizedHost).toHaveLength(254);
    expect(normalizeLogoDomain(oversizedHost)).toBeNull();
    expect(normalizeLogoDomain("h2://example.com")).toBe("example.com");
    const exactRawLimit = `https://example.com/${"a".repeat(492)}`;
    expect(exactRawLimit).toHaveLength(512);
    expect(normalizeLogoDomain(exactRawLimit)).toBe("example.com");
    expect(normalizeLogoDomain(`${exactRawLimit}a`)).toBeNull();
  });
});

describe("mutation-sensitive money and setting contracts", () => {
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
    expect(parseTRAmountToMinor("  ₺  ")).toBeNull();
    expect(formatTRInputLive("-")).toBe("-");
    expect(formatTRInputLive("+")).toBe("");
    expect(formatMoneyInputLive("-400")).toBe("-400");
    expect(formatMoneyInputLive("400-200+50")).toBe("400-200+50");
    expect(parseAmountExpression("+")).toBeNull();
    expect(parseAmountExpression("400-200+50")).toBe(250_00);
    expect(parseTRAmountToMinor("  ₺ 1.250,50 ")).toBe(125_050);
    expect(formatTRInputLive(" - 400")).toBe("-400");
    expect(formatTRInputLive("abc,5")).toBe("0,5");
    expect(formatMoneyInputLive(" ₺ 400 + 500 ")).toBe("400+500");
    expect(parseAmountExpression(" 1 + 2 ")).toBe(300);
    expect(formatMinorCompactAtScale(100_000_000, "Mn", "USD")).toBe("USD 1 Mn");
    expect(formatMinorCompactAtScale(123_456_789, "Mn")).toBe("₺1.235 Mn");
    expect(() => splitIntoInstallments(100, 0)).toThrow("Invalid installment count: 0");
    expect(() => splitIntoInstallments(100.5, 2)).toThrow("Amount must be an integer of minor units, got: 100.5");
  });

  it("accepts collection maxima and rejects near-miss setting keys", () => {
    expect(decodeSettingValue("computed_columns_hidden", JSON.stringify(Array(10_000).fill("x")), [])).toHaveLength(10_000);
    const years = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [String(1500 + index), []]));
    expect(Object.keys(decodeSettingValue("column_years", JSON.stringify(years), {}))).toHaveLength(500);
    expect(decodeSettingValue("column_years", '{"x2026":[]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"2026x":[]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("column_years", '{"2026":[],"bad":[1]}', { safe: [] })).toEqual({ safe: [] });
    expect(decodeSettingValue("opening_balance_minor", "0", -1)).toBe(0);
    expect(decodeSettingValue("reminder_days", "-1", 3)).toBe(3);
    expect(decodeSettingValue("last_entry_at", "123", null)).toBeNull();
    expect(decodeSettingValue("last_entry_at", '"2026-02-30T10:00:00.000Z"', null)).toBeNull();
    expect(decodeSettingValue("column_years", "123", { safe: [] })).toEqual({ safe: [] });
  });
});

describe("mutation-sensitive transaction search contract", () => {
  const rows = [
    { id: "b", type: "expense" as const, categoryId: "cat", paymentSourceId: "bank", effectiveDate: "2026-07-20", searchText: "İstanbul kira" },
    { id: "a", type: "expense" as const, categoryId: "cat", paymentSourceId: "bank", effectiveDate: "2026-07-20", searchText: "İstanbul kira" },
    { id: "old", type: "income" as const, categoryId: null, paymentSourceId: null, effectiveDate: "2026-07-01", searchText: "Maaş" },
  ];

  it("includes both date boundaries and imposes date-plus-id order", () => {
    expect(filterTransactions([...rows].reverse(), {
      query: " istanbul ", type: "expense", categoryId: "cat", paymentSourceId: "bank", from: "2026-07-20", to: "2026-07-20",
    }).map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("applies each filter independently and never mutates input order", () => {
    expect(filterTransactions(rows, { query: "maaş", type: null, categoryId: null, paymentSourceId: null, from: null, to: null }).map((row) => row.id)).toEqual(["old"]);
    expect(filterTransactions(rows, { query: "", type: "income", categoryId: null, paymentSourceId: null, from: null, to: null }).map((row) => row.id)).toEqual(["old"]);
    expect(filterTransactions(rows, { query: "", type: null, categoryId: "missing", paymentSourceId: null, from: null, to: null })).toEqual([]);
    expect(filterTransactions(rows, { query: "", type: null, categoryId: null, paymentSourceId: "missing", from: null, to: null })).toEqual([]);
    expect(filterTransactions(rows, { query: "", type: null, categoryId: null, paymentSourceId: null, from: "2026-07-20", to: null }).map((row) => row.id)).toEqual(["b", "a"]);
    expect(filterTransactions(rows, { query: "", type: null, categoryId: null, paymentSourceId: null, from: null, to: "2026-07-01" }).map((row) => row.id)).toEqual(["old"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a", "old"]);
  });
});
