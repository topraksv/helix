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
