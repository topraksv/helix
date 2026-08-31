/**
 * Live gold and currency prices, derived from public exchange order books.
 *
 * No API key, no account, no scraping: one keyless request to the exchange's
 * public market-data host returns three order books, and `domain/market.ts`
 * turns them into the six prices the card shows. See that file for why the
 * prices are computed rather than read, and what was measured against the
 * dealer feed this replaced.
 *
 * Polled rather than streamed. The dealer socket pushed on every tick and the
 * service spent most of its length taming that — a three-second throttle with a
 * trailing edge, a merge buffer for payloads it had deferred, and a rule for
 * re-stamping symbols that had stopped ticking because their price had not
 * moved. A poll has none of those problems: every response carries every
 * symbol, so there is nothing to merge, nothing to defer and nothing to
 * re-stamp. The UI keeps an explicit unavailable state instead of silently
 * hiding the feed.
 */

import { create } from "zustand";
import {
  buildHistorySeries,
  deriveMarketQuotes,
  freshMarketQuote,
  liveMarketSymbol,
  MARKET_DATA_HOST,
  MARKET_PAIRS,
  MARKET_RANGES,
  marketHistorySource,
  parseKlineCloses,
  parseMarketBooks,
  validMarketQuote,
  type DerivedQuote,
  type MarketHistoryPoint,
  type MarketRange,
} from "../domain/market";
import { kv } from "./kv";
import { MARKET_SYMBOLS } from "../domain/investment-catalog";

/**
 * How often the books are re-read.
 *
 * Six requests a minute against an endpoint whose published budget is in the
 * thousands, for 372 bytes a time. Well inside the staleness deadline below, so
 * a single dropped response never ages a quote out of the conversion contract.
 */
const POLL_MS = 10_000;
const MARKET_STALE_MS = 60_000;
const LIFECYCLE_GRACE_MS = 5000;
const FETCH_TIMEOUT_MS = 8_000;
/** Device-local last-known public quotes (no user data), for instant display. */
const SNAPSHOT_KEY = "helix.markets.snapshot";
const SNAPSHOT_PERSIST_MS = 30_000;

export const MARKET_TICKER_URL =
  `https://${MARKET_DATA_HOST}/api/v3/ticker/bookTicker?symbols=${
    encodeURIComponent(JSON.stringify(MARKET_PAIRS))
  }`;

interface MarketPrice {
  code: string;
  buyTry: number;
  sellTry: number;
  direction: "up" | "down" | "";
  at: string;
  /** Local receipt time; nothing in the response is trusted for age. */
  receivedAt: number;
  /** Restored from disk and not confirmed by the feed since. Such a quote may
   *  be DISPLAYED, but live continuity must not vouch for it. */
  fromSnapshot?: boolean;
}

interface MarketsState {
  prices: Record<string, MarketPrice>;
  /** `stale` keeps showing the last-known quotes (feed silent/unreachable);
   *  `error` means there is nothing to show at all. Conversion freshness is
   *  separate: `marketSellRateTry` checks each quote's own `receivedAt`. */
  status: "idle" | "connecting" | "live" | "stale" | "error";
  lastEventAt: number | null;
}

export const useMarkets = create<MarketsState>(() => ({ prices: {}, status: "idle", lastEventAt: null }));

let pollTimer: ReturnType<typeof setInterval> | null = null;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Ignores a response that arrives after the feed was torn down or restarted. */
let generation = 0;

/** Persist the last verified quotes so the card is never empty on reopen. */
let lastPersistAt = 0;
function persistSnapshot(prices: Record<string, MarketPrice>, lastEventAt: number): void {
  if (lastEventAt - lastPersistAt < SNAPSHOT_PERSIST_MS) return;
  lastPersistAt = lastEventAt;
  void kv.set(SNAPSHOT_KEY, JSON.stringify({ prices, lastEventAt })).catch(() => {});
}

/** Show the previous session's quotes (dated, trend cleared) while connecting.
 *  Their original `receivedAt` is kept: conversion freshness keeps following
 *  each quote's own receipt time, so anything older than the 60 s contract can
 *  never convert, and a later poll never re-stamps an expired quote as fresh.
 *  Exported for tests; the production caller is `connectMarkets`. */
export async function hydrateSnapshot(): Promise<void> {
  try {
    const raw = await kv.get(SNAPSHOT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { prices?: Record<string, MarketPrice>; lastEventAt?: number };
    const prices: Record<string, MarketPrice> = {};
    for (const { code } of MARKET_SYMBOLS) {
      const price = parsed.prices?.[code];
      if (!price || !validMarketQuote(price.buyTry, price.sellTry) || !Number.isFinite(price.receivedAt)) continue;
      prices[code] = {
        code,
        buyTry: Number(price.buyTry),
        sellTry: Number(price.sellTry),
        direction: "",
        at: typeof price.at === "string" ? price.at : "",
        receivedAt: Number(price.receivedAt),
        fromSnapshot: true,
      };
    }
    const state = useMarkets.getState();
    // Live data may have landed while reading — never overwrite it.
    if (Object.keys(prices).length === 0 || Object.keys(state.prices).length > 0) return;
    if (state.status !== "connecting" && state.status !== "error") return;
    useMarkets.setState({
      prices,
      lastEventAt: Number.isFinite(parsed.lastEventAt) ? Number(parsed.lastEventAt) : null,
    });
  } catch {
    // corrupt snapshot: live data will replace it
  }
}

function markStaleAfterSilence(): void {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    staleTimer = null;
    // Keep showing the last-known quotes with their timestamp; only the
    // conversion path (per-quote `receivedAt`) treats them as expired.
    const hasData = Object.keys(useMarkets.getState().prices).length > 0;
    useMarkets.setState({ status: hasData ? "stale" : "error" });
  }, MARKET_STALE_MS);
}

/**
 * Keep the last verified quotes through a failed poll.
 *
 * One refused request is a hiccup, not an outage, and clearing on it made
 * otherwise healthy symbols disappear during momentary mobile-network changes.
 * The existing silence deadline is deliberately not extended, so genuinely
 * stale quotes are still removed after one minute.
 */
export function markMarketConnectionInterrupted(): void {
  const { prices } = useMarkets.getState();
  if (Object.keys(prices).length === 0) {
    useMarkets.setState({ status: "error" });
    return;
  }
  useMarkets.setState({ status: "stale" });
  if (!staleTimer) markStaleAfterSilence();
}

/**
 * Apply one poll's worth of derived quotes.
 *
 * The direction arrow is computed here rather than read: an order book states a
 * price, not a trend, so the only honest source of "up" is the previous price
 * this session actually saw. A quote restored from disk is not that — it was
 * read across a gap where the app heard nothing — so the first live poll after
 * a hydrate sets a baseline and shows no arrow.
 *
 * Exported for tests; the production caller is `pollMarkets`.
 */
export function applyQuotes(quotes: readonly DerivedQuote[], now = Date.now()): void {
  const known = new Set(MARKET_SYMBOLS.map(({ code }) => code));
  const accepted = quotes.filter((quote) => known.has(quote.code) && validMarketQuote(quote.buyTry, quote.sellTry));
  if (accepted.length === 0) return;
  markStaleAfterSilence();
  const previous = useMarkets.getState().prices;
  const prices: Record<string, MarketPrice> = { ...previous };
  for (const quote of accepted) {
    const before = previous[quote.code];
    const comparable = before && !before.fromSnapshot;
    prices[quote.code] = {
      code: quote.code,
      buyTry: quote.buyTry,
      sellTry: quote.sellTry,
      direction: !comparable || before.sellTry === quote.sellTry
        ? ""
        : quote.sellTry > before.sellTry ? "up" : "down",
      at: new Date(now).toISOString(),
      receivedAt: now,
    };
  }
  useMarkets.setState({ prices, status: "live", lastEventAt: now });
  persistSnapshot(prices, now);
}

/** Read the books once. Exported for tests and for the manual retry. */
export async function pollMarkets(): Promise<void> {
  const attempt = generation;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(MARKET_TICKER_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const books = parseMarketBooks(await response.json());
    // A response that arrived after a teardown or a restart belongs to a feed
    // that no longer exists; applying it would resurrect a disconnected card.
    if (attempt !== generation) return;
    if (!books) {
      markMarketConnectionInterrupted();
      return;
    }
    applyQuotes(deriveMarketQuotes(books));
  } catch {
    if (attempt === generation) markMarketConnectionInterrupted();
  } finally {
    clearTimeout(timer);
  }
}

/** Fresh live sell ("satış") price in TRY, or null when unavailable.
 *  Used to convert a foreign-currency amount to TRY at confirm time (the same
 *  poll already carries USD/TRY and EUR/TRY — no separate FX call needed). */
export function marketSellRateTry(currency: string, now = Date.now()): number | null {
  const code = liveMarketSymbol(currency);
  if (!code) return null;
  const price = useMarkets.getState().prices[code];
  return price && freshMarketQuote(price.receivedAt, now, MARKET_STALE_MS) && Number.isFinite(price.sellTry) && price.sellTry > 0
    ? price.sellTry
    : null;
}

/** The sell rate the markets card is currently showing (live or last-known),
 *  with its receipt time, or null when the card has nothing either. The
 *  read-only converter mirrors the card so the two never disagree; ledger
 *  writes keep the strict `marketSellRateTry` freshness contract. */
export function marketLastKnownRateTry(
  currency: string,
  now = Date.now(),
): { rateTry: number; receivedAt: number; live: boolean } | null {
  const code = liveMarketSymbol(currency);
  if (!code) return null;
  const price = useMarkets.getState().prices[code];
  if (!price || !Number.isFinite(price.sellTry) || price.sellTry <= 0) return null;
  if (!Number.isFinite(price.receivedAt) || price.receivedAt > now) return null;
  return {
    rateTry: price.sellTry,
    receivedAt: price.receivedAt,
    live: freshMarketQuote(price.receivedAt, now, MARKET_STALE_MS),
  };
}

/** Idempotent: first caller starts polling; it runs for the app session. */
export function connectMarkets(): void {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (pollTimer) return;
  useMarkets.setState({ status: "connecting" });
  void hydrateSnapshot();
  void pollMarkets();
  pollTimer = setInterval(() => void pollMarkets(), POLL_MS);
}

/**
 * Read the books now, at the user's request.
 *
 * The interval already retries on its own, so the empty card was never stuck —
 * but after a long offline stretch the next attempt can be ten seconds away,
 * and the card gave a person nothing to do about it but wait without knowing
 * that.
 */
export function retryMarkets(): void {
  if (!pollTimer) {
    connectMarkets();
    return;
  }
  void pollMarkets();
}

/**
 * Pause after a short grace instead of stopping during transient React/iOS
 * lifecycle changes. A real background/sign-out still tears down soon.
 */
export function suspendMarkets(delayMs = LIFECYCLE_GRACE_MS): void {
  if (disconnectTimer) return;
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    disconnectMarkets();
  }, delayMs);
}

/**
 * Tear the feed down (stop polling, reset state). Called on sign-out so a
 * signed-out session never keeps polling financial data (battery/data), and so
 * the next sign-in starts clean.
 */
export function disconnectMarkets(): void {
  generation += 1;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  useMarkets.setState({ prices: {}, status: "idle", lastEventAt: null });
}

/** One symbol's candles, on the same keyless host the live prices come from. */
export function marketKlineUrl(symbol: string, interval: string, limit: number): string {
  return `https://${MARKET_DATA_HOST}/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
}

/**
 * The past of one tile, over one range.
 *
 * Null covers every way this can fail — an unknown code, a refused request, a
 * response that will not parse — because the screen does the same thing with
 * all of them: it says it has no history, and offers the range picker again.
 * There is nothing here worth telling apart, and a thrown error would only make
 * the caller re-flatten it.
 *
 * Not cached and not persisted: it is public, it is a screen away, and a stale
 * chart is worse than a second request.
 */
export async function fetchMarketHistory(
  code: string,
  range: MarketRange,
): Promise<MarketHistoryPoint[] | null> {
  const source = marketHistorySource(code);
  if (!source) return null;
  const spec = MARKET_RANGES[range];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const closes = await Promise.all(source.symbols.map(async (symbol) => {
      const response = await fetch(marketKlineUrl(symbol, spec.interval, spec.limit), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseKlineCloses(await response.json());
    }));
    const usable = closes.filter((series): series is Map<number, number> => series !== null);
    if (usable.length !== source.symbols.length) return null;
    const points = buildHistorySeries(usable, source.factor);
    return points.length > 0 ? points : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
