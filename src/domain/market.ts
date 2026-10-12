/** Pure freshness/shape checks and price derivation for live market quotes. */

export function validMarketQuote(buy: unknown, sell: unknown): boolean {
  const buyTry = Number(buy);
  const sellTry = Number(sell);
  return (
    Number.isFinite(buyTry) &&
    buyTry > 0 &&
    buyTry <= 1_000_000 &&
    Number.isFinite(sellTry) &&
    sellTry > 0 &&
    sellTry <= 1_000_000
  );
}

export function freshMarketQuote(receivedAt: number, now: number, maxAgeMs: number): boolean {
  return Number.isFinite(receivedAt) && receivedAt <= now && now - receivedAt <= maxAgeMs;
}

/**
 * The market feed's symbol for a currency, or null if it does not carry one.
 *
 * A wider FX currency list must not widen what counts as a LIVE rate: the feed
 * carries exactly two pairs, and a ledger-writing conversion that accepted a
 * dated rate as live would book yesterday's number as today's. Here, not in
 * `services/markets.ts`, because it is a fact about the feed and a test can hold it.
 */
export function liveMarketSymbol(currency: string): "USDTRY" | "EURTRY" | null {
  if (currency === "USD") return "USDTRY";
  if (currency === "EUR") return "EURTRY";
  return null;
}

/**
 * Where the live prices come from. They are DERIVED from public exchange
 * order-book data (an ounce of gold in lira, and the lira itself, with the
 * legal gold content of each coin) rather than copied from a dealer's price
 * list. Gold lands above the dealer's selling price by the dealer's own
 * margin, which is why these tiles say what gold is WORTH rather than what one
 * shop will sell it for.
 *
 * `data-api.binance.vision` is the endpoint the exchange publishes for public
 * market data alone: no key, and the only candidate that sends CORS headers,
 * which the browser build needs.
 */
export const MARKET_DATA_HOST = "data-api.binance.vision";

/**
 * The three order books the six tiles are built from. PAXG is redeemable for
 * an LBMA-good-delivery ounce, so its lira book IS an ounce of gold in lira;
 * USDT is the dollar's own book. Every metal tile is a fraction of an ounce
 * and every currency tile is one of these two books.
 */
export const MARKET_PAIRS = ["PAXGTRY", "USDTTRY", "EURUSDT"] as const;

/** Grams in a troy ounce, which is the unit gold is quoted in worldwide. */
const TROY_OUNCE_GRAMS = 31.1035;

/**
 * Fine gold each Turkish coin legally contains, in grams: the mint's own
 * specification, so it can be used freely. No jeweller's making charge is
 * added: a premium is one shop's margin on one day, and freezing it into the
 * app would quote a price no one offered.
 */
export const COIN_FINE_GRAMS: Readonly<Record<string, number>> = {
  CEYREK_YENI: 1.6042,
  TEK_YENI: 6.4168,
  ATA_YENI: 6.6152,
};

/** One side of an order book: what it is bid at, and what it is offered at. */
interface BookQuote {
  bid: number;
  ask: number;
}

interface MarketBooks {
  /** One troy ounce of gold, in lira. */
  goldTry: BookQuote;
  /** One dollar, in lira. */
  usdTry: BookQuote;
  /** One euro, in dollars. */
  eurUsd: BookQuote;
}

/** A derived tile price, in the dealer vocabulary the screen already speaks. */
export interface DerivedQuote {
  code: string;
  /** What the market bids — what you get for selling. "Alış". */
  buyTry: number;
  /** What the market asks — what you pay to buy. "Satış". */
  sellTry: number;
}

/**
 * The most a raw exchange book may quote before it reads as nonsense.
 *
 * Deliberately NOT the per-quote ceiling above: a book quotes a TROY OUNCE,
 * which a currency that halves more than once in a decade would push past a
 * million, and the whole card would go dark on a price that was merely high.
 * This catches a field parsed into something absurd and leaves the room the
 * unit needs.
 */
const MAX_BOOK_TRY = 100_000_000;

/**
 * A two-sided quote worth trusting. A crossed book (ask below bid) is a broken
 * read, not a tight spread, and would print a selling price lower than the
 * buying price beside it.
 */
export function validBook(book: BookQuote): boolean {
  return (
    Number.isFinite(book.bid) && book.bid > 0 &&
    Number.isFinite(book.ask) && book.ask <= MAX_BOOK_TRY &&
    book.bid <= book.ask
  );
}

/**
 * Read the exchange's ticker response into the three books, or null. Null
 * rather than a partial result: half a card of live prices beside half a card
 * of silently stale ones is worse than a card that says it has nothing.
 */
export function parseMarketBooks(payload: unknown): MarketBooks | null {
  if (!Array.isArray(payload)) return null;
  // Each book is looked up by the symbol it must be, so no guard protects a key nothing asks for.
  const read = (symbol: string): BookQuote | null => {
    const row = payload.find((entry) => (entry as { symbol?: unknown } | null)?.symbol === symbol) as
      { bidPrice?: unknown; askPrice?: unknown } | undefined;
    if (!row) return null;
    const book = { bid: Number(row.bidPrice), ask: Number(row.askPrice) };
    return validBook(book) ? book : null;
  };
  const goldTry = read("PAXGTRY");
  const usdTry = read("USDTTRY");
  const eurUsd = read("EURUSDT");
  if (!goldTry || !usdTry || !eurUsd) return null;
  return { goldTry, usdTry, eurUsd };
}

/**
 * The margin a dealer keeps, in basis points of what it is asking.
 *
 * An exchange book's spread is a few hundredths of a percent, which would let
 * a tile claim gold sells at very nearly what it costs; a shop's "Alış" sits
 * well under its "Satış". Each figure is a published Turkish counter spread,
 * not a number taken off anyone's price list:
 *
 *   - **Gold.** A jeweller's gram spread of 1,2–1,8%; a large dealer sits at
 *     the tight end, so 1,25%. (Banks' paper-gold spread is a different product.)
 *   - **Dollar.** Free-market boards, about 0,22%.
 *   - **Euro.** About 0,42%: wider because the euro reaches lira through two
 *     legs, which is also how the ask is composed.
 *
 * Recalibrating means editing these three numbers.
 */
export const DEALER_MARGIN_BP: Readonly<Record<"metal" | "usd" | "eur", number>> = {
  metal: 125,
  usd: 22,
  eur: 42,
};

/** What a dealer pays, given what it asks: anchored to the ask, the side that was verified against a real dealer. */
export function dealerBidTry(sellTry: number, marginBp: number): number {
  return sellTry * (1 - marginBp / 10_000);
}

/**
 * Turn three order books into the six prices the card shows.
 *
 * The selling side is composed consistently rather than averaged: a euro bought
 * with lira crosses two asks, so that is how the cross rate is built. The
 * buying side is that price less the dealer margin above.
 */
export function deriveMarketQuotes(books: MarketBooks): DerivedQuote[] {
  const gramAsk = books.goldTry.ask / TROY_OUNCE_GRAMS;
  const gramBid = dealerBidTry(gramAsk, DEALER_MARGIN_BP.metal);
  const usdSell = books.usdTry.ask;
  const eurSell = books.eurUsd.ask * books.usdTry.ask;
  const quotes: DerivedQuote[] = [
    { code: "ALTIN", buyTry: gramBid, sellTry: gramAsk },
    { code: "USDTRY", buyTry: dealerBidTry(usdSell, DEALER_MARGIN_BP.usd), sellTry: usdSell },
    { code: "EURTRY", buyTry: dealerBidTry(eurSell, DEALER_MARGIN_BP.eur), sellTry: eurSell },
  ];
  for (const [code, fineGrams] of Object.entries(COIN_FINE_GRAMS)) {
    quotes.push({ code, buyTry: gramBid * fineGrams, sellTry: gramAsk * fineGrams });
  }
  return quotes.filter((quote) => validMarketQuote(quote.buyTry, quote.sellTry));
}

/** How far back a history chart looks, and how coarsely. */
export type MarketRange = "day" | "week" | "month" | "year";

/**
 * The exchange's candle size and count for each range: a comparable number of
 * points per range, and a bound so nothing asks for the thousand-candle maximum.
 */
export const MARKET_RANGES: Readonly<Record<MarketRange, { interval: string; limit: number }>> = {
  day: { interval: "1h", limit: 24 },
  week: { interval: "4h", limit: 42 },
  month: { interval: "1d", limit: 30 },
  year: { interval: "1w", limit: 53 },
};

export interface MarketHistoryPoint {
  /** Candle open time, epoch milliseconds. */
  at: number;
  valueTry: number;
}

/**
 * Which books a tile's history is built from: the live tile's arithmetic
 * expressed once for a series. `symbols` is a product, so a single-symbol
 * source is a product of one.
 */
interface MarketHistorySource {
  symbols: readonly string[];
  factor: number;
}

export function marketHistorySource(code: string): MarketHistorySource | null {
  if (code === "USDTRY") return { symbols: ["USDTTRY"], factor: 1 };
  if (code === "EURTRY") return { symbols: ["EURUSDT", "USDTTRY"], factor: 1 };
  if (code === "ALTIN") return { symbols: ["PAXGTRY"], factor: 1 / TROY_OUNCE_GRAMS };
  const fineGrams = COIN_FINE_GRAMS[code];
  return fineGrams === undefined ? null : { symbols: ["PAXGTRY"], factor: fineGrams / TROY_OUNCE_GRAMS };
}

/**
 * Candle closes, keyed by open time. A map, not a list: two series are
 * multiplied for the euro and must be paired by the moment each candle covers,
 * since position would silently shift the series when one symbol skipped a candle.
 */
export function parseKlineCloses(payload: unknown): Map<number, number> | null {
  if (!Array.isArray(payload)) return null;
  const closes = new Map<number, number>();
  for (const candle of payload) {
    if (!Array.isArray(candle)) continue;
    const at = Number(candle[0]);
    const close = Number(candle[4]);
    if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(close) || close <= 0) continue;
    closes.set(at, close);
  }
  return closes.size > 0 ? closes : null;
}

/**
 * Combine one or more close series into the points a chart draws. Only moments
 * every series covers survive: an unpaired candle would be crossed against a
 * price from a different hour.
 */
export function buildHistorySeries(
  series: readonly Map<number, number>[],
  factor: number,
): MarketHistoryPoint[] {
  const [first, ...rest] = series;
  if (!first) return [];
  const points: MarketHistoryPoint[] = [];
  for (const [at, close] of first) {
    let value = close;
    let complete = true;
    for (const other of rest) {
      const paired = other.get(at);
      if (paired === undefined) {
        complete = false;
        break;
      }
      value *= paired;
    }
    if (complete) points.push({ at, valueTry: value * factor });
  }
  return points.sort((a, b) => a.at - b.at);
}

/**
 * What the range moved from first point to last, in lira as well as in per
 * cent: on an instrument priced in the tens of thousands, 0,4% is real money.
 * Null if unmeasurable.
 */
export function historyDelta(
  points: readonly MarketHistoryPoint[],
): { absoluteTry: number; ratio: number } | null {
  // Destructured so the one-point and no-point cases are each caught by a check that can fail.
  const [first, ...rest] = points;
  const last = rest[rest.length - 1];
  if (!first || !last || first.valueTry <= 0) return null;
  return {
    absoluteTry: last.valueTry - first.valueTry,
    ratio: last.valueTry / first.valueTry - 1,
  };
}

/**
 * The lowest and highest the range ever reached: not the endpoints, which can
 * coincide on a month that moved. Seeded from the first point, so "no points"
 * is the only null.
 */
export function historyExtent(
  points: readonly MarketHistoryPoint[],
): { low: number; high: number } | null {
  const [first, ...rest] = points;
  if (!first) return null;
  // Math.min/max, not a comparison and an assignment: `<` and `<=` there are indistinguishable by any input.
  let low = first.valueTry;
  let high = first.valueTry;
  for (const point of rest) {
    low = Math.min(low, point.valueTry);
    high = Math.max(high, point.valueTry);
  }
  return { low, high };
}
