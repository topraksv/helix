/**
 * FX rate fetching (spec §2.5). Primary: TCMB today.xml (official TRY rates,
 * free, keyless). Fallback: Frankfurter (ECB, keyless). Rates cache into the
 * fx_rates table; lookups fall back to the last known rate with a stale flag.
 */

import { Platform } from "react-native";
import { create } from "zustand";
import { deterministicId, naturalKeys } from "../db/ids";
import { writeRows } from "../db/mutations";
import { getSqliteAsync } from "../db/client";
import { todayISO } from "../domain/dates";
import { pickRate, type FxRate, type RateLookup } from "../domain/fx";

export const SUPPORTED_CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Parse TCMB today.xml ForexSelling rates (no XML lib needed for this shape). */
export function parseTcmbXml(xml: string): { currency: string; rateTry: number }[] {
  const out: { currency: string; rateTry: number }[] = [];
  const currencyBlocks = xml.split("<Currency ").slice(1);
  for (const block of currencyBlocks) {
    const code = /CurrencyCode="([A-Z]{3})"/.exec(block)?.[1];
    const unit = Number(/<Unit>(\d+)<\/Unit>/.exec(block)?.[1] ?? "1");
    const selling = /<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block)?.[1];
    if (code && selling && Number(selling) > 0) {
      out.push({ currency: code, rateTry: Number(selling) / (unit || 1) });
    }
  }
  return out;
}

async function fetchFromTcmb(): Promise<{ currency: string; rateTry: number }[]> {
  const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml");
  if (!res.ok) throw new Error(`TCMB ${res.status}`);
  return parseTcmbXml(await res.text()).filter((r) =>
    (SUPPORTED_CURRENCIES as readonly string[]).includes(r.currency),
  );
}

async function fetchFromFrankfurter(): Promise<{ currency: string; rateTry: number }[]> {
  const symbols = SUPPORTED_CURRENCIES.filter((c) => c !== "TRY").join(",");
  const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=TRY&symbols=${symbols}`);
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  return Object.entries(data.rates).map(([currency, perTry]) => ({ currency, rateTry: 1 / perTry }));
}

/** Fetch and cache today's rates. Failing silently is fine — cache covers it. */
export async function refreshRates(userId: string): Promise<boolean> {
  let rates: { currency: string; rateTry: number }[];
  // TCMB's today.xml sends no CORS headers, so on web it always fails with a
  // noisy console error — use only the CORS-enabled Frankfurter (ECB) feed
  // there. Native has no CORS restriction, so it prefers TCMB with Frankfurter
  // as a fallback.
  if (Platform.OS === "web") {
    try {
      rates = await fetchFromFrankfurter();
    } catch {
      return false;
    }
  } else {
    try {
      rates = await fetchFromTcmb();
    } catch {
      try {
        rates = await fetchFromFrankfurter();
      } catch {
        return false;
      }
    }
  }
  const rateDate = todayISO();
  const writes = [] as { table: "fx_rates"; row: Record<string, unknown> }[];
  for (const r of rates) {
    writes.push({
      table: "fx_rates",
      row: {
        id: await deterministicId(naturalKeys.fxRate(userId, r.currency, rateDate)),
        currency: r.currency,
        rateDate,
        rateTry: String(r.rateTry),
        deletedAt: null,
      },
    });
  }
  if (writes.length > 0) await writeRows(userId, writes, false);
  await loadRateCache(userId);
  return true;
}

/**
 * Rates are read during render (entry forms, subscription totals), so lookups
 * stay synchronous against an in-memory snapshot loaded at boot and refreshed
 * after every fetch. A zustand version counter makes the cache REACTIVE: a
 * background refresh (which lands after a screen has already mounted) bumps the
 * version so subscribers re-render and re-read the now-populated rates. Without
 * this the converter/entry preview stayed on "rate unavailable" forever after a
 * cold start, because the module cache updated silently.
 */
let rateCache: FxRate[] = [];

export const useFxCacheVersion = create<{ version: number }>(() => ({ version: 0 }));

/** Subscribe a component to rate-cache updates (re-renders when rates load). */
export function useFxRates(): number {
  return useFxCacheVersion((s) => s.version);
}

export async function loadRateCache(userId: string): Promise<void> {
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ currency: string; rate_date: string; rate_try: string }>(
    `SELECT currency, rate_date, rate_try FROM fx_rates
     WHERE user_id = ? AND deleted_at IS NULL ORDER BY rate_date DESC LIMIT 200`,
    [userId] as never[],
  );
  rateCache = rows.map((r) => ({ currency: r.currency, rateDate: r.rate_date, rateTry: Number(r.rate_try) }));
  useFxCacheVersion.setState((s) => ({ version: s.version + 1 }));
}

/** Cached rate lookup for entry forms; null when nothing cached yet. */
export function lookupRate(_userId: string, currency: string): RateLookup | null {
  if (currency === "TRY") {
    return { rate: { currency: "TRY", rateDate: todayISO(), rateTry: 1 }, isStale: false };
  }
  return pickRate(rateCache, currency, todayISO());
}
