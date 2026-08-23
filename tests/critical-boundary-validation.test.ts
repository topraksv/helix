import { describe, expect, it } from "vitest";
import {
  isSupportedCurrency,
  isValidRateDate,
  parseOpenExchangeRates,
  parseTcmbRates,
} from "../src/domain/fx-provider";
import { assertInputWithinLimit, utf8ByteLength } from "../src/domain/input";
import { foldForMatch, nameMentions, normalizeLogoDomain, remoteFaviconUrl } from "../src/domain/logo-domain";
import { createNotificationReplacementQueue } from "../src/domain/notifications";
import { trustedSupabaseOrigin } from "../src/domain/web-security";

describe("external data boundary validation", () => {
  it("accepts only real provider calendar dates in the supported era", () => {
    expect(isValidRateDate("2000-02-29")).toBe(true);
    expect(isValidRateDate("2200-12-31")).toBe(true);
    for (const invalid of ["1999-12-31", "2201-01-01", "2026-00-01", "2026-13-01", "2026-02-29", "2026-01-00"]) {
      expect(isValidRateDate(invalid), invalid).toBe(false);
    }
  });

  it("parses the Turkish TCMB date and discards unsupported or invalid quotes", () => {
    const batch = parseTcmbRates(`
      <Tarih_Date Tarih="18.07.2026">
        <Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>40.5</ForexSelling></Currency>
        <Currency CurrencyCode="EUR"><Unit>0</Unit><ForexSelling>47</ForexSelling></Currency>
        <Currency CurrencyCode="GBP"><Unit>1</Unit><ForexSelling>0</ForexSelling></Currency>
        <Currency CurrencyCode="XXX"><Unit>1</Unit><ForexSelling>10</ForexSelling></Currency>
      </Tarih_Date>
    `);
    expect(batch).toEqual({ rateDate: "2026-07-18", rates: [{ currency: "USD", rateTry: 40.5 }] });
  });

  it("rejects malformed open-feed containers and ignores bad quotes beside a valid one", () => {
    for (const invalid of [null, [], "success", { result: "success", time_last_update_unix: 1, rates: [] }]) {
      expect(() => parseOpenExchangeRates(invalid), JSON.stringify(invalid)).toThrow("Invalid FX response");
    }
    expect(parseOpenExchangeRates({
      result: "success",
      time_last_update_unix: 1_784_332_800,
      rates: { USD: 0.025, EUR: Number.NaN, GBP: -1, CHF: "0.02" },
    }).rates).toEqual([{ currency: "USD", rateTry: 40 }]);
    expect(isSupportedCurrency("TRY")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("BTC")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});

describe("identity and network boundary validation", () => {
  it("folds Turkish text and matches only complete words", () => {
    expect(foldForMatch("  İŞ GÜÇ  ")).toBe("is guc");
    expect(nameMentions("İSKİ faturası", "iski")).toBe(true);
    expect(nameMentions("Netflix", "net")).toBe(false);
    expect(nameMentions("Netflix", "flix")).toBe(false);
    expect(nameMentions("Netflix", "")).toBe(false);
    expect(nameMentions("Müzik", "video")).toBe(false);
    expect(nameMentions("", "")).toBe(false);
    expect(nameMentions("", "video")).toBe(false);
  });

  it("rejects absent, oversized, malformed, and invalid-label favicon domains", () => {
    expect(normalizeLogoDomain(undefined)).toBeNull();
    expect(normalizeLogoDomain("x".repeat(513))).toBeNull();
    expect(normalizeLogoDomain("https://bad_label.example.com")).toBeNull();
    expect(normalizeLogoDomain("https://-bad.example.com")).toBeNull();
    expect(normalizeLogoDomain("https://example.com:444")).toBeNull();
    expect(normalizeLogoDomain("://not a url")).toBeNull();
    expect(remoteFaviconUrl("localhost")).toBeNull();
  });

  /**
   * The scheme test is ANCHORED, and an anchor is invisible until something
   * matches in the wrong place.
   *
   * The IP test is anchored too, but nothing can reach past it: WHATWG parses
   * any host whose last label is numeric as IPv4, so `a1.2.3.4` is refused by
   * `new URL` before the pattern is ever consulted. That anchor cannot be
   * demonstrated from the outside, and a test that pretended otherwise would
   * be asserting the parser rather than this guard.
   */
  it("looks for a scheme only where a scheme can be", () => {
    // "://" inside a path does not make the string a URL of its own. Read
    // unanchored, the value is handed to `new URL` unprefixed, which throws,
    // and a perfectly good domain resolves to nothing.
    expect(normalizeLogoDomain("example.com/a://b")).toBe("example.com");
    expect(normalizeLogoDomain("1.2.3.4")).toBeNull();
    expect(normalizeLogoDomain("https://1.2.3.4")).toBeNull();
  });

  it("accepts a bare project origin and rejects every extra URL component", () => {
    expect(trustedSupabaseOrigin(undefined)).toBeNull();
    expect(trustedSupabaseOrigin("not a url")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co?token=x")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co#fragment")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co:444")).toBeNull();
    expect(trustedSupabaseOrigin("https://evil.project.supabase.co")).toBeNull();
    expect(trustedSupabaseOrigin("https://project.supabase.co/")).toBe("https://project.supabase.co");
  });
});

describe("resource guards", () => {
  it("counts every UTF-8 width and accepts a value exactly at its input limit", () => {
    expect(utf8ByteLength("A¢€🧭")).toBe(1 + 2 + 3 + 4);
    expect(() => assertInputWithinLimit("x".repeat(120), "text")).not.toThrow();
  });

  it("keeps the notification queue live after a failed replacement", async () => {
    const replace = createNotificationReplacementQueue();
    await expect(replace(async () => { throw new Error("first failed"); })).rejects.toThrow("first failed");
    await expect(replace(async () => "second ran")).resolves.toBe("second ran");
  });
});
