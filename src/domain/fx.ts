/**
 * FX logic (spec §2.4). Every record stores its original currency plus a
 * TRY snapshot taken at entry time; historical reports never re-convert.
 * Rate lookup prefers the exact date, else falls back to the most recent
 * earlier rate and flags staleness (TCMB publishes business days only).
 */

import { todayISO, type ISODate } from "./dates";
import { roundHalfAwayFromZero, type Minor } from "./money";

export interface FxRate {
  currency: string;
  rateDate: ISODate;
  /** TRY per 1 unit of `currency`. */
  rateTry: number;
}

export interface RateLookup {
  rate: FxRate;
  /** True when the rate is older than the requested date (weekend/holiday/offline). */
  isStale: boolean;
}

export function convertToTryMinor(amountMinor: Minor, rateTry: number): Minor {
  if (rateTry <= 0 || !Number.isFinite(rateTry)) throw new Error(`Invalid FX rate: ${rateTry}`);
  const converted = roundHalfAwayFromZero(amountMinor * rateTry);
  if (!Number.isSafeInteger(converted)) throw new Error("Converted amount exceeds safe minor-unit range");
  return converted;
}

/** Latest rate on/before `date` for the currency; null when none cached. */
export function pickRate(rates: FxRate[], currency: string, date: ISODate): RateLookup | null {
  let best: FxRate | null = null;
  for (const rate of rates) {
    if (rate.currency !== currency || rate.rateDate > date) continue;
    if (!best || rate.rateDate > best.rateDate) best = rate;
  }
  if (!best) return null;
  return { rate: best, isStale: best.rateDate < date };
}

/** Why a converter rate is not the live one, for the receipt shown under the result. */
export type ConverterBadge =
  | { kind: "market"; receivedAt: number }
  | { kind: "fx"; rateDate: string }
  | null;

/**
 * The rate the read-only converter uses, mirroring the Summary card: a live
 * quote converts silently; the card's last-known quote converts with its
 * receipt time shown; the dated FX cache is only used when it is strictly
 * newer than that quote. Ledger-writing conversions elsewhere keep the strict
 * 60 s live contract.
 */
export function converterRate(
  market: { rateTry: number; receivedAt: number; live: boolean } | null,
  cached: RateLookup | null,
): { rateTry: number; badge: ConverterBadge } | null {
  if (market?.live) return { rateTry: market.rateTry, badge: null };
  if (market && (cached == null || todayISO(new Date(market.receivedAt)) >= cached.rate.rateDate)) {
    return { rateTry: market.rateTry, badge: { kind: "market", receivedAt: market.receivedAt } };
  }
  if (cached == null) return null;
  return {
    rateTry: cached.rate.rateTry,
    badge: cached.isStale ? { kind: "fx", rateDate: cached.rate.rateDate } : null,
  };
}

/** `amountMinor` of one currency in another, cross-rated through TRY; null when the result leaves the safe minor-unit range. */
export function crossConvertMinor(amountMinor: Minor, fromRateTry: number, toRateTry: number): Minor | null {
  const converted = roundHalfAwayFromZero((amountMinor * fromRateTry) / toRateTry);
  return Number.isSafeInteger(converted) ? converted : null;
}
