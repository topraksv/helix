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
 * A wider FX currency list must not widen what counts as a LIVE rate. The feed
 * carries exactly two pairs; everything else has only a dated cache, and a
 * ledger-writing conversion that accepted a dated rate as live would book
 * yesterday's number as today's.
 *
 * Here rather than in `services/markets.ts` because the rule is a fact about
 * the feed, not about the transport, and this is where a test can hold it. It
 * used to be a ternary written twice in the service and asserted by grepping
 * that service's own source — which stopped matching the moment the file was
 * instrumented for mutation testing, so the rule silently had no proof during
 * exactly the run that was meant to prove it.
 */
export function liveMarketSymbol(currency: string): "USDTRY" | "EURTRY" | null {
  if (currency === "USD") return "USDTRY";
  if (currency === "EUR") return "EURTRY";
  return null;
}

/**
 * Where the live prices come from, and why they are computed rather than read.
 *
 * They used to be read straight off a Turkish dealer's own socket: the dealer's
 * quotes, taken without a licence to take them. What replaces it is public
 * exchange order-book data, from which the same prices are DERIVED — one troy
 * ounce of gold in lira, and the lira itself — using arithmetic and the legal
 * gold content of each coin. Nobody's price list is being copied; two public
 * order books are being read and the rest is division.
 *
 * Measured against the dealer feed it replaces, on 2026-08-31 within the same
 * minute: the dollar landed 0.017% away, and gram gold 0.4–0.6% above the
 * dealer's selling price. That gap is the dealer's own margin, and it is the
 * honest reason these tiles now say what gold is WORTH rather than what one
 * shop will sell it for.
 *
 * `data-api.binance.vision` rather than the main API host: it is the endpoint
 * the exchange publishes for public market data alone, it needs no key, and it
 * is the only candidate that sends CORS headers — the browser build has no
 * other way in. (`api.btcturk.com` carries the same pairs and agreed to within
 * 0.01%, but sends no CORS headers and has no euro pair, so it would only ever
 * work on half the platforms.)
 */
export const MARKET_DATA_HOST = "data-api.binance.vision";

/**
 * The three order books the six tiles are built from.
 *
 * PAXG is a token redeemable for an LBMA-good-delivery ounce, so its lira book
 * IS an ounce of gold in lira; it traded within 0.023% of the international
 * spot price when this was measured. USDT is the dollar's own book against the
 * lira. Nothing else is needed: every metal tile is a fraction of an ounce and
 * every currency tile is one of these two books.
 */
export const MARKET_PAIRS = ["PAXGTRY", "USDTTRY", "EURUSDT"] as const;

/** Grams in a troy ounce, which is the unit gold is quoted in worldwide. */
const TROY_OUNCE_GRAMS = 31.1035;

/**
 * Fine gold each Turkish coin legally contains, in grams.
 *
 * These are the mint's own specifications, not a shop's price list, which is
 * exactly why they can be used freely. What a jeweller charges on top is their
 * making charge: measured against the dealer feed on 2026-08-31 it was 1.72%
 * on the quarter, 1.42% on the full and 0.04% on the Ata — smaller coins carry
 * more labour per gram. None of it is added here. A premium is one shop's
 * margin on one day, and freezing it into the app would be quoting a price no
 * one offered.
 */
export const COIN_FINE_GRAMS: Readonly<Record<string, number>> = {
  CEYREK_YENI: 1.6042,
  TEK_YENI: 6.4168,
  ATA_YENI: 6.6152,
};

/** One side of an order book: what it is bid at, and what it is offered at. */
export interface BookQuote {
  bid: number;
  ask: number;
}

export interface MarketBooks {
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
 * Deliberately NOT the per-quote ceiling below it. That one bounds what the
 * card shows — a gram, a coin, a lira — where a million is generous. A book
 * here quotes a TROY OUNCE, which stood at 213_855 lira when this was written:
 * against a million that is 4.7x of headroom, and a currency that has halved
 * more than once in a decade would reach it. The whole card would then go dark
 * on a price that was simply high. This bound catches what the check is for —
 * a field parsed into something absurd — and leaves the room the unit needs.
 */
const MAX_BOOK_TRY = 100_000_000;

/**
 * A two-sided quote worth trusting.
 *
 * The ask must not sit below the bid. A crossed book is not a tighter spread,
 * it is a broken read — a partial response, a symbol that stopped trading, a
 * field that arrived as a string of the wrong shape — and passing it on would
 * print a selling price lower than the buying price beside it.
 */
export function validBook(book: BookQuote): boolean {
  return (
    Number.isFinite(book.bid) && book.bid > 0 &&
    Number.isFinite(book.ask) && book.ask <= MAX_BOOK_TRY &&
    book.bid <= book.ask
  );
}

/**
 * Read the exchange's ticker response into the three books, or null.
 *
 * Null rather than a partial result: every tile is derived from these, so a
 * response missing one of them cannot produce a coherent card, and half a card
 * of live prices beside half a card of silently stale ones is worse than a card
 * that says it has nothing.
 */
export function parseMarketBooks(payload: unknown): MarketBooks | null {
  if (!Array.isArray(payload)) return null;
  // Each book is LOOKED UP by the symbol it must be, rather than the response
  // being indexed and then searched. The two read the same on the page and are
  // not the same contract: indexing first means every guard on the way in is
  // guarding a key nothing will ever ask for, which is a check that cannot be
  // wrong. Asking for the three symbols by name leaves nothing inert.
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
 * Turn three order books into the six prices the card shows.
 *
 * The two sides are composed consistently rather than averaged: a euro bought
 * with lira crosses two asks, and one sold crosses two bids, so that is how the
 * cross rate is built. Averaging the pair first would produce a rate nobody
 * could actually trade at, narrower than either leg allows.
 */
export function deriveMarketQuotes(books: MarketBooks): DerivedQuote[] {
  const gramBid = books.goldTry.bid / TROY_OUNCE_GRAMS;
  const gramAsk = books.goldTry.ask / TROY_OUNCE_GRAMS;
  const quotes: DerivedQuote[] = [
    { code: "ALTIN", buyTry: gramBid, sellTry: gramAsk },
    { code: "USDTRY", buyTry: books.usdTry.bid, sellTry: books.usdTry.ask },
    {
      code: "EURTRY",
      buyTry: books.eurUsd.bid * books.usdTry.bid,
      sellTry: books.eurUsd.ask * books.usdTry.ask,
    },
  ];
  for (const [code, fineGrams] of Object.entries(COIN_FINE_GRAMS)) {
    quotes.push({ code, buyTry: gramBid * fineGrams, sellTry: gramAsk * fineGrams });
  }
  return quotes.filter((quote) => validMarketQuote(quote.buyTry, quote.sellTry));
}

/** How far back a history chart looks, and how coarsely. */
export type MarketRange = "day" | "week" | "month" | "year";

/**
 * The exchange's candle size and count for each range.
 *
 * Chosen so every range draws a comparable number of points — enough to show a
 * shape, few enough that one finger-width of chart is still one candle. The
 * counts are also the request's own bound: nothing here can ask for the
 * thousand-candle maximum by accident.
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
 * Which books a tile's history is built from, and what turns them into it.
 *
 * The same arithmetic as the live tile, expressed once for a series instead of
 * once for a price: an ounce book scaled to a gram or to a coin's fine gold,
 * the dollar book as it stands, and the euro as one book multiplied by the
 * other. `symbols` is a product, so a single-symbol source is just a product of
 * one.
 */
export interface MarketHistorySource {
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
 * Candle closes, keyed by open time.
 *
 * A map rather than a list because two series have to be multiplied together
 * for the euro, and the only safe way to pair them is by the moment each candle
 * covers. Position would pair them by accident: one symbol having traded a
 * candle the other did not would silently shift the whole series.
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
 * Combine one or more close series into the points a chart draws.
 *
 * Only moments every series covers survive: an unpaired candle would have to
 * be crossed against a price from a different hour, which is a number that was
 * never true.
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

/** Move from the first point to the last, as a fraction. Null if unmeasurable. */
/**
 * What the range moved, in lira as well as in per cent.
 *
 * A percentage answers "how much" and not "how much money", and on an
 * instrument priced in the tens of thousands those are different questions:
 * 0,4% of a Cumhuriyet altını is not a rounding error.
 *
 * The guard lives HERE and only here. It was written twice — once for the
 * ratio and once for the pair — and the second copy could not fail, because
 * the first had already established both endpoints: mutation left it standing
 * with nothing able to kill it, which is what an unreachable branch looks like
 * from the outside.
 */
export function historyDelta(
  points: readonly MarketHistoryPoint[],
): { absoluteTry: number; ratio: number } | null {
  // Destructured rather than indexed from both ends: `rest` being empty is
  // exactly "there is only one point", so the one-point case and the no-point
  // case are each caught by a check that can genuinely fail, instead of by a
  // comparison that is only there to satisfy the type checker.
  const [first, ...rest] = points;
  const last = rest[rest.length - 1];
  if (!first || !last || first.valueTry <= 0) return null;
  return {
    absoluteTry: last.valueTry - first.valueTry,
    ratio: last.valueTry / first.valueTry - 1,
  };
}

/** The ratio on its own, for callers that only want the percentage. */
export function historyChange(points: readonly MarketHistoryPoint[]): number | null {
  return historyDelta(points)?.ratio ?? null;
}

/**
 * The lowest and highest the range ever reached.
 *
 * Not the endpoints: a month that opened and closed at the same price still
 * has a floor and a ceiling, and those are what say whether today's figure is
 * high. Seeded from the first point rather than from infinities, so "there are
 * no points" is the one thing that returns null and the sentinels never have
 * to be checked for afterwards.
 */
export function historyExtent(
  points: readonly MarketHistoryPoint[],
): { low: number; high: number } | null {
  const [first, ...rest] = points;
  if (!first) return null;
  // `Math.min`/`Math.max` rather than a comparison and an assignment. The
  // hand-written form carried two branches whose `<` and `<=` cannot be told
  // apart by any input — assigning on equality changes nothing — so mutation
  // left them standing for ever. These say the same thing with no operator to
  // get wrong, and swapping the two functions IS observable.
  let low = first.valueTry;
  let high = first.valueTry;
  for (const point of rest) {
    low = Math.min(low, point.valueTry);
    high = Math.max(high, point.valueTry);
  }
  return { low, high };
}
