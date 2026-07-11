/**
 * Live market prices from Harem Altın's public socket feed (user requirement:
 * jeweler-accurate gold prices, not Google/BigPara approximations).
 * Read-only, no API key; prices update over websocket and are throttled into
 * the store. If the socket can't connect (network, origin policy) the UI
 * simply shows the card in its "unavailable" state.
 */

import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import { tr } from "../i18n/tr";

const FEED_URL = "wss://hrmsocketonly.haremaltin.com";
const THROTTLE_MS = 3000;

/** Harem code → display label; order = display order. */
export const MARKET_SYMBOLS = [
  { code: "ALTIN", label: tr.markets.gram },
  { code: "CEYREK_YENI", label: tr.markets.quarter },
  { code: "ATA_YENI", label: tr.markets.republic },
  { code: "USDTRY", label: tr.markets.usd },
  { code: "EURTRY", label: tr.markets.eur },
] as const;

export interface MarketPrice {
  code: string;
  buyTry: number;
  sellTry: number;
  direction: "up" | "down" | "";
  at: string;
}

interface MarketsState {
  prices: Record<string, MarketPrice>;
  status: "idle" | "connecting" | "live" | "error";
}

export const useMarkets = create<MarketsState>(() => ({ prices: {}, status: "idle" }));

let socket: Socket | null = null;
let lastApplied = 0;

interface FeedEntry {
  code: string;
  alis: string | number;
  satis: string | number;
  tarih: string;
  dir?: { satis_dir?: string };
}

function applyFeed(data: Record<string, FeedEntry>) {
  const now = Date.now();
  if (now - lastApplied < THROTTLE_MS) return;
  lastApplied = now;
  const prices: Record<string, MarketPrice> = { ...useMarkets.getState().prices };
  for (const { code } of MARKET_SYMBOLS) {
    const entry = data[code];
    if (!entry) continue;
    const buyTry = Number(entry.alis);
    const sellTry = Number(entry.satis);
    // A malformed feed value must never render as "NaN ₺" — keep the previous
    // price (or the card's unavailable state) instead.
    if (!Number.isFinite(buyTry) || !Number.isFinite(sellTry)) continue;
    prices[code] = {
      code,
      buyTry,
      sellTry,
      direction: entry.dir?.satis_dir === "up" ? "up" : entry.dir?.satis_dir === "down" ? "down" : "",
      at: entry.tarih,
    };
  }
  useMarkets.setState({ prices, status: "live" });
}

/** Harem sell ("satış") price in TRY for a currency, or null if not live yet.
 *  Used to convert a foreign-currency amount to TRY at confirm time (we already
 *  pull USDTRY/EURTRY from this feed — no separate FX call needed). */
export function marketSellRateTry(currency: string): number | null {
  const code = currency === "USD" ? "USDTRY" : currency === "EUR" ? "EURTRY" : null;
  if (!code) return null;
  const price = useMarkets.getState().prices[code];
  return price && Number.isFinite(price.sellTry) && price.sellTry > 0 ? price.sellTry : null;
}

/** Idempotent: first caller opens the socket; it lives for the app session. */
export function connectMarkets(): void {
  if (socket) return;
  useMarkets.setState({ status: "connecting" });
  socket = io(FEED_URL, { transports: ["websocket"], reconnectionDelayMax: 30_000 });
  socket.on("price_changed", (payload: { data?: Record<string, FeedEntry> }) => {
    if (payload?.data) applyFeed(payload.data);
  });
  socket.on("connect_error", () => {
    if (useMarkets.getState().status !== "live") useMarkets.setState({ status: "error" });
  });
  // A dropped connection must flip us OUT of "live" — otherwise the last prices
  // keep showing as if they were current long after the feed stopped. socket.io
  // auto-reconnects; the next `price_changed` restores "live".
  socket.on("disconnect", () => {
    useMarkets.setState({ status: "error" });
  });
}

/**
 * Tear down the feed (close socket, drop listeners, reset state). Called on
 * sign-out so a signed-out session never keeps a live financial-data stream
 * open (battery/data), and so the next sign-in starts clean.
 */
export function disconnectMarkets(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  lastApplied = 0;
  useMarkets.setState({ prices: {}, status: "idle" });
}
