import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENCY_INFO, FETCHED_FX_CURRENCIES, currencyLabel, parseOpenExchangeRates, parseTcmbRates } from "../src/domain/fx-provider";
import { MARKET_SYMBOLS } from "../src/domain/investment-catalog";
import { normalizeLogoDomain, remoteFaviconUrl } from "../src/domain/logo-domain";
import {
  buildHistorySeries,
  COIN_FINE_GRAMS,
  deriveMarketQuotes,
  freshMarketQuote,
  historyChange,
  liveMarketSymbol,
  MARKET_DATA_HOST,
  MARKET_PAIRS,
  MARKET_RANGES,
  marketHistorySource,
  parseKlineCloses,
  parseMarketBooks,
  validBook,
  validMarketQuote,
} from "../src/domain/market";
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
  applyQuotes,
  connectMarkets,
  disconnectMarkets,
  fetchMarketHistory,
  hydrateSnapshot,
  markMarketConnectionInterrupted,
  marketLastKnownRateTry,
  marketSellRateTry,
  marketKlineUrl,
  MARKET_TICKER_URL,
  pollMarkets,
  retryMarkets,
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
    // Behaviour, not a grep over the service's own source. The old assertion
    // matched `currency === "USD"` in `markets.ts`, which stops matching the
    // moment that file is instrumented for mutation testing — so the rule had
    // no proof during precisely the run meant to prove it, and the whole
    // mutation gate failed in its dry run rather than reporting a score.
    expect(liveMarketSymbol("USD")).toBe("USDTRY");
    expect(liveMarketSymbol("EUR")).toBe("EURTRY");
    for (const currency of FETCHED_FX_CURRENCIES) {
      if (currency === "USD" || currency === "EUR") continue;
      expect(liveMarketSymbol(currency), `${currency} has no live pair`).toBeNull();
    }
    expect(liveMarketSymbol("TRY")).toBeNull();
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

/**
 * A currency is named the same way everywhere, which is the rule the
 * transaction form broke: flags on its picker chips, "₺ TRY" hard-coded on the
 * row above them.
 */
describe("how a currency names itself", () => {
  it("puts the flag in front of the code for every currency it offers", () => {
    for (const code of [...FETCHED_FX_CURRENCIES, "TRY"] as const) {
      expect(currencyLabel(code), code).toBe(`${CURRENCY_INFO[code].flag} ${code}`);
    }
  });

  it("falls back to the bare code rather than to a blank", () => {
    // A code the table has not met still has to name itself: a leading space
    // or an empty chip would be worse than no flag.
    expect(currencyLabel("XDR")).toBe("XDR");
    expect(currencyLabel("")).toBe("");
  });
});

describe("remote logo boundary", () => {
  it("normalizes public hostnames and encodes the favicon query", () => {
    expect(normalizeLogoDomain("https://WWW.Netflix.com/account")).toBe("www.netflix.com");
    expect(remoteFaviconUrl("netflix.com")).toBe("https://www.google.com/s2/favicons?domain=netflix.com&sz=256");
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
});

/**
 * The prices are DERIVED now, not read off a dealer's socket, so the
 * arithmetic is the contract. Everything below is what stands between three
 * public order books and the six numbers on the Summary card.
 */
describe("deriving market prices from order books", () => {
  const books = {
    goldTry: { bid: 311_035, ask: 311_346.035 },
    usdTry: { bid: 40, ask: 40.5 },
    eurUsd: { bid: 1.1, ask: 1.2 },
  };
  const bySymbol = (payload: unknown) => parseMarketBooks(payload);

  it("refuses a book whose ask sits below its bid", () => {
    // A crossed book is not a tight spread, it is a broken read — and it would
    // print a selling price below the buying price next to it.
    expect(validBook({ bid: 40, ask: 41 })).toBe(true);
    expect(validBook({ bid: 40, ask: 40 })).toBe(true);
    expect(validBook({ bid: 41, ask: 40 })).toBe(false);
    expect(validBook({ bid: 0, ask: 41 })).toBe(false);
    expect(validBook({ bid: Number.NaN, ask: 41 })).toBe(false);
    expect(validBook({ bid: 40, ask: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("leaves an ounce the room its own unit needs", () => {
    // A book quotes a TROY OUNCE. Gold stood at 213_855 lira an ounce when this
    // was written, so a ceiling sized for a GRAM would have gone dark on a
    // price that was merely high — a currency that has halved more than once in
    // a decade reaches a million.
    expect(validBook({ bid: 213_855, ask: 213_900 })).toBe(true);
    expect(validBook({ bid: 5_000_000, ask: 5_000_100 })).toBe(true);
    expect(validBook({ bid: 100_000_000, ask: 100_000_000 })).toBe(true);
    expect(validBook({ bid: 100_000_000, ask: 100_000_001 })).toBe(false);
  });

  it("still refuses a gram, a coin or a rate that has left the plausible", () => {
    // The per-quote ceiling is the narrow one, and it is what the card shows.
    const absurd = { ...books, goldTry: { bid: 40_000_000, ask: 40_000_100 } };
    const codes = deriveMarketQuotes(absurd).map((quote) => quote.code);
    expect(codes).not.toContain("ALTIN");
    expect(codes).toContain("USDTRY");
  });

  it("reads the three books it needs out of the exchange response", () => {
    const parsed = bySymbol([
      { symbol: "USDTTRY", bidPrice: "40", askPrice: "40.5" },
      { symbol: "EURUSDT", bidPrice: "1.1", askPrice: "1.2" },
      { symbol: "PAXGTRY", bidPrice: "311035", askPrice: "311346.035" },
    ]);
    expect(parsed).toEqual(books);
  });

  it("returns nothing at all when any one of them is missing", () => {
    // Half a card of live prices beside half a card of silently stale ones is
    // worse than a card that says it has nothing.
    const gold = { symbol: "PAXGTRY", bidPrice: "311035", askPrice: "311346.035" };
    const usd = { symbol: "USDTTRY", bidPrice: "40", askPrice: "40.5" };
    const eur = { symbol: "EURUSDT", bidPrice: "1.1", askPrice: "1.2" };
    expect(bySymbol([usd, eur])).toBeNull();
    expect(bySymbol([gold, eur])).toBeNull();
    expect(bySymbol([gold, usd])).toBeNull();
    expect(bySymbol([gold, usd, eur])).not.toBeNull();
  });

  it("refuses anything that is not a list of quoted symbols", () => {
    expect(bySymbol(null)).toBeNull();
    expect(bySymbol({ PAXGTRY: { bidPrice: "1", askPrice: "2" } })).toBeNull();
    expect(bySymbol("[]")).toBeNull();
    expect(bySymbol([])).toBeNull();
  });

  it("skips entries it cannot read instead of failing on them", () => {
    const good = [
      { symbol: "PAXGTRY", bidPrice: "311035", askPrice: "311346.035" },
      { symbol: "USDTTRY", bidPrice: "40", askPrice: "40.5" },
      { symbol: "EURUSDT", bidPrice: "1.1", askPrice: "1.2" },
    ];
    // A null entry is the one that would throw if it reached a property read,
    // and a response is a stranger's JSON: it can hold anything.
    expect(bySymbol(["nonsense", null, undefined, 7, { bidPrice: "1", askPrice: "2" }, ...good])).toEqual(books);
    // A crossed or unreadable book for a symbol we need is the same as no book.
    expect(bySymbol([{ symbol: "PAXGTRY", bidPrice: "9", askPrice: "1" }, good[1], good[2]])).toBeNull();
  });

  it("turns one troy ounce in lira into one gram in lira", () => {
    const quotes = deriveMarketQuotes(books);
    const gram = quotes.find((quote) => quote.code === "ALTIN");
    expect(gram?.buyTry).toBeCloseTo(10_000, 6);
    expect(gram?.sellTry).toBeCloseTo(10_010, 6);
  });

  it("prices each coin at the fine gold it legally contains", () => {
    const quotes = deriveMarketQuotes(books);
    const at = (code: string) => quotes.find((quote) => quote.code === code);
    expect(at("CEYREK_YENI")?.sellTry).toBeCloseTo(10_010 * COIN_FINE_GRAMS.CEYREK_YENI!, 6);
    expect(at("TEK_YENI")?.sellTry).toBeCloseTo(10_010 * COIN_FINE_GRAMS.TEK_YENI!, 6);
    expect(at("ATA_YENI")?.sellTry).toBeCloseTo(10_010 * COIN_FINE_GRAMS.ATA_YENI!, 6);
    expect(at("CEYREK_YENI")?.buyTry).toBeCloseTo(10_000 * COIN_FINE_GRAMS.CEYREK_YENI!, 6);
    // Smaller coin, less gold: the ordering is the specification, not a detail.
    expect(COIN_FINE_GRAMS.CEYREK_YENI!).toBeLessThan(COIN_FINE_GRAMS.TEK_YENI!);
    expect(COIN_FINE_GRAMS.TEK_YENI!).toBeLessThan(COIN_FINE_GRAMS.ATA_YENI!);
  });

  it("crosses the euro through both legs on the same side", () => {
    // Buying euros with lira crosses two asks; selling crosses two bids.
    // Averaging the pair first would quote a rate nobody could trade at.
    const quotes = deriveMarketQuotes(books);
    const eur = quotes.find((quote) => quote.code === "EURTRY");
    expect(eur?.buyTry).toBeCloseTo(1.1 * 40, 9);
    expect(eur?.sellTry).toBeCloseTo(1.2 * 40.5, 9);
    const usd = quotes.find((quote) => quote.code === "USDTRY");
    expect(usd).toEqual({ code: "USDTRY", buyTry: 40, sellTry: 40.5 });
  });

  it("produces exactly the symbols the card is built to show", () => {
    // The catalog decides which tiles exist and this decides which have prices.
    // They are two lists in two files, so they are checked against each other.
    const derived = deriveMarketQuotes(books).map((quote) => quote.code).sort();
    expect(derived).toEqual(MARKET_SYMBOLS.map(({ code }) => code).sort());
  });

  it("drops a derived price that lands outside what a quote may be", () => {
    // An ounce priced in the tens of millions makes a gram that still passes,
    // but a coin made of it does not. Whatever survives the arithmetic is
    // checked again, because the arithmetic is what can carry a bad book past
    // the first check.
    const absurd = { ...books, goldTry: { bid: 4_000_000, ask: 5_000_000 } };
    const codes = deriveMarketQuotes(absurd).map((quote) => quote.code);
    expect(codes).not.toContain("TEK_YENI");
    expect(codes).toContain("USDTRY");
  });
});

describe("the past of one instrument", () => {
  it("builds every tile's history from the same books as its price", () => {
    expect(marketHistorySource("USDTRY")).toEqual({ symbols: ["USDTTRY"], factor: 1 });
    // The euro has no lira book of its own, so it is one book times the other.
    expect(marketHistorySource("EURTRY")).toEqual({ symbols: ["EURUSDT", "USDTTRY"], factor: 1 });
    expect(marketHistorySource("ALTIN")).toEqual({ symbols: ["PAXGTRY"], factor: 1 / 31.1035 });
    expect(marketHistorySource("ATA_YENI")).toEqual({
      symbols: ["PAXGTRY"],
      factor: COIN_FINE_GRAMS.ATA_YENI! / 31.1035,
    });
    expect(marketHistorySource("BITCOIN")).toBeNull();
  });

  it("covers every tile the card can open", () => {
    // A tile that routes to a chart with no source behind it is a dead end.
    for (const { code } of MARKET_SYMBOLS) expect(marketHistorySource(code)).not.toBeNull();
  });

  it("offers four ranges, each bounded by its own request", () => {
    const ranges = Object.values(MARKET_RANGES);
    expect(Object.keys(MARKET_RANGES)).toEqual(["day", "week", "month", "year"]);
    // The count IS the request bound: nothing here can ask for the exchange's
    // thousand-candle maximum by accident.
    for (const range of ranges) expect(range.limit).toBeLessThanOrEqual(60);
    // The candle sizes themselves, because they are what the request asks for:
    // an empty interval is a rejected request, and a wrong one is a chart that
    // silently covers a different span than its own label claims.
    expect(ranges.map((range) => range.interval)).toEqual(["1h", "4h", "1d", "1w"]);
  });

  it("reads candle closes and refuses anything that is not one", () => {
    const closes = parseKlineCloses([
      [1_000, "1", "2", "0.5", "1.5"],
      [2_000, "1", "2", "0.5", "1.75"],
    ]);
    expect(closes && [...closes.entries()]).toEqual([[1_000, 1.5], [2_000, 1.75]]);
    expect(parseKlineCloses("nope")).toBeNull();
    expect(parseKlineCloses(null)).toBeNull();
    expect(parseKlineCloses({ candles: [] })).toBeNull();
    expect(parseKlineCloses([])).toBeNull();
    // A string is indexable, so without the shape check "12345" would read as a
    // candle opening at 1 and closing at 5.
    expect(parseKlineCloses(["12345"])).toBeNull();
    // Every unusable candle drops out; a response of nothing but rubbish is
    // no history at all rather than an empty chart claiming to be one.
    expect(parseKlineCloses(["x", [null, "1", "2", "3", "4"], [1_000, "1", "2", "3", "0"]])).toBeNull();
    const partial = parseKlineCloses([[0, "1", "2", "3", "4"], [3_000, "1", "2", "3", "9"]]);
    expect(partial && [...partial.keys()]).toEqual([3_000]);
  });

  it("scales one series and crosses two, keeping only paired moments", () => {
    const ounce = new Map([[2_000, 62.207], [1_000, 31.1035]]);
    const single = buildHistorySeries([ounce], 1 / 31.1035);
    // Sorted by time whatever order the exchange sent them in.
    expect(single.map((point) => point.at)).toEqual([1_000, 2_000]);
    expect(single[0]!.valueTry).toBeCloseTo(1, 9);
    expect(single[1]!.valueTry).toBeCloseTo(2, 9);

    const eurUsd = new Map([[1_000, 1.1], [2_000, 1.2]]);
    const usdTry = new Map([[1_000, 40], [3_000, 41]]);
    const crossed = buildHistorySeries([eurUsd, usdTry], 1);
    // 2_000 has no dollar candle to cross against, so it is dropped rather than
    // paired with a price from another hour — a number that was never true.
    expect(crossed).toEqual([{ at: 1_000, valueTry: 44 }]);
    expect(buildHistorySeries([], 1)).toEqual([]);
  });

  it("measures the move from the first point to the last", () => {
    expect(historyChange([{ at: 1, valueTry: 100 }, { at: 2, valueTry: 110 }])).toBeCloseTo(0.1, 9);
    expect(historyChange([{ at: 1, valueTry: 100 }, { at: 2, valueTry: 90 }])).toBeCloseTo(-0.1, 9);
    // One point is a price, not a change; a zero start has no percentage.
    expect(historyChange([{ at: 1, valueTry: 100 }])).toBeNull();
    expect(historyChange([])).toBeNull();
    expect(historyChange([{ at: 1, valueTry: 0 }, { at: 2, valueTry: 90 }])).toBeNull();
  });

  it("asks the exchange for one symbol's candles over the chosen range", () => {
    const url = new URL(marketKlineUrl("PAXGTRY", "1d", 30));
    expect(url.hostname).toBe(MARKET_DATA_HOST);
    expect(url.pathname).toBe("/api/v3/klines");
    expect(url.searchParams.get("symbol")).toBe("PAXGTRY");
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.get("limit")).toBe("30");
  });
});

describe("reading the books over the network", () => {
  const bookTicker = [
    { symbol: "PAXGTRY", bidPrice: "311035", askPrice: "311346.035" },
    { symbol: "USDTTRY", bidPrice: "40", askPrice: "40.5" },
    { symbol: "EURUSDT", bidPrice: "1.1", askPrice: "1.2" },
  ];
  const respond = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response);

  const withFetch = (impl: ReturnType<typeof respond>) => {
    vi.stubGlobal("fetch", impl);
    return impl;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns one response into the whole card", async () => {
    withFetch(respond(bookTicker));
    useMarkets.setState({ prices: {}, status: "connecting", lastEventAt: null });
    await pollMarkets();
    const state = useMarkets.getState();
    expect(state.status).toBe("live");
    expect(Object.keys(state.prices).sort()).toEqual(MARKET_SYMBOLS.map(({ code }) => code).sort());
    expect(state.prices.ALTIN?.sellTry).toBeCloseTo(10_010, 6);
  });

  it("treats a refusal, a broken payload and a dead network the same way", async () => {
    // All three mean the same thing to the card: the last known prices stay up
    // and stop being called live. Telling them apart would be a distinction
    // with nothing behind it.
    for (const failing of [respond(bookTicker, false), respond([{ symbol: "PAXGTRY", bidPrice: "1", askPrice: "2" }]), vi.fn(async () => { throw new Error("offline"); })]) {
      useMarkets.setState({
        status: "live",
        prices: { ALTIN: { code: "ALTIN", buyTry: 1, sellTry: 2, direction: "", at: "", receivedAt: 1 } },
        lastEventAt: 1,
      });
      withFetch(failing as ReturnType<typeof respond>);
      await pollMarkets();
      expect(useMarkets.getState().status).toBe("stale");
      expect(useMarkets.getState().prices.ALTIN?.sellTry).toBe(2);
    }
  });

  it("throws away a response that outlived the feed it was asked for", async () => {
    // Sign out mid-request and the reply still arrives. Applying it would put
    // prices back on a card the app has already torn down.
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => { release = resolve; });
    withFetch(vi.fn(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => bookTicker } as unknown as Response;
    }) as ReturnType<typeof respond>);
    useMarkets.setState({ prices: {}, status: "connecting", lastEventAt: null });
    const inFlight = pollMarkets();
    disconnectMarkets();
    release(null);
    await inFlight;
    expect(useMarkets.getState()).toMatchObject({ prices: {}, status: "idle" });
  });

  it("starts one poll loop and keeps reading on the interval", async () => {
    vi.useFakeTimers();
    const fetcher = withFetch(respond(bookTicker));
    connectMarkets();
    connectMarkets(); // idempotent: a second caller must not start a second loop
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    disconnectMarkets();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads again on request without starting a second loop", async () => {
    vi.useFakeTimers();
    const fetcher = withFetch(respond(bookTicker));
    // Nothing running yet: the request has to start the loop.
    retryMarkets();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Already running: read now, but do not stack a second interval on top.
    retryMarkets();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("fetches a chart from one book, or from two crossed together", async () => {
    const candles = (closes: [number, string][]) => closes.map(([at, close]) => [at, "0", "0", "0", close]);
    const gold = withFetch(respond(candles([[1_000, "31103.5"], [2_000, "62207"]])));
    const gram = await fetchMarketHistory("ALTIN", "month");
    expect(gold).toHaveBeenCalledTimes(1);
    expect(gram?.map((point) => Math.round(point.valueTry))).toEqual([1_000, 2_000]);

    // The euro needs both books, so it makes both requests and pairs them.
    const both = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => candles(url.includes("EURUSDT") ? [[1_000, "1.1"]] : [[1_000, "40"]]),
    }) as unknown as Response);
    vi.stubGlobal("fetch", both);
    expect(await fetchMarketHistory("EURTRY", "day")).toEqual([{ at: 1_000, valueTry: 44 }]);
    expect(both).toHaveBeenCalledTimes(2);
  });

  it("has no chart to offer rather than an empty one", async () => {
    withFetch(respond([]));
    // An instrument with no book behind it never reaches the network at all.
    expect(await fetchMarketHistory("BITCOIN", "day")).toBeNull();
    // A response with nothing usable in it is no history, not a flat line.
    expect(await fetchMarketHistory("ALTIN", "day")).toBeNull();
    withFetch(respond([], false));
    expect(await fetchMarketHistory("ALTIN", "week")).toBeNull();
  });
});

describe("live market store", () => {
  const quotes = (sellTry: number) => [{ code: "ALTIN", buyTry: sellTry - 10, sellTry }];

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
  });

  /**
   * An order book states a price, not a trend. The only honest source of "up"
   * is the previous price this session actually saw, so the arrow is computed
   * here rather than believed.
   */
  it("reads the arrow off its own previous price, and shows none for the first", () => {
    applyQuotes(quotes(4_010), 2_000_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("");
    applyQuotes(quotes(4_020), 2_010_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("up");
    applyQuotes(quotes(4_015), 2_020_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("down");
    applyQuotes(quotes(4_015), 2_030_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("");
  });

  it("ignores symbols the card does not show and quotes it cannot use", () => {
    useMarkets.setState({ prices: {}, status: "connecting", lastEventAt: null });
    applyQuotes([{ code: "DOGECOIN", buyTry: 1, sellTry: 2 }], 3_000_000);
    expect(useMarkets.getState().status).toBe("connecting");
    applyQuotes([{ code: "ALTIN", buyTry: 0, sellTry: 0 }], 3_005_000);
    expect(useMarkets.getState().status).toBe("connecting");
    applyQuotes(quotes(4_010), 3_010_000);
    expect(useMarkets.getState().status).toBe("live");
    expect(useMarkets.getState().prices.DOGECOIN).toBeUndefined();
  });

  /**
   * A conversion writes into the ledger, so it may only use a rate the app can
   * still vouch for: the right symbol, a positive price, and freshness.
   */
  it("refuses a live rate that is missing, non-positive or stale", () => {
    const at = 4_000_000;
    applyQuotes([{ code: "USDTRY", buyTry: 40, sellTry: 41 }], at);
    expect(marketSellRateTry("USD", at)).toBe(41);
    // A pair the feed does not carry has no live rate whatever is in the store.
    expect(marketSellRateTry("GBP", at)).toBeNull();
    // Past the staleness window the same quote stops counting as live.
    expect(marketSellRateTry("USD", at + 10 * 60_000)).toBeNull();
  });

  it("keeps showing last-known prices after a failed poll while conversion freshness expires", () => {
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

  it("reports a hard error after silence only when there is nothing to show", () => {
    vi.useFakeTimers();
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    markMarketConnectionInterrupted();
    expect(useMarkets.getState().status).toBe("error");
  });

  // A poll reports the same interruption every ten seconds for as long as the
  // network is away, where the socket it replaced reported one per
  // disconnection. Both states have to settle, or the markets card re-renders
  // six times a minute to say exactly what it already said.
  it("stops notifying once an empty-feed interruption has been reported", () => {
    vi.useFakeTimers();
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    const seen: string[] = [];
    const stop = useMarkets.subscribe((state) => seen.push(state.status));

    markMarketConnectionInterrupted();
    markMarketConnectionInterrupted();
    markMarketConnectionInterrupted();
    stop();

    expect(seen).toEqual(["error"]);
    expect(useMarkets.getState().status).toBe("error");
  });

  it("stops notifying once a stale-feed interruption has been reported", () => {
    vi.useFakeTimers();
    useMarkets.setState({
      status: "live",
      prices: { USDTRY: { code: "USDTRY", buyTry: 40, sellTry: 40.5, direction: "", at: "", receivedAt: 1_000 } },
      lastEventAt: 1_000,
    });
    const seen: string[] = [];
    const stop = useMarkets.subscribe((state) => seen.push(state.status));

    markMarketConnectionInterrupted();
    markMarketConnectionInterrupted();
    markMarketConnectionInterrupted();
    stop();

    expect(seen).toEqual(["stale"]);
    expect(useMarkets.getState().status).toBe("stale");
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

  it("shows no arrow on the first live price after a restart", async () => {
    // A hydrated quote is not a price this session watched move; it came off
    // the disk across a gap where the app was not looking. Comparing against it
    // would draw a trend out of two unrelated moments.
    kvStore.set(
      "helix.markets.snapshot",
      JSON.stringify({
        lastEventAt: 5_000,
        prices: { ALTIN: { code: "ALTIN", buyTry: 3_000, sellTry: 3_010, direction: "", at: "dün", receivedAt: 5_000 } },
      }),
    );
    useMarkets.setState({ status: "connecting", prices: {}, lastEventAt: null });
    await hydrateSnapshot();

    applyQuotes(quotes(4_010), 35_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("");
    applyQuotes(quotes(4_020), 45_000);
    expect(useMarkets.getState().prices.ALTIN?.direction).toBe("up");
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

  it("keeps one polling lifecycle alive through a transient app-state change", () => {
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

  it("asks the exchange only for the pairs the card is built from", () => {
    // The URL itself, not a regex over the service's source: grepping an
    // instrumented file finds nothing, and an assertion like that once took the
    // whole mutation gate down in its dry run.
    const url = new URL(MARKET_TICKER_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(MARKET_DATA_HOST);
    expect(JSON.parse(url.searchParams.get("symbols") ?? "null")).toEqual([...MARKET_PAIRS]);
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
