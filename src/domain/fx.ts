/**
 * FX logic (spec §2.5). Every record stores its original currency plus a
 * TRY snapshot taken at entry time; historical reports never re-convert.
 * Rate lookup prefers the exact date, else falls back to the most recent
 * earlier rate and flags staleness (TCMB publishes business days only).
 */

import type { ISODate } from "./dates";
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
