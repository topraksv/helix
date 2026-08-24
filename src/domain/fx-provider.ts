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
    // Read whatever the element CONTAINS and judge it; never supply a unit the
    // response did not state. A digits-only pattern does not match
    // `<Unit>1.5</Unit>` at all, so a default of 1 took over and the rate was
    // scaled by the wrong unit instead of being refused — and the same default
    // covered a block with no `<Unit>` at all. Neither is harmless: TCMB quotes
    // JPY, KRW and RUB per hundred and all three are fetched here, so assuming
    // one is a hundredfold error on exactly the currencies whose unit matters.
    // `Number(undefined)` is `NaN`, so both readings fall to the guard below,
    // which the old pattern had made unreachable by guaranteeing what it checked.
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
 * image, no request, no licence. XDR and other supranational codes would have
 * no flag, which is one more reason the offered set stays curated.
 *
 * It does NOT inherit the row's text colour, whatever this comment used to
 * say: an emoji flag is a colour glyph the platform draws, and it is the one
 * place in this app where a mark escapes the palette. It is kept anyway, and
 * the reasoning is worth stating so the next reader does not re-open it:
 *
 *   - it is illustrative, not structural. The currency's NAME and CODE carry
 *     the meaning on every row, so nothing is lost when the flag is absent —
 *     which is the test `category-icon.tsx` applies to an emoji and the one
 *     the category marks failed.
 *   - Windows ships no flag emoji font, so Chrome and Edge there render the
 *     regional-indicator pair as its two letters ("TR", "US"). That is a
 *     degraded picture rather than a wrong or missing one, beside a name that
 *     already says the same thing.
 *
 * A mark that carried meaning on its own would not get this exemption.
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

/**
 * How a currency is named wherever it is shown: flag then code.
 *
 * One helper rather than five call sites building the same template, because
 * the rule is "a currency is a place, and a place has a flag" and it has to
 * hold everywhere or it reads as an accident. The transaction form was the
 * proof: its picker chips carried flags while the collapsed row above them
 * said "₺ TRY" — a currency symbol, hard-coded to lira, on a form that might
 * be in dollars. An unknown code falls back to the bare code rather than to a
 * blank, so a currency the table has not met still names itself.
 */
export function currencyLabel(code: string): string {
  const flag = CURRENCY_INFO[code as keyof typeof CURRENCY_INFO]?.flag;
  return flag ? `${flag} ${code}` : code;
}

/** Runtime currency boundary shared by forms, restore and sync. */
export function isSupportedCurrency(value: unknown): value is keyof typeof CURRENCY_INFO {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_INFO, value);
}
