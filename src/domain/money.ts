/**
 * Money primitives. All amounts are integer minor units (kuruş for TRY).
 * Floating point never touches stored amounts; only display formatting
 * and FX conversion round, and both round half-away-from-zero once.
 */

export type Minor = number;

/** Largest single user-entered amount: 999,999,999,999.99 major units (~1
 * trillion). Comfortably exact in integer minor units (< 2^53) so a big but
 * legitimate figure — someone tracking a business or a portfolio in the
 * billions — is accepted; the table falls back to compact "Mn/Mr/Tr" display
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
  const lastIndex = count - 1;
  shares[lastIndex] = (shares[lastIndex] ?? base) + remainder;
  return shares;
}

/**
 * The two figures a screen needs to describe a split truthfully: the uniform
 * early instalment, and the last one that carries the remainder.
 *
 * Two screens previewed a card plan by dividing the total themselves with
 * `Math.trunc`, which is a DIFFERENT answer from the schedule this module
 * writes whenever the total does not divide evenly — "3 taksit x ₺333,33"
 * described a ₺999,99 purchase for a ₺1.000,00 one. The preview and the
 * schedule now come from the same split, so they cannot disagree.
 *
 * `null` for a count no plan could have, so a screen previewing a half-typed
 * field cannot throw during render.
 */
export function installmentShareRange(totalMinor: Minor, count: number): { first: Minor; last: Minor } | null {
  if (!Number.isInteger(count) || count < 1 || !Number.isSafeInteger(totalMinor)) return null;
  const shares = splitIntoInstallments(totalMinor, count);
  return { first: shares[0]!, last: shares[shares.length - 1]! };
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
  // `-0` is a real JS value and Intl prints it as "-₺0,00". Callers negate a
  // sum for display (an expense row shows `-expenseMinor`), so an empty month
  // produced a minus sign in front of nothing. Zero has no sign to show.
  const value = assertMinor(amountMinor) / 100;
  return formatterFor(currency).format(value === 0 ? 0 : value);
}

// Compact scale values use the product's `1.345 Mn` vocabulary rather than
// locale decimal commas. The currency itself remains Turkish-formatted when
// the value is below the compact threshold.
const COMPACT_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
export type CompactMoneyScale = "Mn" | "Mr" | "Tr";
const NO_BREAK_AFTER_SIGN = "\u2060";

function glueNegativeSign(value: string): string {
  return value.startsWith("-") ? `-${NO_BREAK_AFTER_SIGN}${value.slice(1)}` : value;
}

function roundsToNextCompactScale(value: number): boolean {
  return Math.round(value * 1_000) >= 1_000_000;
}

/** Select the one compact unit for an amount, including rounding promotion. */
export function compactMoneyScale(amountMinor: Minor): CompactMoneyScale {
  assertMinor(amountMinor);
  const major = Math.abs(amountMinor) / 100;
  // No separate trilyon branch: promotion already covers it. A value at or
  // above a trilyon is at least 1000 when read in milyar, and 1000 milyar
  // rounds to the promotion threshold exactly — so the branch below returns
  // "Tr" for every input a `major >= 1e12` shortcut could have caught, and
  // could never disagree with it. Mutation found this by leaving five mutants
  // on those two lines that no test could kill, which is the same statement:
  // the guards decided nothing.
  if (major >= 1e9) return roundsToNextCompactScale(major / 1e9) ? "Tr" : "Mr";
  if (major >= 1e6) return roundsToNextCompactScale(major / 1e6) ? "Mr" : "Mn";
  return "Mn";
}

/** Amount below which the shared UI display stays fully written; at or above
 * it the same display policy switches to a compact scale. 1.000.000 TL keeps
 * everyday figures fully written out while guaranteeing the full string still
 * fits a narrow matrix cell (the widest full value, "₺999.999,99", is ~11
 * chars) — so cells never need truncation (`numberOfLines`) or wrapping. */
export const COMPACT_MONEY_THRESHOLD_MINOR = 100_000_000;

export function usesCompactMoneyScale(amountMinor: Minor): boolean {
  assertMinor(amountMinor);
  return Math.abs(amountMinor) >= COMPACT_MONEY_THRESHOLD_MINOR;
}

/**
 * Shared UI money: full `₺1.234.567,89` for everyday amounts, but a compact
 * `₺1.5 Mn` / `₺2.3 Mr` (million / billion) once the value reaches the large
 * number threshold. TR-only by design (the app's single locale). `formatMinor`
 * remains available as the exact domain formatter; UI text uses this shared
 * compact policy so a new surface cannot silently choose a different unit.
 */
export function formatMinorCompact(amountMinor: Minor, currency = "TRY"): string {
  assertMinor(amountMinor);
  if (!usesCompactMoneyScale(amountMinor)) return glueNegativeSign(formatMinor(amountMinor, currency));
  return formatMinorCompactAtScale(amountMinor, compactMoneyScale(amountMinor), currency);
}

/**
 * Compact money at a caller-selected scale.
 *
 * A chart axis is one ruler: if its largest value is in millions, a smaller
 * tick must still read ₺0.5 Mn rather than switching back to a long exact
 * amount in the middle of that ruler. The scale decision belongs to the chart;
 * this function remains the one place that formats the number and suffix.
 */
export function formatMinorCompactAtScale(
  amountMinor: Minor,
  scale: CompactMoneyScale,
  currency = "TRY",
): string {
  assertMinor(amountMinor);
  const major = amountMinor / 100;
  const [scaled, suffix]: [number, string] = scale === "Tr"
    ? [major / 1e12, " Tr"]
    : scale === "Mr"
      ? [major / 1e9, " Mr"]
      : [major / 1e6, " Mn"];
  const sign = scaled < 0 ? `-${NO_BREAK_AFTER_SIGN}` : "";
  const symbol = currency === "TRY" ? "₺" : currency + " ";
  return sign + symbol + COMPACT_NUMBER.format(Math.abs(scaled)) + suffix;
}

/** Why Turkish-formatted input did not become an amount. Not exported: the
 *  reasons reach callers through `ReadAmount`, which is the value they hold. */
type AmountRejection = "empty" | "malformed" | "over-limit";

/**
 * A typed amount, or the reason it is not one.
 *
 * `null` used to carry both refusals at once and the amount field could only
 * guess between them, so it named the louder: an unfinished expression — a
 * lone comma, or "1+" halfway through typing "1+2" — was refused with "this
 * amount exceeds the supported limit", a limit the input was nowhere near.
 * The reason is derived in the same pass as the value so a message and a
 * number cannot disagree; `parseTRAmountToMinor` and
 * `parseAmountExpression` stay as the thin answers for callers that only
 * want the number.
 */
export type ReadAmount = { ok: true; minor: Minor } | { ok: false; reason: AmountRejection };

/** Read one Turkish-formatted amount, saying why when it is not one. */
export function readTRAmount(input: string): ReadAmount {
  // No `.trim()` before this: `\s` already covers every code point `trim`
  // removes, so the call was doing nothing that the strip does not.
  const trimmed = input.replace(/[₺\s]/g, "");
  if (trimmed === "") return { ok: false, reason: "empty" };
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(body)) {
    return { ok: false, reason: "malformed" };
  }
  const [intPart, fracPart = ""] = body.replace(/\./g, "").split(",");
  const minor = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  // Beyond safe-integer range the arithmetic is no longer exact — treat it as
  // invalid input rather than storing a corrupted amount (assertMinor would
  // otherwise throw at display time). Too large to store is a different thing
  // to say than unreadable, which is why it is a distinct reason and not null.
  if (!isSupportedMinorAmount(minor)) return { ok: false, reason: "over-limit" };
  return { ok: true, minor: negative ? -minor : minor };
}

/**
 * Parse Turkish-formatted decimal input ("1.234,56", "1234,5", "1234") into
 * minor units. Returns null for input that is not a clean number.
 */
export function parseTRAmountToMinor(input: string): Minor | null {
  const read = readTRAmount(input);
  return read.ok ? read.minor : null;
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
  // The sign is read once the currency symbol is out of the way. "₺-5" does
  // not START with a minus, so the sign was neither seen here nor kept by the
  // strip below — a pasted refund came back as a charge of the same size, and
  // `parseTRAmountToMinor` had already got it right, so the two disagreed about
  // the same string. Only the symbol and spaces are removed: an operator is
  // still not a sign, and `formatMoneyInputLive` owns that case.
  const negative = raw.replace(/[₺\s]/g, "").startsWith("-");
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

/** Exact, grouped value used when a saved amount is loaded into an editable
 * field. Inputs stay fully writable; compact Mn/Mr/Tr labels belong to output.
 */
export function formatMinorInput(amountMinor: Minor): string {
  assertMinor(amountMinor);
  return formatTRInputLive((amountMinor / 100).toFixed(2).replace(".", ","));
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
 * Read a spreadsheet-style sum ("300+400+500", "+300+1.250,50-100"), saying
 * why when it is not one.
 */
export function readAmountExpression(input: string): ReadAmount {
  const compact = input.replace(/[₺\s]/g, "");
  if (compact === "") return { ok: false, reason: "empty" };
  const terms = compact.match(/[+-]?[\d.,]+/g);
  if (!terms || terms.join("") !== compact) return { ok: false, reason: "malformed" };
  let total = 0;
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    // A term that is itself unreadable or itself too large answers for the
    // whole expression, so "1+abc" reads as unreadable and "1+9e20" as over
    // the limit rather than both collapsing to one message.
    const read = readTRAmount(term.replace(/^[+-]/, ""));
    if (!read.ok) return read;
    total += sign * read.minor;
  }
  // Every term fit and the sum did not: the figure is too large to store, and
  // that is the one case the limit message was written for.
  return isSupportedMinorAmount(total) ? { ok: true, minor: total } : { ok: false, reason: "over-limit" };
}

/**
 * Parse a spreadsheet-style sum ("300+400+500", "+300+1.250,50-100") into
 * minor units. Single plain amounts parse too. Null for anything else.
 */
export function parseAmountExpression(input: string): Minor | null {
  const read = readAmountExpression(input);
  return read.ok ? read.minor : null;
}
