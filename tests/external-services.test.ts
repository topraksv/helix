import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMarketFeedSocket } from "../e2e/helpers";
import { FETCHED_FX_CURRENCIES, parseOpenExchangeRates, parseTcmbRates } from "../src/domain/fx-provider";
import { MARKET_SYMBOLS } from "../src/domain/investment-catalog";
import { normalizeLogoDomain, remoteFaviconUrl } from "../src/domain/logo-domain";
import { freshMarketQuote, validMarketQuote } from "../src/domain/market";
import { boundedScheduledNotifications, createNotificationReplacementQueue, normalizeReminderDays, privateNotificationContent, uniqueNotifications } from "../src/domain/notifications";

const kvStore = new Map<string, string>();
vi.mock("../src/services/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: string) => void kvStore.set(key, value),
    remove: async (key: string) => void kvStore.delete(key),
  },
}));

import {
  applyFeed,
  disconnectMarkets,
  hydrateSnapshot,
  markMarketConnectionInterrupted,
  marketLastKnownRateTry,
  marketSellRateTry,
  suspendMarkets,
  useMarkets,
} from "../src/services/markets";

afterEach(() => {
  disconnectMarkets();
  kvStore.clear();
  vi.useRealTimers();
});

describe("external FX provider validation", () => {
  it("keeps TCMB's declared business date and unit-adjusted selling rates", () => {
    const batch = parseTcmbRates(`<?xml version="1.0"?><Tarih_Date Tarih="14.07.2026" Date="07/14/2026">
      <Currency CurrencyCode="USD"><Unit>1</Unit><ForexSelling>40.5000</ForexSelling></Currency>
      <Currency CurrencyCode="GBP"><Unit>100</Unit><ForexSelling>5250.0000</ForexSelling></Currency>
      <Currency CurrencyCode="JPY"><Unit>100</Unit><ForexSelling>27.0000</ForexSelling></Currency>
    </Tarih_Date>`);
    // JPY is the case the `Unit` division exists for: TCMB really does quote it
    // per 100, so a parser that ignored the field would price a yen at 27 lira.
    expect(batch).toEqual({
      rateDate: "2026-07-14",
      rates: [
        { currency: "USD", rateTry: 40.5 },
        { currency: "GBP", rateTry: 52.5 },
        { currency: "JPY", rateTry: 0.27 },
      ],
    });
  });

  /**
   * Pinned so widening the picker stays a deliberate act. Every code here is
   * carried by BOTH providers, which is what keeps a phone and a browser
   * showing the same set — TCMB sends no CORS headers, so web reads only the
   * fallback.
   */
  it("offers a curated set both providers carry", () => {
    // The pure list is asserted here rather than `SUPPORTED_CURRENCIES`, which
    // lives in the service layer and pulls React Native into a node-env suite.
    // TRY leads that one by construction — it is `["TRY", ...this]`.
    expect([...FETCHED_FX_CURRENCIES].sort()).toEqual(
      ["AED", "ALL", "AUD", "AZN", "BGN", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP",
       "GEL", "JPY", "KRW", "KWD", "NOK", "RON", "RUB", "SAR", "SEK", "USD"],
    );
    expect(FETCHED_FX_CURRENCIES).not.toContain("TRY");
  });

  /**
   * A wider currency list must not widen what counts as a LIVE rate. The market
   * socket carries two pairs; everything else has only a dated cache, and a
   * ledger-writing conversion that accepted a dated rate as live would book a
   * yesterday's number as today's.
   */
  it("keeps the live market rate to the two pairs the socket actually carries", () => {
    const source = readFileSync(join(process.cwd(), "src/services/markets.ts"), "utf8");
    const mapped = [...source.matchAll(/currency === "([A-Z]{3})"/g)].map((match) => match[1]);
    expect([...new Set(mapped)].sort()).toEqual(["EUR", "USD"]);
  });

  it("rejects undated or empty TCMB payloads instead of stamping today", () => {
    expect(() => parseTcmbRates(`<Currency CurrencyCode="USD"><ForexSelling>40</ForexSelling></Currency>`)).toThrow();
    expect(() => parseTcmbRates(`<Tarih_Date Date="02/30/2026"></Tarih_Date>`)).toThrow();
  });

  it("validates the open FX feed and stores the date IT declares", () => {
    // 2026-07-25T09:00:00Z — the moment the provider published, not the moment
    // the app happened to read it.
    const published = 1_784_970_000;
    expect(parseOpenExchangeRates({ result: "success", time_last_update_unix: published, rates: { USD: 0.025, EUR: 0.02, BAD: 10 } })).toEqual({
      rateDate: "2026-07-25",
      rates: [
        { currency: "USD", rateTry: 40 },
        { currency: "EUR", rateTry: 50 },
      ],
    });
    // A provider-reported failure, a missing timestamp and an unusable rate are
    // all refusals rather than a stamped-today guess.
    expect(() => parseOpenExchangeRates({ result: "error", time_last_update_unix: published, rates: { USD: 0.025 } })).toThrow();
    expect(() => parseOpenExchangeRates({ result: "success", rates: { USD: 0.025 } })).toThrow();
    expect(() => parseOpenExchangeRates({ result: "success", time_last_update_unix: published, rates: { USD: 0 } })).toThrow();
  });
});

describe("remote logo boundary", () => {
  it("normalizes public hostnames and encodes the favicon query", () => {
    expect(normalizeLogoDomain("https://WWW.Netflix.com/account")).toBe("www.netflix.com");
    expect(remoteFaviconUrl("netflix.com")).toBe("https://www.google.com/s2/favicons?domain=netflix.com&sz=128");
  });

  it("rejects credentials, ports and local, IP or reserved targets", () => {
    for (const value of [
      "user:pass@example.com",
      "localhost",
      "127.0.0.1",
      "service.local",
      "corp.internal",
      "example.test",
      "example.invalid",
      "example.com:8080",
    ]) {
      expect(normalizeLogoDomain(value)).toBeNull();
    }
  });
});

describe("live market freshness", () => {
  it("keeps USD and EUR in the visible live-market contract", () => {
    expect(MARKET_SYMBOLS.map(({ code }) => code)).toEqual([
      "ALTIN",
      "CEYREK_YENI",
      // The provider's full coin. `TEK` and `ATA` are separate quotes, so
      // dropping either one silently removes a coin the owner tracks.
      "TEK_YENI",
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

  it("exposes the card's last-known rate with an honest live flag for the converter", () => {
    const now = 10_000;
    useMarkets.setState({
      status: "stale",
      prices: {
        USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: now },
        EURTRY: { code: "EURTRY", buyTry: 47, sellTry: 47.5, direction: "", at: "", receivedAt: now - 60_001 },
      },
      lastEventAt: now,
    });
    // Fresh quote → live; expired quote still converts but is flagged dated —
    // the converter mirrors exactly what the Summary card displays.
    expect(marketLastKnownRateTry("USD", now)).toEqual({ rateTry: 40.5, receivedAt: now, live: true });
    expect(marketLastKnownRateTry("EUR", now)).toEqual({ rateTry: 47.5, receivedAt: now - 60_001, live: false });
    // Unsupported currency or a future-stamped quote stays unusable.
    expect(marketLastKnownRateTry("GBP", now)).toBeNull();
    expect(marketLastKnownRateTry("USD", now - 1_000)).toBeNull();
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

  it("keeps showing last-known prices after silence while conversion freshness expires", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "live",
      prices: {
        USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: 1_000 },
      },
      lastEventAt: 1_000,
    });

    markMarketConnectionInterrupted();
    expect(useMarkets.getState().status).toBe("stale");
    expect(useMarkets.getState().prices.USDTRY?.sellTry).toBe(40.5);

    // After a full minute of silence the card still shows the dated quote…
    vi.advanceTimersByTime(60_000);
    expect(useMarkets.getState().status).toBe("stale");
    expect(useMarkets.getState().prices.USDTRY?.sellTry).toBe(40.5);
    expect(useMarkets.getState().lastEventAt).toBe(1_000);
    // …but the conversion path refuses the expired quote.
    expect(marketSellRateTry("USD", 1_000 + 60_001)).toBeNull();
  });

  it("never re-stamps an expired quote as fresh when another symbol ticks", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "stale",
      prices: {
        USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: 1_000 },
      },
      lastEventAt: 1_000,
    });
    const now = 1_000 + 120_000; // USDTRY expired long ago
    applyFeed({ ALTIN: { code: "ALTIN", alis: "4000", satis: "4010", tarih: "t" } }, now);
    const state = useMarkets.getState();
    expect(state.prices.ALTIN?.sellTry).toBe(4_010);
    // The old quote keeps DISPLAYING with its original receipt time…
    expect(state.prices.USDTRY?.receivedAt).toBe(1_000);
    // …and conversion still refuses it: another symbol's tick must never
    // resurrect an expired rate as live.
    expect(marketSellRateTry("USD", now)).toBeNull();
  });

  it("extends a still-fresh unchanged quote while the feed stays alive", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "live",
      prices: {
        USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: 1_000 },
      },
      lastEventAt: 1_000,
    });
    const now = 31_000; // USDTRY is 30 s old — still within the 60 s contract
    applyFeed({ ALTIN: { code: "ALTIN", alis: "4000", satis: "4010", tarih: "t" } }, now);
    expect(useMarkets.getState().prices.USDTRY?.receivedAt).toBe(now);
    expect(marketSellRateTry("USD", now)).toBe(40.5);
  });

  it("reports a hard error after silence only when there is nothing to show", () => {
    vi.useFakeTimers();
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    markMarketConnectionInterrupted();
    expect(useMarkets.getState().status).toBe("error");
  });

  it("hydrates the persisted snapshot as dated display data, never as live rates", async () => {
    kvStore.set(
      "helix.markets.snapshot",
      JSON.stringify({
        lastEventAt: 5_000,
        prices: {
          USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "up", at: "dün", receivedAt: 5_000 },
          BAD: { code: "BAD", buyTry: -1, sellTry: 0, direction: "", at: "", receivedAt: 5_000 },
        },
      }),
    );
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    await hydrateSnapshot();
    const state = useMarkets.getState();
    expect(state.prices.USDTRY?.sellTry).toBe(40.5);
    expect(state.prices.USDTRY?.direction).toBe(""); // old trend is meaningless
    expect(state.prices.BAD).toBeUndefined();
    expect(state.lastEventAt).toBe(5_000);
    // The snapshot keeps its original receipt time: conversion stays blocked.
    expect(marketSellRateTry("USD", 5_000 + 60_001)).toBeNull();
  });

  it("never promotes a hydrated snapshot to live because another symbol ticks", async () => {
    // The app was closed and reopened: the persisted USD quote is 30 s old, so
    // it is still inside the 60 s contract by its OWN receipt time. Nothing has
    // confirmed it since the restart, though — while the app was closed the feed
    // could not tell us the price moved, because the provider only re-sends a
    // symbol when it CHANGES and we were not connected to hear it. Live
    // continuity may extend a quote this session actually saw; it must never
    // vouch for one that only came off the disk.
    kvStore.set(
      "helix.markets.snapshot",
      JSON.stringify({
        lastEventAt: 5_000,
        prices: { USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "dün", receivedAt: 5_000 } },
      }),
    );
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    await hydrateSnapshot();

    applyFeed({ ALTIN: { code: "ALTIN", alis: "4000", satis: "4010", tarih: "t" } }, 35_000);
    expect(useMarkets.getState().prices.USDTRY?.receivedAt).toBe(5_000);
    // Its own 60 s window still applies, and it ends when the quote was really
    // received — not 60 s after some other symbol happened to tick.
    expect(marketSellRateTry("USD", 35_000)).toBe(40.5);
    expect(marketSellRateTry("USD", 66_000)).toBeNull();
    // …and the converter mirrors that instead of showing an unbadged rate.
    expect(marketLastKnownRateTry("USD", 66_000)?.live).toBe(false);
  });

  it("resumes live continuity for a hydrated symbol once its own quote arrives", async () => {
    kvStore.set(
      "helix.markets.snapshot",
      JSON.stringify({
        lastEventAt: 5_000,
        prices: { USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "dün", receivedAt: 5_000 } },
      }),
    );
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    await hydrateSnapshot();

    // The feed confirms USDTRY itself, so this session has now seen it live.
    applyFeed({ USDTRY: { code: "USDTRY", alis: "41", satis: "41.5", tarih: "t" } }, 10_000);
    expect(useMarkets.getState().prices.USDTRY?.receivedAt).toBe(10_000);
    // From here the ordinary unchanged-quote rule applies again.
    applyFeed({ ALTIN: { code: "ALTIN", alis: "4000", satis: "4010", tarih: "t" } }, 40_000);
    expect(useMarkets.getState().prices.USDTRY?.receivedAt).toBe(40_000);
    expect(marketSellRateTry("USD", 40_000)).toBe(41.5);
  });

  it("never lets a snapshot overwrite live quotes that already arrived", async () => {
    kvStore.set(
      "helix.markets.snapshot",
      JSON.stringify({
        lastEventAt: 5_000,
        prices: { USDTRY: { code: "USDTRY", buyTry: 39, sellTry: 39.5, direction: "", at: "", receivedAt: 5_000 } },
      }),
    );
    useMarkets.setState({
      status: "live",
      prices: { USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: 9_000 } },
      lastEventAt: 9_000,
    });
    await hydrateSnapshot();
    expect(useMarkets.getState().prices.USDTRY?.sellTry).toBe(40.5);
    expect(useMarkets.getState().lastEventAt).toBe(9_000);
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
  it("serializes overlapping queue replacements so two app-open triggers cannot duplicate reminders", async () => {
    const replace = createNotificationReplacementQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maxActive = 0;
    const first = replace(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      active -= 1;
    });
    await Promise.resolve();
    const second = replace(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("second-start");
      active -= 1;
    });
    await Promise.resolve();

    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

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

// The E2E suite cuts the live market socket so a rate-limited third party
// cannot fail an unrelated test. The matcher used to be an unanchored regex,
// which is a substring test on the whole URL rather than a host comparison.
describe("market feed isolation matches on host, not substring", () => {
  const matches = (url: string) => isMarketFeedSocket(new URL(url));

  it("blocks the real feed and its subdomains", () => {
    expect(matches("wss://hrmsocketonly.haremaltin.com")).toBe(true);
    expect(matches("wss://haremaltin.com/socket.io/?EIO=4")).toBe(true);
    expect(matches("https://api.haremaltin.com/live")).toBe(true);
  });

  it("does not match hosts that merely end in the same letters", () => {
    expect(matches("wss://notharemaltin.com")).toBe(false);
    expect(matches("wss://evil-haremaltin.com")).toBe(false);
  });

  it("does not match a foreign host that only mentions the feed", () => {
    expect(matches("wss://evil.example/?next=haremaltin.com")).toBe(false);
    expect(matches("wss://haremaltin.com.evil.example/socket")).toBe(false);
    expect(matches("https://example.test/haremaltin.com")).toBe(false);
  });

  it("keeps the blocked host in step with the feed the app actually opens", () => {
    const markets = readFileSync(join(process.cwd(), "src/services/markets.ts"), "utf8");
    const feed = markets.match(/const FEED_URL = "([^"]+)"/)?.[1];
    expect(feed, "FEED_URL literal in src/services/markets.ts").toBeDefined();
    expect(isMarketFeedSocket(new URL(feed!))).toBe(true);
  });
});
