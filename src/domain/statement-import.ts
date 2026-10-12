/**
 * Turning a statement's text into reviewable candidates (spec §3.9).
 *
 * A candidate needs a date, a description and an amount in that order; anything
 * else yields nothing. Missing a row is the only acceptable failure, because an
 * invented one cannot be noticed. `STATEMENT_FORMAT` is the one place that
 * knows what a statement line looks like. Nothing here performs I/O or writes:
 * candidates are proposals until a person accepts them.
 */

import { groupBy, sameCard } from "./card-statements";
import { addMonthsToKey, daysBetweenISO, isISODate, type ISODate, type MonthKey } from "./dates";
import { conceptOf } from "./category-icons";
import { planForSighting, type PlanSighting } from "./installments";
import { foldForMatch, nameMentions } from "./logo-domain";
import { splitIntoInstallments, type Minor } from "./money";

/** What a candidate turned out to be. */
type StatementEntryKind = "purchase" | "installment";

export interface StatementCandidate {
  /** Deterministic identity of the source line, so a repeated import converges instead of doubling the ledger. */
  importKey: string;
  kind: StatementEntryKind;
  date: ISODate;
  description: string;
  /** Positive minor units. Direction is carried by `kind`/`isRefund`. */
  amountMinor: Minor;
  /** A refund printed as a negative amount on the statement. */
  isRefund: boolean;
  /** For an instalment line: which payment this is, and of how many. */
  installmentNo: number | null;
  installmentCount: number | null;
  /** Payments still to come AFTER this one, when the statement prints a remaining count but not a position. */
  remainingInstallments: number | null;
  /** The line as printed, kept so review can show what was read. */
  sourceLine: string;
}

/** A line that looked like an entry but could not be read confidently. */
interface StatementRejection {
  sourceLine: string;
  reason: "ambiguous_amount" | "ambiguous_date" | "no_description";
}

/**
 * A line that was understood and deliberately left out, unlike a rejection
 * ("could not be trusted"): a payment to the card would count the same money
 * twice, once as the purchases it settles and once as itself. Surfaced, not
 * dropped, so the total can still be reconciled against the paper.
 */
interface StatementSkip {
  sourceLine: string;
  reason: "card_payment";
}

export interface StatementParseResult {
  candidates: StatementCandidate[];
  /** Lines that resembled entries and were refused. Surfaced, never hidden. */
  rejected: StatementRejection[];
  /** Lines understood and deliberately left out. Surfaced, never hidden. */
  skipped: StatementSkip[];
  /** Lines that were plainly not entries (headers, totals). Counted only. */
  ignoredLineCount: number;
}

/** How a statement writes money: `1.234,56` or `1,234.56`. */
type AmountFormat = "tr" | "en";

/** What a statement line looks like. */
const STATEMENT_FORMAT = {
  /** `4 Ağustos 2026`, or `dd.mm.yyyy` / `dd/mm/yy`. */
  longDate: /(\d{1,2})\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(\d{4})/u,
  date: /(\d{2})[./](\d{2})[./](\d{4}|\d{2})/,
  /**
   * Money needs its two decimals, so a card number, a reference or a year is
   * never money. A credit is signed before (`-250,00`) or marked after (`(-)`).
   */
  amount: {
    tr: /([+-])?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(?!\d)(\(-\))?/g,
    en: /([+-])?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?!\d)(\(-\))?/g,
  },
  /**
   * An explicit position, `3/9` or `9/4.taksit`. A bare trailing number is
   * loyalty points: read as a count, a 92-point shop became a 92-month plan.
   */
  position: /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\.?taksit)?(?=\s|$)/i,
  /** After an amount, payments left: `604,98 / 2` (what is left) or `302,49x2` (each). */
  remainder: /^\s*(?:\/\s*|x)(\d{1,2})(?!\d)/,
  /** A bracketed amount is a total — the purchase's before the charge, what is left of it after. */
  bracketOpen: /\(\s*$/,
  bracketClose: /^\s*(?:TL)?\s*\)/,
  /** An interest-rate row prints money-shaped numbers and is not a transaction. */
  rate: /%/,
  /**
   * A payment TO the card: printed like a refund, and money leaving an account
   * this ledger already tracks. Matched on the folded line (`foldForMatch`),
   * because Turkish `ı` does not case-fold to `I`; deliberately narrow, and only
   * together with a credit amount.
   */
  cardPayment: /(?:^|[\s-])(?:hesaptan (?:yapilan )?odeme|kredi karti odemesi|kart odemesi|otomatik odeme|odeme[ -]tesekkur|odemeniz icin tesekkur|tesekkur ederiz|tahsilat|virman|donem borcu odemesi)/,
  /** Lines that are structure, not entries. */
  ignore: /^(?:toplam|ara toplam|genel toplam|son ödeme|asgari|dönem|ekstre|hesap özeti|hesap bilgileri|işlem tarihi|sayfa|devreden|bakiye|limit|kullanılabilir|puan özeti|worldpuan)\b/i,
  /** A description has to be words, not a reference number. */
  minimumDescriptionLength: 3,
} as const;

/** Turkish month names, in the order the calendar has them. */
const MONTH_NUMBER = new Map<string, number>([
  ["ocak", 1], ["şubat", 2], ["mart", 3], ["nisan", 4], ["mayıs", 5], ["haziran", 6],
  ["temmuz", 7], ["ağustos", 8], ["eylül", 9], ["ekim", 10], ["kasım", 11], ["aralık", 12],
]);

/** A line's date, or null when it has none; `iso` is null for an impossible one (31.02 is refused, not shifted). */
function readDate(text: string): { iso: ISODate | null; end: number } | null {
  const long = STATEMENT_FORMAT.longDate.exec(text);
  const match = long ?? STATEMENT_FORMAT.date.exec(text);
  if (!match) return null;
  const month = long ? String(MONTH_NUMBER.get(long[2]!.toLocaleLowerCase("tr-TR")) ?? 0).padStart(2, "0") : match[2]!;
  // Two-digit years belong to this century; a statement is never from 1998.
  const year = match[3]!.length === 4 ? match[3]! : `20${match[3]}`;
  const iso = `${year}-${month}-${match[1]!.padStart(2, "0")}`;
  return { iso: isISODate(iso) ? iso : null, end: match.index + match[0].length };
}

interface LineAmount {
  start: number;
  end: number;
  minor: Minor | null;
  credit: boolean;
  bracketed: boolean;
  /** Payments left, when this amount is a remainder column. */
  remaining: number | null;
}

function readAmounts(text: string, from: number, format: AmountFormat): LineAmount[] {
  const pattern = new RegExp(STATEMENT_FORMAT.amount[format]);
  pattern.lastIndex = from;
  const amounts: LineAmount[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const end = match.index + match[0].length;
    const digits = match[2]!.replace(/[.,]/g, "");
    const minor = Number(digits) * 100 + Number(match[3]);
    const remaining = STATEMENT_FORMAT.remainder.exec(text.slice(end));
    amounts.push({
      start: match.index,
      end,
      minor: Number.isSafeInteger(minor) ? minor : null,
      credit: match[1] != null || match[4] != null,
      bracketed: STATEMENT_FORMAT.bracketOpen.test(text.slice(0, match.index)) && STATEMENT_FORMAT.bracketClose.test(text.slice(end)),
      remaining: remaining ? Number(remaining[1]) : null,
    });
  }
  return amounts;
}

/** How the statement writes money, by which shape more of its dated lines carry. */
export function amountFormat(lines: readonly string[]): AmountFormat {
  let balance = 0;
  for (const line of lines) {
    const date = readDate(line);
    if (date) balance += readAmounts(line, date.end, "en").length - readAmounts(line, date.end, "tr").length;
  }
  return balance > 0 ? "en" : "tr";
}

/**
 * The identity of one printed line, built from what the bank printed (date,
 * description, amount, position) and the period, never from the file or a row
 * id: re-importing the same statement must give the same keys.
 */
export function statementImportKey(input: {
  period: string;
  date: ISODate;
  description: string;
  amountMinor: Minor;
  installmentNo: number | null;
}): string {
  // Locale-invariant lowercase: tr-TR maps MIGROS to mıgros, which would split one merchant into two keys.
  const normalized = input.description
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return [
    "stmt",
    input.period,
    input.date,
    normalized,
    String(input.amountMinor),
    input.installmentNo == null ? "" : String(input.installmentNo),
  ].join("|");
}

/**
 * Put the spaces back where a producer ran fields together, as in
 * `16/07/2026MERKEZ ECZANE1.995,731/3`. Three targeted rules only: a blanket
 * "split digits from letters" would cut merchant names like `A-101` in half.
 */
function separateGluedFields(line: string): string {
  return line
    // A full date immediately followed by a word.
    .replace(/(\d{2}[./]\d{2}[./]\d{4})(?=[^\s\d])/g, "$1 ")
    // An amount immediately followed by more digits. This runs BEFORE the rule
    // below, which needs to see an amount that ENDS at its two decimals:
    // `1.995,731/3` has to become `1.995,73 1/3` first, or the amount is never
    // recognised as one and the merchant stays glued to it.
    .replace(/(\d,\d{2})(?=\d)/g, "$1 ")
    // A word immediately followed by an amount. A sign and an opening bracket
    // are excluded: `-250,00` and `(5.987,19)` are already delimited, and
    // splitting the sign off its amount turns a refund into a charge.
    .replace(/([^\s\d.,(+-])(?=[+-]?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d))/g, "$1 ");
}

/**
 * The position a line prints, as `no/count`, or as `count/no` where the line's
 * own purchase total proves it — the charge is that total's share at `no`.
 */
function positionOf(text: string, charge: Minor, total: Minor | null): { match: string; no: number; count: number } | null {
  const match = STATEMENT_FORMAT.position.exec(text);
  if (!match) return null;
  const [first, second] = [Number(match[1]), Number(match[2])];
  const reversed = first > second && total != null && Math.abs(splitIntoInstallments(total, first)[second - 1]! - charge) < first;
  const [no, count] = reversed ? [second, first] : [first, second];
  // `1/1` is a single payment; a position past its own count is a misread.
  return count > 1 && no >= 1 && no <= count ? { match: match[0], no, count } : null;
}

type ParsedLine =
  | { kind: "ignored" }
  | { kind: "rejected"; rejection: StatementRejection }
  | { kind: "skipped"; skip: StatementSkip }
  | { kind: "candidate"; candidate: StatementCandidate };

const IGNORED: ParsedLine = { kind: "ignored" };

/** Why a dated line with a charge cannot be trusted, or null when it can. */
function refusalOf(date: { iso: ISODate | null }, charge: LineAmount, after: readonly LineAmount[]): StatementRejection["reason"] | null {
  if (!date.iso) return "ambiguous_date";
  // Every amount besides the charge must be a total or a remainder: an unexplained
  // pair is where importing the wrong one looks exactly like importing the right one.
  return !charge.minor || after.some((amount) => !amount.bracketed && amount.remaining == null) ? "ambiguous_amount" : null;
}

type Position = NonNullable<ReturnType<typeof positionOf>>;

/**
 * The merchant between the date and the charge, without the totals and position
 * printed among it — or why the line cannot be trusted.
 */
function readPurchase(
  text: string,
  date: { iso: ISODate | null; end: number },
  charge: LineAmount,
  amounts: readonly LineAmount[],
): { reason: StatementRejection["reason"] } | { description: string; position: Position | null } {
  const refusal = refusalOf(date, charge, amounts.filter((amount) => amount.start > charge.start));
  if (refusal) return { reason: refusal };
  const total = amounts.find((amount) => amount.bracketed && amount.start < charge.start)?.minor ?? null;
  const zone = text.slice(date.end, charge.start);
  const position = positionOf(zone, charge.minor!, total) ?? positionOf(text.slice(charge.end), charge.minor!, total);
  const description = (position ? zone.replace(position.match, " ") : zone).replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
  return description.length < STATEMENT_FORMAT.minimumDescriptionLength ? { reason: "no_description" } : { description, position };
}

function candidateOf(period: string, text: string, date: ISODate, charge: LineAmount, remainder: LineAmount | undefined, purchase: { description: string; position: Position | null }): StatementCandidate {
  const { description, position } = purchase;
  const remainingInstallments = remainder?.remaining ?? null;
  const read = {
    kind: position || (remainingInstallments ?? 0) >= 1 ? "installment" as const : "purchase" as const,
    date,
    description,
    amountMinor: charge.minor!,
    isRefund: charge.credit,
    installmentNo: position?.no ?? null,
    installmentCount: position?.count ?? null,
    remainingInstallments,
    sourceLine: text,
  };
  return { importKey: statementImportKey({ period, ...read }), ...read };
}

/** The text of a line worth reading, or null for an empty line, a heading or a rate row. */
function lineText(line: string, format: AmountFormat): string | null {
  const collapsed = line.trim().replace(/\s+/g, " ");
  const text = format === "tr" ? separateGluedFields(collapsed) : collapsed;
  return text === "" || STATEMENT_FORMAT.ignore.test(text) || STATEMENT_FORMAT.rate.test(text) ? null : text;
}

/**
 * Read one line, or decline to: ignored when it is plainly not an entry,
 * rejected when it looks like one and cannot be trusted.
 */
export function parseStatementLine(line: string, period: string, format: AmountFormat = "tr"): ParsedLine {
  const text = lineText(line, format) ?? "";
  const date = readDate(text);
  const amounts = date ? readAmounts(text, date.end, format) : [];
  const charge = amounts.find((amount) => !amount.bracketed);
  // A line missing either is structure: calling a page header "rejected" would bury the refusals that matter.
  if (!date || !charge) return IGNORED;
  const purchase = readPurchase(text, date, charge, amounts);
  if ("reason" in purchase) return { kind: "rejected", rejection: { sourceLine: text, reason: purchase.reason } };
  if (charge.credit && STATEMENT_FORMAT.cardPayment.test(foldForMatch(text))) {
    return { kind: "skipped", skip: { sourceLine: text, reason: "card_payment" } };
  }
  const remainder = amounts.find((amount) => amount.start > charge.start && amount.remaining != null);
  return { kind: "candidate", candidate: candidateOf(period, text, date.iso!, charge, remainder, purchase) };
}

export interface StatementPlanSpec {
  startMonth: MonthKey;
  installmentCount: number;
  /** Which payment this statement bills; null when only a remainder was printed. */
  installmentNo: number | null;
}

/**
 * The instalment plan one statement line implies. The start month is derived,
 * since no statement prints it, so every later statement of the same plan
 * derives the same start and count and converges on one plan. A remainder-only
 * line begins its plan here: earlier months belong to statements already imported.
 */
export function statementPlanSpec(
  candidate: Pick<StatementCandidate, "kind" | "installmentNo" | "installmentCount" | "remainingInstallments">,
  statementMonth: MonthKey,
): StatementPlanSpec | null {
  if (candidate.kind !== "installment") return null;
  const { installmentNo, installmentCount, remainingInstallments } = candidate;
  if (installmentNo != null && installmentCount != null) {
    return { startMonth: addMonthsToKey(statementMonth, -(installmentNo - 1)), installmentCount, installmentNo };
  }
  return remainingInstallments != null && remainingInstallments >= 1
    ? { startMonth: statementMonth, installmentCount: remainingInstallments + 1, installmentNo: null }
    : null;
}

/** What one instalment line says about the plan behind it, for finding that plan by its schedule. */
export function statementSighting(
  spec: StatementPlanSpec,
  amountMinor: Minor,
  statementMonth: MonthKey,
  paymentSourceId: string | null,
): PlanSighting {
  return {
    month: statementMonth,
    amountMinor,
    endMonth: addMonthsToKey(spec.startMonth, spec.installmentCount - 1),
    startMonth: spec.installmentNo == null ? null : spec.startMonth,
    paymentSourceId,
  };
}

/**
 * Merchants whose name carries no word for what they sell, mapped to the WORDS
 * an owner's column might use, never to a column this app invents. Both sides
 * are in the folded alphabet (`foldForMatch` is applied to both inputs), so
 * `[ıi]`-style classes would only add unkillable mutants. Deliberately short:
 * generic words ("ECZANE", "AKARYAKIT") go through `conceptOf`.
 */
const MERCHANT_ALIASES: readonly (readonly [RegExp, RegExp])[] = [
  [/migros|carrefour|a101|a 101|\bbim\b/, /market|gida|mutfak/],
  [/shell|opet|petrol ofisi|aytemiz/, /yakit|arac|benzin|otomobil/],
  [/yemeksepeti|getir|starbucks|burger/, /restoran|yemek|kafe/],
  [/netflix|spotify|youtube|icloud/, /abonelik|dijital|eglence/],
  [/turkcell|vodafone|turk telekom|superonline/, /internet|telefon|iletisim/],
  [/uber|bitaksi|marti|\bhgs\b/, /ulasim|taksi|otobus/],
  [/lc waikiki|defacto|koton|\bzara\b/, /giyim|kiyafet|ayakkabi/],
  [/teknosa|mediamarkt|hepsiburada|trendyol/, /alisveris|elektronik|teknoloji/],
];

/**
 * The owner's own column for one statement line, or null. Null is the
 * important answer: a guessed column looks exactly like a right one. Nothing
 * here creates a column.
 */
export function matchStatementCategory(
  description: string,
  categories: readonly { id: string; name: string }[],
): string | null {
  const merchant = foldForMatch(description);
  // 1. The owner's own heading, printed in the merchant line. The strongest
  //    evidence there is, and it needs no vocabulary at all. Four characters,
  //    because "Ev" and "Su" as headings would match half a statement.
  for (const category of categories) {
    const name = foldForMatch(category.name);
    if (name.length >= 4 && merchant.includes(name)) return category.id;
  }
  // 2. The same concept under different words: "MIGROS MARKET" and "Gıda".
  const concept = conceptOf(description);
  if (concept != null) {
    const match = categories.find((category) => conceptOf(category.name) === concept);
    if (match) return match.id;
  }
  // 3. A merchant that names no concept of its own.
  const alias = MERCHANT_ALIASES.find(([merchantPattern]) => merchantPattern.test(merchant));
  if (alias) {
    const match = categories.find((category) => alias[1].test(foldForMatch(category.name)));
    if (match) return match.id;
  }
  return null;
}

/**
 * The position a statement prints on the line UNDER a charge, beside the
 * purchase's whole total (`1.814,94 TL'lik işlemin 4 / 6 taksidi`).
 *
 * Settled by arithmetic, never wording: a dateless line with one amount and a
 * position belongs to the line above only when that line bills the total's
 * share there and any count left it printed agrees.
 */
function printedPosition(line: string, above: StatementCandidate, format: AmountFormat): { installmentNo: number; installmentCount: number } | null {
  const text = line.trim().replace(/\s+/g, " ");
  const amounts = readDate(text) ? [] : readAmounts(text, 0, format);
  const total = amounts.length === 1 ? amounts[0]!.minor : null;
  const position = total == null ? null : positionOf(text, above.amountMinor, total);
  if (!position || (above.remainingInstallments != null && above.remainingInstallments !== position.count - position.no)) return null;
  const share = splitIntoInstallments(total!, position.count)[position.no - 1]!;
  return Math.abs(share - above.amountMinor) < position.count ? { installmentNo: position.no, installmentCount: position.count } : null;
}

/** How many candidates one statement may produce. A statement is not a ledger. */
export const MAX_STATEMENT_CANDIDATES = 500;

/**
 * Read a whole statement.
 *
 * Two identical printed lines are two real charges (the same coffee twice in
 * one day), so they are NOT collapsed here — but they would collide on
 * `importKey`, so the second and later copies take an occurrence suffix. That
 * keeps re-import idempotent while still admitting genuine repeats.
 *
 * A position printed under a line (`printedPosition`) is added to that line
 * and leaves its key alone: the key is the line's own identity, and a statement
 * imported before the position was read must still be recognised.
 */
export function parseStatement(text: string, period: string): StatementParseResult {
  const lines = text.split("\n");
  const format = amountFormat(lines);
  const candidates: StatementCandidate[] = [];
  const rejected: StatementRejection[] = [];
  const skipped: StatementSkip[] = [];
  let ignoredLineCount = 0;
  const seenKeys = new Map<string, number>();
  /** The candidate the previous line produced, which a position line may belong to. */
  let above: StatementCandidate | null = null;

  for (const line of lines) {
    if (candidates.length >= MAX_STATEMENT_CANDIDATES) break;
    const parsed = parseStatementLine(line, period, format);
    const previous = above;
    above = null;
    if (parsed.kind === "ignored") {
      ignoredLineCount += 1;
      const position = previous?.installmentNo == null && previous ? printedPosition(line, previous, format) : null;
      if (position) candidates[candidates.length - 1] = { ...previous!, kind: "installment", ...position };
      continue;
    }
    if (parsed.kind === "rejected") {
      rejected.push(parsed.rejection);
      continue;
    }
    if (parsed.kind === "skipped") {
      skipped.push(parsed.skip);
      continue;
    }
    const seen = seenKeys.get(parsed.candidate.importKey) ?? 0;
    seenKeys.set(parsed.candidate.importKey, seen + 1);
    above = seen === 0
      ? parsed.candidate
      : { ...parsed.candidate, importKey: `${parsed.candidate.importKey}#${seen + 1}` };
    candidates.push(above);
  }
  return { candidates, rejected, skipped, ignoredLineCount };
}

/**
 * The period folded into every import key, from the candidates, not a header
 * (header wording varies by bank). Frozen as the median so a statement imported
 * before derives the keys it was imported under. An identity, not the bill's
 * month; that is `billedMonthFromDates`.
 */
export function periodFromDates(dates: readonly ISODate[]): string {
  if (dates.length === 0) return "unknown";
  const sorted = [...dates].sort();
  return sorted[Math.floor(sorted.length / 2)]!.slice(0, 7);
}

/**
 * The month the statement bills, as first offered: the month of its newest
 * line. An instalment line prints its purchase day, months back, so the median
 * would land a month early.
 */
export function billedMonthFromDates(dates: readonly ISODate[]): MonthKey | null {
  if (dates.length === 0) return null;
  return [...dates].sort().at(-1)!.slice(0, 7) as MonthKey;
}

// ---------------------------------------------------------------------------
// Review: what already exists, and what would be new
// ---------------------------------------------------------------------------

/** An existing ledger row, as the review needs to see it. */
interface ExistingRow {
  id: string;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  /** A card charge's own day; its effective date is the day it is due. */
  purchaseDate?: ISODate | null;
  importKey?: string | null;
}

/** An existing plan, so an instalment line is not imported as a loose charge. */
export interface ExistingPlan {
  id: string;
  title: string;
  startMonth: MonthKey;
  installmentCount: number;
  totalAmountMinor: Minor | null;
  monthlyAmountMinor: Minor | null;
  currency: string;
  paymentSourceId: string | null;
  /** A foreign-currency plan's instalment for the review's month, in lira. */
  billedTryMinor?: Minor | null;
}

/** A subscription payment still expected, which a statement line may be. */
interface ExistingExpectation {
  id: string;
  /** The subscription's name. */
  title: string;
  dueDate: ISODate;
  amountMinor: Minor;
  paymentSourceId: string | null;
}

/**
 * What the review says about one candidate before anything is written.
 *
 * - `imported`: this exact line is already in the ledger.
 * - `plan`: an existing plan already writes this instalment. `differenceMinor`
 *   is what the line bills beyond it — shown, never written.
 * - `similar`: an unkeyed row looks like it. A question, never resolved alone.
 * - `expected`: the line is a subscription payment still expected. Importing
 *   it settles that payment, so confirming it cannot write the charge again.
 * - `new`: nothing like it was found.
 */
export type CandidateVerdict =
  | { state: "imported"; existingId: string }
  | { state: "plan"; planId: string; planTitle: string; differenceMinor: Minor }
  | { state: "similar"; existingId: string; dayGap: number }
  | { state: "expected"; expectedId: string; title: string }
  | { state: "new" };

/** How far apart two dates may be and still be one charge. */
const SAME_CHARGE_WINDOW_DAYS = 3;

interface ReviewInput {
  candidates: readonly StatementCandidate[];
  existing: readonly ExistingRow[];
  plans: readonly ExistingPlan[];
  expected: readonly ExistingExpectation[];
  /** The month and card being imported into. */
  period: MonthKey;
  paymentSourceId: string | null;
}

function planVerdict(candidate: StatementCandidate, input: ReviewInput, claimed: Set<string>): CandidateVerdict | null {
  const spec = candidate.isRefund ? null : statementPlanSpec(candidate, input.period);
  const match = spec && planForSighting(statementSighting(spec, candidate.amountMinor, input.period, input.paymentSourceId), input.plans, claimed);
  if (!match) return null;
  claimed.add(match.plan.id);
  return { state: "plan", planId: match.plan.id, planTitle: match.plan.title, differenceMinor: candidate.amountMinor - match.shareMinor };
}

function similarVerdict(candidate: StatementCandidate, existing: readonly ExistingRow[]): CandidateVerdict | null {
  for (const row of existing) {
    if (row.importKey || Math.abs(row.amountTryMinor) !== candidate.amountMinor) continue;
    const dayGap = Math.abs(daysBetweenISO(candidate.date, row.purchaseDate ?? row.effectiveDate));
    if (dayGap <= SAME_CHARGE_WINDOW_DAYS) return { state: "similar", existingId: row.id, dayGap };
  }
  return null;
}

/** Same card, within days of its due date, and the same amount or the subscription's name printed on the line. */
function expectedVerdict(candidate: StatementCandidate, input: ReviewInput, claimed: Set<string>): CandidateVerdict | null {
  if (candidate.isRefund || candidate.kind !== "purchase") return null;
  const payment = input.expected.find((expected) =>
    !claimed.has(expected.id)
    && sameCard(expected.paymentSourceId, input.paymentSourceId)
    && Math.abs(daysBetweenISO(candidate.date, expected.dueDate)) <= SAME_CHARGE_WINDOW_DAYS
    && (expected.amountMinor === candidate.amountMinor || nameMentions(candidate.description, expected.title)));
  if (!payment) return null;
  claimed.add(payment.id);
  return { state: "expected", expectedId: payment.id, title: payment.title };
}

/**
 * Decide, for each candidate, whether the ledger already has it: from what is
 * certain (the line's own key) to what is only suspected, stopping at the first.
 */
export function reviewCandidates(input: ReviewInput): Map<string, CandidateVerdict> {
  const imported = new Map(input.existing.filter((row) => row.importKey).map((row) => [row.importKey!, row.id]));
  const claimed = new Set<string>();
  return new Map(input.candidates.map((candidate) => {
    const existingId = imported.get(candidate.importKey);
    const verdict: CandidateVerdict = (existingId && { state: "imported", existingId })
      || planVerdict(candidate, input, claimed)
      || similarVerdict(candidate, input.existing)
      || expectedVerdict(candidate, input, claimed)
      || { state: "new" };
    return [candidate.importKey, verdict];
  }));
}

/**
 * The card a statement belongs to, read from the plans its instalment lines
 * already are — the card most of them were entered against, or null when none
 * match or two cards tie. Filing a statement under the owner's own card is what
 * lets its lines meet those plans at all; `plans` should hold only cards.
 */
export function cardFromPlans(
  candidates: readonly StatementCandidate[],
  plans: readonly ExistingPlan[],
  period: MonthKey,
): string | null {
  const byCard = groupBy(plans, (plan) => plan.paymentSourceId);
  const votes = new Map<string, number>();
  const claimed = new Set<string>();
  for (const candidate of candidates) {
    const spec = candidate.isRefund ? null : statementPlanSpec(candidate, period);
    if (!spec) continue;
    // Every card that holds the line gets its vote, so a plan two cards both
    // hold ties rather than going to whichever card was listed first.
    for (const [card, held] of byCard) {
      const match = planForSighting(statementSighting(spec, candidate.amountMinor, period, card), held, claimed);
      if (!match) continue;
      claimed.add(match.plan.id);
      votes.set(card, (votes.get(card) ?? 0) + 1);
    }
  }
  const [first, second] = [...votes].sort((a, b) => b[1] - a[1]);
  return first && first[1] !== second?.[1] ? first[0] : null;
}

/** What the review offers by default, per verdict. Nothing certain is ticked. */
export function defaultSelection(verdicts: ReadonlyMap<string, CandidateVerdict>): Set<string> {
  const selected = new Set<string>();
  for (const [key, verdict] of verdicts) {
    // Accepting the defaults unread must never write a charge twice.
    if (verdict.state === "new" || verdict.state === "expected") selected.add(key);
  }
  return selected;
}

/**
 * How far the read fell short of the figure the owner checked it against.
 * Positive: the statement says more than was read, so the missing amount
 * surfaces later as balance drift. Negative: something was read twice or a
 * non-charge became one. `null` means nothing to report (no figure given, or
 * they agree). Refunds are netted, since `amountMinor` is always positive.
 */
export function statementDifferenceMinor(
  declaredMinor: Minor | null,
  candidates: readonly Pick<StatementCandidate, "amountMinor" | "isRefund">[],
): Minor | null {
  if (declaredMinor == null) return null;
  let read = 0;
  for (const candidate of candidates) {
    read += candidate.isRefund ? -candidate.amountMinor : candidate.amountMinor;
  }
  const difference = declaredMinor - read;
  return difference === 0 ? null : difference;
}
