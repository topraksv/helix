/** Pure freshness/shape checks for untrusted live-market quotes. */

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
 * A wider FX currency list must not widen what counts as a LIVE rate. The
 * socket carries exactly two pairs; everything else has only a dated cache,
 * and a ledger-writing conversion that accepted a dated rate as live would
 * book yesterday's number as today's.
 *
 * Here rather than in `services/markets.ts` because the rule is a fact about
 * the feed, not about the socket, and this is where a test can hold it. It
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
 * The live feed's socket URL.
 *
 * A value rather than a literal inside the service, because two other places
 * have to agree with it: the browser suite blocks this host so a test never
 * reaches the real provider (`e2e/helpers.ts`), and the check that the two stay
 * in step used to read the service's own source with a regex. That regex
 * stopped matching the moment the file was instrumented for mutation testing,
 * which failed the whole gate in its dry run instead of reporting a score.
 */
export const MARKET_FEED_URL = "wss://hrmsocketonly.haremaltin.com";
