/**
 * Money primitives. All amounts are integer minor units (kuruş for TRY).
 * Floating point never touches stored amounts; only display formatting
 * and FX conversion round, and both round half-away-from-zero once.
 */

export type Minor = number;

/** Largest single user-entered amount: 999,999,999,999.99 major units (~1
 * trillion). Comfortably exact in integer minor units (< 2^53) so a big but
 * legitimate figure — someone tracking a business or a portfolio in the
 * billions — is accepted; the table falls back to compact "M/B" display
 * (see `formatMinorCompact`) so a large value never overflows a fixed cell. */
export const MAX_ABS_AMOUNT_MINOR = 99_999_999_999_999;
export const MAX_AMOUNT_MAJOR_DIGITS = 12;

export function isSupportedMinorAmount(value: number, allowZero = true): value is Minor {
  return (
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_ABS_AMOUNT_MINOR &&
    (allowZero || value !== 0)
  );
}

export function assertSupportedMinorAmount(value: number, allowZero = true): Minor {
  if (!isSupportedMinorAmount(value, allowZero)) throw new Error("Amount is outside the supported range");
  return value;
}

/** Convert a calculator/display major-unit value only when it remains an exact,
 * product-supported minor-unit integer. */
export function majorToMinor(value: number): Minor | null {
  if (!Number.isFinite(value)) return null;
  const minor = roundHalfAwayFromZero(value * 100);
  return isSupportedMinorAmount(minor) ? minor : null;
}

function assertMinor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Amount must be an integer of minor units, got: ${value}`);
  }
  return value;
}

export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Split a total into `count` installments; the rounding remainder goes to
 * the LAST installment so early installments are uniform (matches how TR
 * banks bill and what the user expects to see monthly).
 */
export function splitIntoInstallments(totalMinor: Minor, count: number): Minor[] {
  assertMinor(totalMinor);
  if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid installment count: ${count}`);
  const base = Math.trunc(totalMinor / count);
  const remainder = totalMinor - base * count;
  const shares = Array.from({ length: count }, () => base);
  shares[count - 1] += remainder;
  return shares;
}

const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = CURRENCY_FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    CURRENCY_FORMATTERS.set(currency, formatter);
  }
  return formatter;
}

/** ₺1.234,56 style formatting. */
export function formatMinor(amountMinor: Minor, currency = "TRY"): string {
  return formatterFor(currency).format(assertMinor(amountMinor) / 100);
}

// One-decimal grouped number formatter for the compact scale (e.g. "1,5").
// Deliberately NOT Intl's `notation:"compact"`: Hermes builds that formatter
// but may ignore the option on some devices, which would silently print the
// full number back into a cell it can't fit. Basic grouping IS supported (it
// backs formatMinor), so a hand-rolled scale + TR suffix is the safe path.
const COMPACT_NUMBER = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** Amount below which table cells show the value in full; at or above it they
 * switch to compact notation. 1.000.000 TL keeps everyday figures fully written
 * out while guaranteeing the full string still fits a narrow matrix cell (the
 * widest full value, "₺999.999,99", is ~11 chars) — so cells never need
 * truncation (`numberOfLines`) or wrapping, which the design rules forbid. */
export const COMPACT_THRESHOLD_MINOR = 100_000_000;

/**
 * Table-cell money: full `₺1.234.567,89` for everyday amounts, but a compact
 * `₺1,5 M` / `₺2,3 B` (million / billion) once the value would overflow a
 * fixed-width matrix cell. TR-only by design (the app's single locale). Use
 * `formatMinor` for hero/detail figures that have room to render in full.
 */
export function formatMinorCompact(amountMinor: Minor, currency = "TRY"): string {
  assertMinor(amountMinor);
  if (Math.abs(amountMinor) < COMPACT_THRESHOLD_MINOR) return formatMinor(amountMinor, currency);
  const major = amountMinor / 100;
  // Reached only at ≥ 1.000.000 TL, so the scale is always milyon or milyar.
  const [scaled, suffix]: [number, string] = Math.abs(major) >= 1e9 ? [major / 1e9, " B"] : [major / 1e6, " M"];
  const sign = scaled < 0 ? "-" : "";
  const symbol = currency === "TRY" ? "₺" : `${currency} `;
  return `${sign}${symbol}${COMPACT_NUMBER.format(Math.abs(scaled))}${suffix}`;
}

/**
 * Parse Turkish-formatted decimal input ("1.234,56", "1234,5", "1234") into
 * minor units. Returns null for input that is not a clean number.
 */
export function parseTRAmountToMinor(input: string): Minor | null {
  const trimmed = input.trim().replace(/[₺\s]/g, "");
  if (trimmed === "") return null;
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(body)) return null;
  const [intPart, fracPart = ""] = body.replace(/\./g, "").split(",");
  const minor = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  // Beyond safe-integer range the arithmetic is no longer exact — treat it as
  // invalid input rather than storing a corrupted amount (assertMinor would
  // otherwise throw at display time).
  if (!isSupportedMinorAmount(minor)) return null;
  return negative ? -minor : minor;
}

/**
 * Live-format a raw money input as the user types: group the integer part with
 * TR thousands separators (`15000` → `15.000`) and keep at most one decimal
 * comma with two kuruş digits (`1234,5` → `1.234,5`). Kuruş stay optional — no
 * comma is inserted unless the user types one. Values inside the supported
 * range stay parseable; over-limit input remains visible and parses as `null`
 * so the form can explain the limit instead of silently changing the amount.
 */
export function formatTRInputLive(raw: string): string {
  const negative = raw.trim().startsWith("-");
  const cleaned = raw.replace(/[^\d,]/g, "");
  const firstComma = cleaned.indexOf(",");
  let intDigits = (firstComma === -1 ? cleaned : cleaned.slice(0, firstComma)).replace(/\D/g, "");
  const frac = firstComma === -1 ? null : cleaned.slice(firstComma + 1).replace(/\D/g, "").slice(0, 2);
  intDigits = intDigits.replace(/^0+(?=\d)/, ""); // drop leading zeros, keep a lone 0
  // Keep over-limit digits visible so validation can explain the problem.
  // Silently slicing here changed a pasted value into a smaller, valid amount.
  const grouped = intDigits === "" ? "" : intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  let out = frac === null ? grouped : `${grouped === "" ? "0" : grouped},${frac}`;
  if (out === "") return negative ? "-" : "";
  return negative ? `-${out}` : out;
}

/**
 * Live-format a money input that may also be a sum expression. A single amount
 * is grouped like `formatTRInputLive`; an expression (an operator beyond a
 * leading minus, e.g. `400+500`) keeps its operators and groups each term
 * (`1250+500` → `1.250+500`) so the field stays readable while `parseAmount-
 * Expression` evaluates it.
 */
export function formatMoneyInputLive(raw: string): string {
  const compact = raw.replace(/[₺\s]/g, "");
  const hasOperator = /.[+-]/.test(compact); // an operator not at position 0
  if (!hasOperator) return formatTRInputLive(raw);
  return compact
    .split(/([+-])/)
    .map((part) => (part === "+" || part === "-" || part === "" ? part : formatTRInputLive(part)))
    .join("");
}

/**
 * Parse a spreadsheet-style sum ("300+400+500", "+300+1.250,50-100") into
 * minor units. Single plain amounts parse too. Null for anything else.
 */
export function parseAmountExpression(input: string): Minor | null {
  const compact = input.replace(/[₺\s]/g, "");
  if (compact === "") return null;
  const terms = compact.match(/[+-]?[\d.,]+/g);
  if (!terms || terms.join("") !== compact) return null;
  let total = 0;
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const minor = parseTRAmountToMinor(term.replace(/^[+-]/, ""));
    if (minor == null) return null;
    total += sign * minor;
  }
  return isSupportedMinorAmount(total) ? total : null;
}
