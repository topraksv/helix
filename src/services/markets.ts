/**
 * Live gold and currency prices from a public, read-only socket feed. No API
 * key is used; updates are validated and throttled into the store. The UI
 * keeps an explicit unavailable state instead of silently hiding the feed.
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { tr } from "../i18n/tr";
import { freshMarketQuote, validMarketQuote } from "../domain/market";
import { kv } from "./kv";

const FEED_URL = "wss://hrmsocketonly.haremaltin.com";
const THROTTLE_MS = 3000;
const MARKET_STALE_MS = 60_000;
const LIFECYCLE_GRACE_MS = 5000;
/** Device-local last-known public quotes (no user data), for instant display. */
const SNAPSHOT_KEY = "helix.markets.snapshot";
const SNAPSHOT_PERSIST_MS = 30_000;

/** Provider code → display label; order = display order. */
export const MARKET_SYMBOLS = [
  { code: "ALTIN", label: tr.markets.gram },
  { code: "CEYREK_YENI", label: tr.markets.quarter },
  { code: "ATA_YENI", label: tr.markets.republic },
  { code: "USDTRY", label: tr.markets.usd },
  { code: "EURTRY", label: tr.markets.eur },
] as const;

interface MarketPrice {
  code: string;
  buyTry: number;
  sellTry: number;
  direction: "up" | "down" | "";
  at: string;
  /** Local receipt time; provider text is display-only and not trusted for age. */
  receivedAt: number;
}

interface MarketsState {
  prices: Record<string, MarketPrice>;
  /** `stale` keeps showing the last-known quotes (feed silent/disconnected);
   *  `error` means there is nothing to show at all. Conversion freshness is
   *  separate: `marketSellRateTry` checks each quote's own `receivedAt`. */
  status: "idle" | "connecting" | "live" | "stale" | "error";
  lastEventAt: number | null;
}

export const useMarkets = create<MarketsState>(() => ({ prices: {}, status: "idle", lastEventAt: null }));

let socket: Socket | null = null;
let lastApplied = 0;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFeed: Record<string, FeedEntry> | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

interface FeedEntry {
  code: string;
  alis: string | number;
  satis: string | number;
  tarih: string;
  dir?: { satis_dir?: string };
}

function validEntry(entry: FeedEntry | undefined): entry is FeedEntry {
  return Boolean(entry && validMarketQuote(entry.alis, entry.satis));
}

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
 *  never convert, and `applyFeed` never re-stamps an expired quote as fresh.
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
 * Keep the last verified quotes through a short socket reconnect. Socket.io
 * reconnects automatically; clearing immediately made otherwise healthy
 * symbols disappear during momentary mobile-network changes. The existing
 * silence deadline is deliberately not extended, so genuinely stale quotes
 * are still removed after one minute.
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

/** Exported for tests (like `markMarketConnectionInterrupted`); production
 *  callers are the socket handler and the trailing-throttle timer below. */
export function applyFeed(data: Record<string, FeedEntry>, now = Date.now()) {
  if (!MARKET_SYMBOLS.some(({ code }) => validEntry(data[code]))) return;
  markStaleAfterSilence();
  if (now - lastApplied < THROTTLE_MS) {
    // Trailing edge, never a drop: the provider re-sends a symbol only when
    // its price CHANGES, so a payload discarded inside the window would leave
    // that symbol stale until its next move (minutes for slow symbols).
    // Merge deferred payloads (later entries win) and apply once the window
    // closes — the visible update rate stays throttled.
    pendingFeed = { ...pendingFeed, ...data };
    if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        const deferred = pendingFeed;
        pendingFeed = null;
        if (deferred) applyFeed(deferred);
      }, THROTTLE_MS - (now - lastApplied));
    }
    return;
  }
  lastApplied = now;
  // The provider only re-sends a symbol whose price CHANGED, so a stable quote
  // (e.g. gold overnight while USD keeps ticking) stops arriving even though it
  // is still the current price. Keep every known quote, and extend the receipt
  // time ONLY for quotes that are themselves still fresh — live continuity may
  // keep a quote alive, but it must never resurrect one that already expired
  // (a hydrated snapshot or a >60 s silence gap), or the converter would treat
  // yesterday's rate as a fresh live rate on the next tick.
  const prices: Record<string, MarketPrice> = Object.fromEntries(
    Object.entries(useMarkets.getState().prices).map(([code, price]) => [
      code,
      freshMarketQuote(price.receivedAt, now, MARKET_STALE_MS) ? { ...price, receivedAt: now } : price,
    ]),
  );
  for (const { code } of MARKET_SYMBOLS) {
    const entry = data[code];
    if (!validEntry(entry)) continue;
    const buyTry = Number(entry.alis);
    const sellTry = Number(entry.satis);
    prices[code] = {
      code,
      buyTry,
      sellTry,
      direction: entry.dir?.satis_dir === "up" ? "up" : entry.dir?.satis_dir === "down" ? "down" : "",
      at: entry.tarih,
      receivedAt: now,
    };
  }
  useMarkets.setState({
    prices,
    status: Object.keys(prices).length > 0 ? "live" : "error",
    lastEventAt: now,
  });
  if (Object.keys(prices).length > 0) persistSnapshot(prices, now);
}

/** Fresh live sell ("satış") price in TRY, or null when unavailable.
 *  Used to convert a foreign-currency amount to TRY at confirm time (we already
 *  pull USDTRY/EURTRY from this feed — no separate FX call needed). */
export function marketSellRateTry(currency: string, now = Date.now()): number | null {
  const code = currency === "USD" ? "USDTRY" : currency === "EUR" ? "EURTRY" : null;
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
  const code = currency === "USD" ? "USDTRY" : currency === "EUR" ? "EURTRY" : null;
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

/** Idempotent: first caller opens the socket; it lives for the app session. */
export function connectMarkets(): void {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (socket) return;
  useMarkets.setState({ status: "connecting" });
  void hydrateSnapshot();
  socket = io(FEED_URL, {
    transports: ["websocket"],
    reconnectionDelay: 5_000,
    reconnectionDelayMax: 60_000,
    randomizationFactor: 0.5,
    timeout: 10_000,
  });
  socket.on("price_changed", (payload: { data?: Record<string, FeedEntry> }) => {
    if (payload?.data) applyFeed(payload.data);
  });
  socket.on("connect_error", () => {
    markMarketConnectionInterrupted();
  });
  socket.on("disconnect", () => {
    markMarketConnectionInterrupted();
  });
}

/**
 * Pause after a short grace instead of closing during transient React/iOS
 * lifecycle changes. An immediate close+open can make the provider rate-limit
 * the replacement socket; a real background/sign-out still tears down soon.
 */
export function suspendMarkets(delayMs = LIFECYCLE_GRACE_MS): void {
  if (disconnectTimer) return;
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    disconnectMarkets();
  }, delayMs);
}

/**
 * Tear down the feed (close socket, drop listeners, reset state). Called on
 * sign-out so a signed-out session never keeps a live financial-data stream
 * open (battery/data), and so the next sign-in starts clean.
 */
export function disconnectMarkets(): void {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  pendingFeed = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  lastApplied = 0;
  useMarkets.setState({ prices: {}, status: "idle", lastEventAt: null });
}
