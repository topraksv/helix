import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFrankfurterRates, parseTcmbRates } from "../src/domain/fx-provider";
import { normalizeLogoDomain, remoteFaviconUrl } from "../src/domain/logo-domain";
import { freshMarketQuote, validMarketQuote } from "../src/domain/market";
import { boundedScheduledNotifications, normalizeReminderDays, privateNotificationContent, uniqueNotifications } from "../src/domain/notifications";
import {
  applyFeed,
  disconnectMarkets,
  markMarketConnectionInterrupted,
  marketSellRateTry,
  MARKET_SYMBOLS,
  suspendMarkets,
  useMarkets,
} from "../src/services/markets";

afterEach(() => {
  disconnectMarkets();
  vi.useRealTimers();
});

describe("external FX provider validation", () => {
  it("keeps TCMB's declared business date and unit-adjusted selling rates", () => {
    const batch = parseTcmbRates(`<?xml version="1.0"?><Tarih_Date Tarih="14.07.2026" Date="07/14/2026">
      <Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>40.5000</ForexSelling></Currency>
      <Currency CurrencyCode="GBP"><Unit>100</Unit><ForexSelling>5250.0000</ForexSelling></Currency>
      <Currency CurrencyCode="JPY"><Unit>100</Unit><ForexSelling>27.0000</ForexSelling></Currency>
    </Tarih_Date>`);
    expect(batch).toEqual({
      rateDate: "2026-07-14",
      rates: [
        { currency: "USD", rateTry: 40.5 },
        { currency: "GBP", rateTry: 52.5 },
      ],
    });
  });

  it("rejects undated or empty TCMB payloads instead of stamping today", () => {
    expect(() => parseTcmbRates(`<Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency>`)).toThrow();
    expect(() => parseTcmbRates(`<Tarih_Date Date="02/30/2026"></Tarih_Date>`)).toThrow();
  });

  it("validates Frankfurter data and preserves its source date", () => {
    expect(parseFrankfurterRates({ date: "2026-07-13", rates: { USD: 0.025, EUR: 0.02, BAD: 10 } })).toEqual({
      rateDate: "2026-07-13",
      rates: [
        { currency: "USD", rateTry: 40 },
        { currency: "EUR", rateTry: 50 },
      ],
    });
    expect(() => parseFrankfurterRates({ date: "2026-07-13", rates: { USD: 0 } })).toThrow();
    expect(() => parseFrankfurterRates({ date: "invalid", rates: { USD: 0.025 } })).toThrow();
  });
});

describe("remote logo boundary", () => {
  it("normalizes public hostnames and encodes the favicon query", () => {
    expect(normalizeLogoDomain("https://WWW.Netflix.com/account")).toBe("www.netflix.com");
    expect(remoteFaviconUrl("netflix.com")).toBe("https://www.google.com/s2/favicons?domain=netflix.com&sz=64");
  });

  it("rejects credentials, ports and local/IP targets", () => {
    for (const value of ["user:pass@example.com", "localhost", "127.0.0.1", "service.local", "example.com:8080"]) {
      expect(normalizeLogoDomain(value)).toBeNull();
    }
  });
});

describe("live market freshness", () => {
  it("keeps USD and EUR in the visible live-market contract", () => {
    expect(MARKET_SYMBOLS.map(({ code }) => code)).toEqual([
      "ALTIN",
      "CEYREK_YENI",
      "ATA_YENI",
      "USDTRY",
      "EURTRY",
    ]);
  });

  it("accepts only finite positive two-sided quotes", () => {
    expect(validMarketQuote("40.2", 40.5)).toBe(true);
    expect(validMarketQuote("NaN", 40.5)).toBe(false);
    expect(validMarketQuote(40, 0)).toBe(false);
    expect(validMarketQuote(40, 1_000_001)).toBe(false);
  });

  it("never treats future or expired receipt timestamps as fresh", () => {
    expect(freshMarketQuote(1_000, 1_500, 600)).toBe(true);
    expect(freshMarketQuote(1_000, 1_601, 600)).toBe(false);
    expect(freshMarketQuote(2_000, 1_500, 600)).toBe(false);
  });

  it("reuses only fresh USD/EUR quotes for conversion", () => {
    const now = 10_000;
    useMarkets.setState({
      status: "live",
      prices: {
        USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: now },
        EURTRY: { code: "EURTRY", buyTry: 47, sellTry: 47.5, direction: "", at: "", receivedAt: now - 60_001 },
      },
      lastEventAt: now,
    });
    expect(marketSellRateTry("USD", now)).toBe(40.5);
    expect(marketSellRateTry("EUR", now)).toBeNull();
    expect(marketSellRateTry("GBP", now)).toBeNull();
    useMarkets.setState({ prices: {}, status: "idle", lastEventAt: null });
  });

  it("defers a burst's newest quote to the trailing edge instead of dropping it", () => {
    vi.useFakeTimers();
    applyFeed({ ALTIN: { code: "ALTIN", alis: "4000", satis: "4010", tarih: "t1" } }, 1_000_000);
    expect(useMarkets.getState().prices.ALTIN?.sellTry).toBe(4_010);

    // Inside the 3 s window: must not apply yet, must not be lost either.
    applyFeed({ ALTIN: { code: "ALTIN", alis: "4005", satis: "4020", tarih: "t2" } }, 1_001_000);
    expect(useMarkets.getState().prices.ALTIN?.sellTry).toBe(4_010);

    vi.advanceTimersByTime(2_000); // window closes 3 s after the first apply
    expect(useMarkets.getState().prices.ALTIN?.sellTry).toBe(4_020);
  });

  it("keeps verified prices through a brief reconnect but expires them after silence", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "live",
      prices: {
        ALTIN: { code: "ALTIN", buyTry: 4_000, sellTry: 4_010, direction: "", at: "", receivedAt: 1_000 },
      },
      lastEventAt: 1_000,
    });

    markMarketConnectionInterrupted();
    expect(useMarkets.getState().status).toBe("stale");
    expect(useMarkets.getState().prices.ALTIN?.sellTry).toBe(4_010);

    vi.advanceTimersByTime(59_999);
    expect(useMarkets.getState().prices.ALTIN).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(useMarkets.getState()).toMatchObject({ prices: {}, status: "error" });
  });

  it("keeps one socket lifecycle alive through a transient app-state change", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "live",
      prices: {
        ALTIN: { code: "ALTIN", buyTry: 4_000, sellTry: 4_010, direction: "", at: "", receivedAt: 1_000 },
      },
      lastEventAt: 1_000,
    });

    suspendMarkets(1_200);
    vi.advanceTimersByTime(1_199);
    expect(useMarkets.getState().status).toBe("live");
    vi.advanceTimersByTime(1);
    expect(useMarkets.getState()).toMatchObject({ prices: {}, status: "idle" });
  });
});

describe("notification planning guards", () => {
  it("bounds corrupt reminder settings", () => {
    expect(normalizeReminderDays(-5, 30)).toBe(0);
    expect(normalizeReminderDays(99, 30)).toBe(30);
    expect(normalizeReminderDays(4, 30)).toBe(4);
    expect(normalizeReminderDays("4", 30)).toBe(3);
  });

  it("deduplicates identical reminders without merging distinct content", () => {
    const a = { date: "2026-07-20", title: "Yaklaşan", body: "Kira" };
    const b = { date: "2026-07-20", title: "Yaklaşan", body: "Elektrik" };
    expect(uniqueNotifications([a, a, b])).toEqual([a, b]);
  });

  it("redacts merchant and amount unless lock-screen detail is explicitly enabled", () => {
    const detailed = { title: "Bugün son gün", body: "Elektrik (₺1.250,00) ödendi mi?" };
    const neutral = { title: "Helix hatırlatması", body: "Planını görmek için Helix'i aç." };
    expect(privateNotificationContent(false, detailed, neutral)).toEqual(neutral);
    expect(privateNotificationContent(true, detailed, neutral)).toEqual(detailed);
    expect(JSON.stringify(privateNotificationContent(false, detailed, neutral))).not.toContain("Elektrik");
    expect(JSON.stringify(privateNotificationContent(false, detailed, neutral))).not.toContain("1.250");
  });

  it("keeps the soonest reminders under the platform's 64-slot ceiling", () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({ id: index, fireAt: new Date(80 - index) }));
    const limited = boundedScheduledNotifications(rows, 60);
    expect(limited).toHaveLength(60);
    expect(limited[0]?.fireAt.getTime()).toBe(1);
    expect(limited.at(-1)?.fireAt.getTime()).toBe(60);
  });
});
