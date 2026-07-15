/** Pure validation/parsing for the external FX providers. */

import { daysInMonth, makeISODate, type ISODate } from "./dates";

export const FETCHED_FX_CURRENCIES = ["USD", "EUR", "GBP"] as const;

export interface ProviderRate {
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

/** Parse Frankfurter's TRY-base response and invert it to TRY per unit. */
export function parseFrankfurterRates(value: unknown): ProviderRateBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Frankfurter response");
  const data = value as Record<string, unknown>;
  const rateDate = typeof data.date === "string" ? calendarDate(data.date) : null;
  if (!rateDate || !data.rates || typeof data.rates !== "object" || Array.isArray(data.rates)) {
    throw new Error("Invalid Frankfurter response");
  }
  const rawRates = data.rates as Record<string, unknown>;
  const rates = FETCHED_FX_CURRENCIES.flatMap((currency) => {
    const perTry = rawRates[currency];
    if (typeof perTry !== "number" || !Number.isFinite(perTry) || perTry <= 0) return [];
    const rateTry = 1 / perTry;
    return Number.isFinite(rateTry) && rateTry > 0 && rateTry <= 1_000_000 ? [{ currency, rateTry }] : [];
  });
  if (rates.length === 0) throw new Error("Frankfurter response has no supported rates");
  return { rateDate, rates };
}
