/**
 * Money primitives. All amounts are integer minor units (kuruş for TRY).
 * Floating point never touches stored amounts; only display formatting
 * and FX conversion round, and both round half-away-from-zero once.
 */

export type Minor = number;

export function assertMinor(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Amount must be an integer of minor units, got: ${value}`);
  }
  return value;
}

export function minorFromMajor(major: number): Minor {
  return roundHalfAwayFromZero(major * 100);
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
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
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
  return Number.isSafeInteger(total) ? total : null;
}
