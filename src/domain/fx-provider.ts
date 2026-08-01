/** Pure validation/parsing for the external FX providers. */

import { daysInMonth, makeISODate, type ISODate } from "./dates";

/**
 * What the app offers, checked against both providers' live lists on
 * 2026-07-26 rather than assumed.
 *
 * This used to be the INTERSECTION of TCMB and Frankfurter, because TCMB sends
 * no CORS headers — web can only read the fallback, so a currency the fallback
 * lacked would work on a phone and stay permanently empty in a browser. The
 * fallback now covers every TCMB code and 130 more, so the constraint is gone
 * and the regionally useful ones (AED, SAR, RUB, AZN, KWD) are available on
 * both platforms. The list stays curated rather than complete: a picker with
 * 166 entries is not a feature.
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return makeISODate(year, month, day);
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
    const unit = Number(/<Unit>(\d+)<\/Unit>/.exec(block)?.[1] ?? "1");
    const selling = Number(/<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block)?.[1]);
    const rateTry = selling / unit;
    if (!Number.isInteger(unit) || unit <= 0 || !Number.isFinite(rateTry) || rateTry <= 0 || rateTry > 1_000_000) continue;
    rates.push({ currency: currency as ProviderRate["currency"], rateTry });
  }
  if (rates.length === 0) throw new Error("TCMB response has no supported rates");
  return { rateDate, rates };
}

/**
 * Parse exchangerate-api's open endpoint and invert it to TRY per unit.
 *
 * Its `rates` are quoted per one TRY, the same direction Frankfurter used, so
 * the inversion is unchanged. What differs is the date: this feed states the
 * moment it was published as an RFC 2822 string, and that stated moment is what
 * gets stored — a rate is never stamped with "today" just because today is when
 * it was read.
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
 * Flag and name per currency, so the list reads as places rather than as codes.
 *
 * The flag is an emoji built from the country's regional-indicator pair — no
 * image, no request, no licence, and it inherits the row's text colour. XDR and
 * other supranational codes would have no flag, which is one more reason the
 * offered set stays curated.
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

/** Runtime currency boundary shared by forms, restore and sync. */
export function isSupportedCurrency(value: unknown): value is keyof typeof CURRENCY_INFO {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_INFO, value);
}
