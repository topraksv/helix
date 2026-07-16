/**
 * Live gold and currency prices from a public, read-only socket feed. No API
 * key is used; updates are validated and throttled into the store. If the
 * socket cannot connect, the UI simply omits the unavailable card.
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { tr } from "../i18n/tr";
import { freshMarketQuote, validMarketQuote } from "../domain/market";

const FEED_URL = "wss://hrmsocketonly.haremaltin.com";
const THROTTLE_MS = 3000;
const MARKET_STALE_MS = 60_000;

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
  status: "idle" | "connecting" | "live" | "error";
}

export const useMarkets = create<MarketsState>(() => ({ prices: {}, status: "idle" }));

let socket: Socket | null = null;
let lastApplied = 0;
let staleTimer: ReturnType<typeof setTimeout> | null = null;

interface FeedEntry {
  code: string;
  alis: string | number;
  satis: string | number;
  tarih: string;
  dir?: { satis_dir?: string };
}

function validEntry(entry: FeedEntry | undefined): boolean {
  return Boolean(entry && validMarketQuote(entry.alis, entry.satis));
}

function markStaleAfterSilence(): void {
  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    staleTimer = null;
    useMarkets.setState({ prices: {}, status: "error" });
  }, MARKET_STALE_MS);
}

function applyFeed(data: Record<string, FeedEntry>, now = Date.now()) {
  if (!MARKET_SYMBOLS.some(({ code }) => validEntry(data[code]))) return;
  markStaleAfterSilence();
  if (now - lastApplied < THROTTLE_MS) return;
  lastApplied = now;
  // Harem only re-sends a symbol whose price CHANGED, so a stable quote (e.g.
  // gold overnight while USD keeps ticking) stops arriving even though it is
  // still the current price. Keep every known quote and refresh its receipt
  // time on any live event — a symbol must not "disappear" merely because it
  // didn't move. The global silence timer still clears everything if the whole
  // feed goes quiet for MARKET_STALE_MS (a genuinely dead connection).
  const prices: Record<string, MarketPrice> = Object.fromEntries(
    Object.entries(useMarkets.getState().prices).map(([code, price]) => [code, { ...price, receivedAt: now }]),
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
  useMarkets.setState({ prices, status: Object.keys(prices).length > 0 ? "live" : "error" });
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

/** Idempotent: first caller opens the socket; it lives for the app session. */
export function connectMarkets(): void {
  if (socket) return;
  useMarkets.setState({ status: "connecting" });
  socket = io(FEED_URL, {
    transports: ["websocket"],
    reconnectionDelayMax: 30_000,
    timeout: 10_000,
  });
  socket.on("price_changed", (payload: { data?: Record<string, FeedEntry> }) => {
    if (payload?.data) applyFeed(payload.data);
  });
  socket.on("connect_error", () => {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
    useMarkets.setState({ prices: {}, status: "error" });
  });
  // A dropped connection must flip us OUT of "live" — otherwise the last prices
  // keep showing as if they were current long after the feed stopped. socket.io
  // auto-reconnects; the next `price_changed` restores "live".
  socket.on("disconnect", () => {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
    useMarkets.setState({ prices: {}, status: "error" });
  });
}

/**
 * Tear down the feed (close socket, drop listeners, reset state). Called on
 * sign-out so a signed-out session never keeps a live financial-data stream
 * open (battery/data), and so the next sign-in starts clean.
 */
export function disconnectMarkets(): void {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  lastApplied = 0;
  useMarkets.setState({ prices: {}, status: "idle" });
}
