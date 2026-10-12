/** Pure validation/parsing for the external FX providers. */

import { isISODate, yearOf, type ISODate } from "./dates";

/**
 * What the app offers. Web can only read the fallback provider (TCMB sends no
 * CORS headers), so every currency listed must be available from it. The list
 * is curated: a picker of every code is not a feature.
 */
export const FETCHED_FX_CURRENCIES = [
  "USD", "EUR", "GBP", "CHF", "JPY", "AUD", "CAD",
  "SEK", "NOK", "DKK", "CNY", "KRW", "RON",
  "RUB", "AED", "SAR", "AZN", "KWD", "ALL", "BGN", "GEL",
] as const;

interface ProviderRate {
  currency: (typeof FETCHED_FX_CURRENCIES)[number];
  rateTry: number;
}

export interface ProviderRateBatch {
  rateDate: ISODate;
  rates: ProviderRate[];
}

function calendarDate(value: string): ISODate | null {
  return isISODate(value) && yearOf(value) >= 2000 && yearOf(value) <= 2200 ? value : null;
}

export function isValidRateDate(value: string): value is ISODate {
  return calendarDate(value) != null;
}

function tcmbDate(xml: string): ISODate | null {
  const us = /<Tarih_Date\b[^>]*\bDate="(\d{2})\/(\d{2})\/(\d{4})"/i.exec(xml);
  if (us) return calendarDate(`${us[3]}-${us[1]}-${us[2]}`);
  const tr = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/i.exec(xml);
  return tr ? calendarDate(`${tr[3]}-${tr[2]}-${tr[1]}`) : null;
}

/** Parse TCMB ForexSelling values and preserve the date declared by TCMB. */
export function parseTcmbRates(xml: string): ProviderRateBatch {
  const rateDate = tcmbDate(xml);
  if (!rateDate) throw new Error("TCMB response has no valid rate date");
  const rates: ProviderRate[] = [];
  for (const block of xml.split("<Currency ").slice(1)) {
    const currency = /CurrencyCode="([A-Z]{3})"/.exec(block)?.[1];
    if (!FETCHED_FX_CURRENCIES.includes(currency as ProviderRate["currency"])) continue;
    // Read whatever the element CONTAINS and judge it; never supply a unit the
    // response did not state. A digits-only pattern does not match
    // `<Unit>1.5</Unit>` at all, so a default of 1 took over and the rate was
    // scaled by the wrong unit instead of being refused — and the same default
    // covered a block with no `<Unit>` at all. Neither is harmless: TCMB quotes
    // JPY, KRW and RUB per hundred and all three are fetched here, so assuming
    // one is a hundredfold error on exactly the currencies whose unit matters.
    // `Number(undefined)` is `NaN`, so both readings fall to the guard below.
    const unit = Number(/<Unit>([^<]*)<\/Unit>/.exec(block)?.[1]);
    const selling = Number(/<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block)?.[1]);
    const rateTry = selling / unit;
    if (!Number.isInteger(unit) || unit <= 0 || !Number.isFinite(rateTry) || rateTry <= 0 || rateTry > 1_000_000) continue;
    rates.push({ currency: currency as ProviderRate["currency"], rateTry });
  }
  if (rates.length === 0) throw new Error("TCMB response has no supported rates");
  return { rateDate, rates };
}

/**
 * Parse exchangerate-api's open endpoint and invert its per-TRY rates to TRY
 * per unit. The stated publication moment is what gets stored: a rate is never
 * stamped with the day it was read.
 */
export function parseOpenExchangeRates(value: unknown): ProviderRateBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid FX response");
  const data = value as Record<string, unknown>;
  if (data.result !== "success") throw new Error("FX provider reported a failure");
  const published = typeof data.time_last_update_unix === "number" ? data.time_last_update_unix : null;
  const rateDate = published != null && Number.isFinite(published) && published > 0
    ? calendarDate(new Date(published * 1000).toISOString().slice(0, 10))
    : null;
  if (!rateDate || !data.rates || typeof data.rates !== "object" || Array.isArray(data.rates)) {
    throw new Error("Invalid FX response");
  }
  const rawRates = data.rates as Record<string, unknown>;
  const rates = FETCHED_FX_CURRENCIES.flatMap((currency) => {
    const perTry = rawRates[currency];
    if (typeof perTry !== "number" || !Number.isFinite(perTry) || perTry <= 0) return [];
    const rateTry = 1 / perTry;
    return Number.isFinite(rateTry) && rateTry > 0 && rateTry <= 1_000_000 ? [{ currency, rateTry }] : [];
  });
  if (rates.length === 0) throw new Error("FX response has no supported rates");
  return { rateDate, rates };
}

/**
 * Flag and name per currency. The flag is a colour emoji the platform draws, so
 * it escapes the palette; that is accepted because it is illustrative, not
 * structural (the name and code carry the meaning), and Windows, which ships no
 * flag font, degrades it to the two letters ("TR"). A mark that carried
 * meaning on its own would not get this exemption.
 */
export const CURRENCY_INFO: Record<(typeof FETCHED_FX_CURRENCIES)[number] | "TRY", { flag: string; name: string }> = {
  TRY: { flag: "🇹🇷", name: "Türk Lirası" },
  USD: { flag: "🇺🇸", name: "Amerikan Doları" },
  EUR: { flag: "🇪🇺", name: "Euro" },
  GBP: { flag: "🇬🇧", name: "İngiliz Sterlini" },
  CHF: { flag: "🇨🇭", name: "İsviçre Frangı" },
  JPY: { flag: "🇯🇵", name: "Japon Yeni" },
  AUD: { flag: "🇦🇺", name: "Avustralya Doları" },
  CAD: { flag: "🇨🇦", name: "Kanada Doları" },
  SEK: { flag: "🇸🇪", name: "İsveç Kronu" },
  NOK: { flag: "🇳🇴", name: "Norveç Kronu" },
  DKK: { flag: "🇩🇰", name: "Danimarka Kronu" },
  CNY: { flag: "🇨🇳", name: "Çin Yuanı" },
  KRW: { flag: "🇰🇷", name: "Güney Kore Wonu" },
  RON: { flag: "🇷🇴", name: "Rumen Leyi" },
  RUB: { flag: "🇷🇺", name: "Rus Rublesi" },
  AED: { flag: "🇦🇪", name: "BAE Dirhemi" },
  SAR: { flag: "🇸🇦", name: "Suudi Riyali" },
  AZN: { flag: "🇦🇿", name: "Azerbaycan Manatı" },
  KWD: { flag: "🇰🇼", name: "Kuveyt Dinarı" },
  ALL: { flag: "🇦🇱", name: "Arnavut Leki" },
  BGN: { flag: "🇧🇬", name: "Bulgar Levası" },
  GEL: { flag: "🇬🇪", name: "Gürcistan Larisi" },
};

/** How a currency is named wherever it is shown: flag then code. An unknown code falls back to itself. */
export function currencyLabel(code: string): string {
  const flag = CURRENCY_INFO[code as keyof typeof CURRENCY_INFO]?.flag;
  return flag ? `${flag} ${code}` : code;
}

/** Runtime currency boundary shared by forms, restore and sync. */
export function isSupportedCurrency(value: unknown): value is keyof typeof CURRENCY_INFO {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_INFO, value);
}
