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
import { runSyncSessionTask } from "../sync/engine";
import { todayISO, type ISODate } from "../domain/dates";
import { pickRate, type FxRate, type RateLookup } from "../domain/fx";
import {
  FETCHED_FX_CURRENCIES,
  isValidRateDate,
  parseFrankfurterRates,
  parseTcmbRates,
  type ProviderRateBatch,
} from "../domain/fx-provider";

export const SUPPORTED_CURRENCIES = ["TRY", ...FETCHED_FX_CURRENCIES] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RATE_RESPONSE_BYTES = 1_000_000;

async function boundedFetchText(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  try {
    if (signal?.aborted) throw new Error("Aborted");
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RATE_RESPONSE_BYTES) {
      throw new Error("FX response too large");
    }
    const text = await res.text();
    if (text.length > MAX_RATE_RESPONSE_BYTES) throw new Error("FX response too large");
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function fetchFromTcmb(signal?: AbortSignal): Promise<ProviderRateBatch> {
  return parseTcmbRates(await boundedFetchText("https://www.tcmb.gov.tr/kurlar/today.xml", signal));
}

async function fetchFromFrankfurter(signal?: AbortSignal): Promise<ProviderRateBatch> {
  const symbols = FETCHED_FX_CURRENCIES.join(",");
  const text = await boundedFetchText(`https://api.frankfurter.dev/v1/latest?base=TRY&symbols=${symbols}`, signal);
  return parseFrankfurterRates(JSON.parse(text) as unknown);
}

/** Fetch and cache the provider's latest dated rates; cache covers failures. */
export async function refreshRates(userId: string, signal?: AbortSignal): Promise<boolean> {
  let batch: ProviderRateBatch;
  // TCMB's today.xml sends no CORS headers, so on web it always fails with a
  // noisy console error — use only the CORS-enabled Frankfurter (ECB) feed
  // there. Native has no CORS restriction, so it prefers TCMB with Frankfurter
  // as a fallback.
  if (Platform.OS === "web") {
    try {
      batch = await fetchFromFrankfurter(signal);
    } catch {
      return false;
    }
  } else {
    try {
      batch = await fetchFromTcmb(signal);
    } catch {
      try {
        batch = await fetchFromFrankfurter(signal);
      } catch {
        return false;
      }
    }
  }
  if (signal?.aborted) return false;
  const sqlite = await getSqliteAsync();
  const existingRows = await sqlite.getAllAsync<{ currency: string; rate_try: string; deleted_at: string | null }>(
    `SELECT currency, rate_try, deleted_at FROM fx_rates WHERE user_id = ? AND rate_date = ?`,
    [userId, batch.rateDate],
  );
  const existing = new Map(existingRows.map((row) => [row.currency, row]));
  const writes = [] as { table: "fx_rates"; row: Record<string, unknown> }[];
  for (const r of batch.rates) {
    const current = existing.get(r.currency);
    if (current && current.deleted_at == null && Number(current.rate_try) === r.rateTry) continue;
    writes.push({
      table: "fx_rates",
      row: {
        id: await deterministicId(naturalKeys.fxRate(userId, r.currency, batch.rateDate)),
        currency: r.currency,
        rateDate: batch.rateDate,
        rateTry: String(r.rateTry),
        deletedAt: null,
      },
    });
  }
  if (signal?.aborted) return false;
  if (writes.length > 0) await writeRows(userId, writes, false);
  if (signal?.aborted) return false;
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
let rateCacheUserId: string | null = null;
let cacheRequest = 0;

const useFxCacheVersion = create<{ version: number }>(() => ({ version: 0 }));

/** Subscribe a component to rate-cache updates (re-renders when rates load). */
export function useFxRates(): number {
  return useFxCacheVersion((s) => s.version);
}

export async function loadRateCache(userId: string): Promise<void> {
  const request = ++cacheRequest;
  const sqlite = await getSqliteAsync();
  const rows = await sqlite.getAllAsync<{ currency: string; rate_date: string; rate_try: string }>(
    `SELECT currency, rate_date, rate_try FROM fx_rates
     WHERE user_id = ? AND deleted_at IS NULL ORDER BY rate_date DESC LIMIT 200`,
    [userId],
  );
  if (request !== cacheRequest) return;
  rateCacheUserId = userId;
  rateCache = rows
    .map((r) => ({ currency: r.currency, rateDate: r.rate_date, rateTry: Number(r.rate_try) }))
    .filter((r) => isValidRateDate(r.rateDate) && Number.isFinite(r.rateTry) && r.rateTry > 0 && r.rateTry <= 1_000_000);
  useFxCacheVersion.setState((s) => ({ version: s.version + 1 }));
}

/** Drop in-memory rates at account boundaries and invalidate in-flight loads. */
export function clearRateCache(): void {
  cacheRequest += 1;
  rateCacheUserId = null;
  rateCache = [];
  lastEnsureAt = 0;
  useFxCacheVersion.setState((s) => ({ version: s.version + 1 }));
}

/**
 * Screen-triggered refresh: screens whose rates are stale or missing call this
 * on focus so a rate never requires an app restart to update. Session-scoped
 * (a late response can't write across accounts) and throttled, so callers can
 * invoke it freely.
 */
let lastEnsureAt = 0;
export function ensureFreshRates(userId: string): void {
  if (Date.now() - lastEnsureAt < 60_000) return;
  lastEnsureAt = Date.now();
  void runSyncSessionTask(userId, (signal) => refreshRates(userId, signal)).catch(() => {});
}

/** Cached rate lookup for entry forms; null when this user's cache is absent. */
export function lookupRate(userId: string, currency: string, date: ISODate = todayISO()): RateLookup | null {
  if (currency === "TRY") {
    return { rate: { currency: "TRY", rateDate: date, rateTry: 1 }, isStale: false };
  }
  if (rateCacheUserId !== userId) return null;
  return pickRate(rateCache, currency, date);
}
