/**
 * Turning a statement's text into reviewable candidates (spec §3.1b).
 *
 * ## Scope, and why it is this narrow
 *
 * A candidate is only ever produced from a line that carries ALL THREE of a
 * date, a description and an amount, in that order, optionally followed by an
 * instalment marker. Anything else — a running total, a header, a wrapped
 * description, a line whose amount could be a card number — yields nothing.
 *
 * That is deliberate and it is the whole safety model: this reads a financial
 * document that the app cannot verify, so the only acceptable failure is to
 * MISS a row. Inventing one puts money in the ledger that the bank never
 * charged, and the owner has no way to notice.
 *
 * ## Calibration
 *
 * `STATEMENT_FORMAT` below is the one place that knows what a statement line
 * looks like. It is currently pinned to the Turkish conventions this project
 * already parses elsewhere (`domain/money.ts` reads `1.234,56`, dates are
 * `dd.mm.yyyy` or `dd/mm/yyyy`) and is exercised by synthetic fixtures only.
 * Tuning it to a specific bank's layout means editing this constant and its
 * tests, and nothing else.
 *
 * Nothing here performs I/O, and nothing here writes: candidates are proposals
 * until a person accepts them.
 */

import { daysBetweenISO, isISODate, type ISODate } from "./dates";
import { foldForMatch } from "./logo-domain";
import type { Minor } from "./money";

/** What a candidate turned out to be. */
type StatementEntryKind = "purchase" | "installment";

export interface StatementCandidate {
  /**
   * Deterministic identity of the source line, stable across re-imports of the
   * same statement. Built from the fields the bank itself printed, so the same
   * line always produces the same key and a repeated import converges instead
   * of doubling the ledger.
   */
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
  /**
   * Payments still to come, when the statement prints a remaining count but
   * not a position. The reference statement's `Kalan Tutar/Taksit` column is
   * exactly this: it says two payments are left, never that this is the third
   * of nine.
   */
  remainingInstallments: number | null;
  /** The line as printed, kept so review can show what was read. */
  sourceLine: string;
}

/** A line that looked like an entry but could not be read confidently. */
export interface StatementRejection {
  sourceLine: string;
  reason: "ambiguous_amount" | "ambiguous_date" | "no_description";
}

/**
 * A line that was read perfectly well and deliberately left out.
 *
 * Separate from a rejection, which means "could not be trusted". This one is
 * understood: a payment to the card is money moving between two things this
 * ledger already knows about, so importing it would count the same money
 * twice — once as the purchases it settles and once as itself.
 *
 * Surfaced rather than dropped. A statement importer that silently discards
 * lines is one whose total can never be reconciled against the paper.
 */
export interface StatementSkip {
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

/**
 * What a statement line looks like.
 *
 * One constant, because it is the only thing that changes per bank and the
 * only thing that has to be re-verified against a real document.
 */
const STATEMENT_FORMAT = {
  /**
   * `4 Ağustos 2026`, as the reference statement prints it, and the numeric
   * `dd.mm.yyyy` form as a second accepted shape.
   *
   * The long form is the one verified against a real document; the numeric one
   * costs a few characters and is refused by the day/month validity check if a
   * bank ever prints something else in that position.
   */
  longDate: /(\d{1,2})\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(\d{4})/u,
  date: /(\d{2})[./](\d{2})[./](\d{4}|\d{2})/,
  /** `1.234,56`, `+24.381,40`. The decimal comma is required so a card number,
   *  a reference number or a bare year can never be read as money. */
  amount: /([+-])?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(?!\d)/,
  /**
   * An explicit instalment position, e.g. `3/9`.
   *
   * The reference statement's columns are
   * `İşlem Tarihi | İşlemler | Tutar(TL) | Kalan Tutar/Taksit | Puan`, and in
   * that document the trailing integer after the amount is PUAN — loyalty
   * points. Reading it as an instalment count would turn a 92-point grocery
   * shop into a 92-month plan, so only an explicit `n/m` counts, and a bare
   * trailing number is ignored.
   */
  installment: /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?=\s|$)/,
  /**
   * The reference statement's `Kalan Tutar/Taksit` column, printed after the
   * amount as `604,98 / 2` — remaining total, then remaining payments.
   *
   * It gives how many payments are LEFT, never which one this is, so a
   * candidate built from it says exactly that and no more.
   */
  remainder: /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\s*\/\s*(\d{1,2})(?!\d)/,
  /**
   * The same column printed the other way round: `1/3 TAKSIT (5.987,19)`, a
   * position followed by the remaining total in brackets. The bracketed figure
   * is that total, not a second charge.
   */
  bracketedRemainder: /\((\d{1,3}(?:\.\d{3})*|\d+),(\d{2})\)/,
  /** An interest-rate row is not a transaction. */
  rate: /%/,
  /**
   * A payment TO the card, which is money leaving an account this ledger
   * already tracks — not a refund and not a purchase.
   *
   * It is printed exactly like a refund: a dated line with a credit amount.
   * The reference statement's first entry is last period's settlement, so the
   * importer was offering the whole previous balance back as income, which no
   * total it produced could ever reconcile with.
   *
   * Matched against the FOLDED line, never with the `i` flag: a statement is
   * printed in capitals, and Turkish dotless `ı` does not case-fold to `I`, so
   * `/yapılan/i` is simply false for "YAPILAN". Written in the folded alphabet
   * (`foldForMatch`) so one spelling covers every case the printer uses.
   *
   * Matched anywhere on the line, because it sits in the merchant position
   * rather than at the start. Deliberately narrow — these are the wordings a
   * card issuer uses for its own settlement, and a merchant genuinely called
   * "ÖDEME" would need one of them verbatim.
   */
  cardPayment: /(?:^|\s)(?:hesaptan (?:yapilan )?odeme|kredi karti odemesi|kart odemesi|otomatik odeme|odeme[ -]tesekkur|tesekkur ederiz|tahsilat|virman|donem borcu odemesi)/,
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

/** Two-digit years belong to this century; a statement is never from 1998. */
function fullYear(raw: string): number {
  return raw.length === 4 ? Number(raw) : 2000 + Number(raw);
}

function toIso(day: string, month: string, year: string): ISODate | null {
  const candidate = `${fullYear(year)}-${month}-${day}`;
  // `isISODate` rejects an impossible day, which is what makes 31.02 a refusal
  // rather than a silently shifted date.
  return isISODate(candidate) ? candidate : null;
}

function parseAmountMinor(whole: string, fraction: string): Minor | null {
  const digits = whole.replace(/\./g, "");
  if (!/^\d+$/.test(digits)) return null;
  const minor = Number(digits) * 100 + Number(fraction);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * The identity of one printed line.
 *
 * Deliberately built from what the BANK printed — date, normalized
 * description, amount, instalment position — and not from the file, the
 * import run or a row id. Re-downloading the same statement and importing it
 * again must produce the same keys, or the second import doubles the ledger.
 *
 * The statement period is folded in so that two identical charges in two
 * different months stay distinct.
 */
export function statementImportKey(input: {
  period: string;
  date: ISODate;
  description: string;
  amountMinor: Minor;
  installmentNo: number | null;
}): string {
  // Locale-INVARIANT lowercase. Turkish casing is right for comparing names a
  // person typed and wrong for a stable machine identity: `toLocaleLowerCase`
  // maps "MIGROS" to "mıgros" and "Migros" to "migros", so one merchant
  // printed in two cases would produce two identities and re-import would
  // double it.
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
 * Put the spaces back where a producer ran fields together.
 *
 * One statement prints `16/07/2026MERKEZ ECZANE1.995,731/3` — date, merchant,
 * amount and instalment position with no separator at all, because each field
 * is positioned rather than spaced. Three targeted rules restore the
 * boundaries, and only those three: a blanket "split digits from letters"
 * would cut real merchant names like `A-101` and `K101-9919` in half.
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
 * Read one line, or decline to.
 *
 * Returns null for a line that is plainly not an entry, a rejection for a line
 * that looked like one and could not be trusted, and a candidate otherwise.
 */
export function parseStatementLine(
  line: string,
  period: string,
):
  | { kind: "ignored" }
  | { kind: "rejected"; rejection: StatementRejection }
  | { kind: "skipped"; skip: StatementSkip }
  | { kind: "candidate"; candidate: StatementCandidate } {
  const trimmed = separateGluedFields(line.trim().replace(/\s+/g, " "));
  if (trimmed === "") return { kind: "ignored" };
  if (STATEMENT_FORMAT.ignore.test(trimmed)) return { kind: "ignored" };
  // A rate table prints the same `n,nn / n,nn` shape as money and is not a
  // transaction; the percent sign is what tells them apart.
  if (STATEMENT_FORMAT.rate.test(trimmed)) return { kind: "ignored" };

  const longMatch = STATEMENT_FORMAT.longDate.exec(trimmed);
  const numericMatch = longMatch ? null : STATEMENT_FORMAT.date.exec(trimmed);
  const dateMatch = longMatch ?? numericMatch;
  const amountMatch = STATEMENT_FORMAT.amount.exec(trimmed);
  // A line missing either is structure, not a refused entry: saying "rejected"
  // about a page header would bury the refusals that matter.
  if (!dateMatch || !amountMatch) return { kind: "ignored" };

  const date = longMatch
    ? toIso(
        longMatch[1]!.padStart(2, "0"),
        String(MONTH_NUMBER.get(longMatch[2]!.toLocaleLowerCase("tr-TR")) ?? 0).padStart(2, "0"),
        longMatch[3]!,
      )
    : toIso(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!);
  if (!date) return { kind: "rejected", rejection: { sourceLine: trimmed, reason: "ambiguous_date" } };

  // More than one amount on a line is a row this cannot read: a statement that
  // prints "amount" and "running total" side by side would otherwise have its
  // balance imported as a purchase.
  const afterAmount = trimmed.slice(amountMatch.index + amountMatch[0].length);
  // `Tutar` followed by `Kalan Tutar / Kalan Taksit` is an instalment row, and
  // the second amount is accounted for by that column rather than being a
  // second charge. Anything ELSE carrying two amounts stays a refusal: an
  // unexplained pair is exactly the case where importing the wrong one is
  // indistinguishable from importing the right one.
  const remainderMatch = STATEMENT_FORMAT.remainder.exec(afterAmount);
  const bracketed = STATEMENT_FORMAT.bracketedRemainder.exec(afterAmount);
  const remainingInstallments = remainderMatch ? Number(remainderMatch[3]) : null;
  // A bracketed remaining total closes the charge portion of the line:
  // everything from it onwards belongs to the plan column and the points
  // beside it, and counting those as competing charges rejected rows this can
  // read perfectly well. Without a bracket, only one amount may appear before
  // the remaining-instalment column.
  const chargePortion = bracketed
    ? trimmed.slice(0, trimmed.indexOf(bracketed[0]))
    : trimmed;
  const accountedFor = remainderMatch && !bracketed ? 2 : 1;
  const allAmounts = chargePortion.match(new RegExp(STATEMENT_FORMAT.amount.source, "g")) ?? [];
  if (allAmounts.length > accountedFor) {
    return { kind: "rejected", rejection: { sourceLine: trimmed, reason: "ambiguous_amount" } };
  }
  const amountMinor = parseAmountMinor(amountMatch[2]!, amountMatch[3]!);
  if (amountMinor == null || amountMinor === 0) {
    return { kind: "rejected", rejection: { sourceLine: trimmed, reason: "ambiguous_amount" } };
  }

  // Everything between the date and the amount is the merchant.
  const between = trimmed
    .slice(dateMatch.index + dateMatch[0].length, amountMatch.index)
    .trim();
  // The position can sit either inside the description (`TEKNOSA 3/9 500,00`)
  // or after the amount, in the plan column (`1.995,73 1/3 TAKSIT (5.987,19)`).
  // Both are the same fact and are read the same way.
  const installmentMatch = STATEMENT_FORMAT.installment.exec(between)
    ?? STATEMENT_FORMAT.installment.exec(afterAmount);
  const description = (installmentMatch
    ? between.replace(installmentMatch[0], " ")
    : between).replace(/\s+/g, " ").trim();
  if (description.length < STATEMENT_FORMAT.minimumDescriptionLength) {
    return { kind: "rejected", rejection: { sourceLine: trimmed, reason: "no_description" } };
  }

  const isCredit = amountMatch[1] === "-" || amountMatch[1] === "+";
  // Settling the card is not a transaction this ledger takes: the purchases it
  // pays for are already here, and the money left an account this ledger also
  // tracks. Both halves of the test matter — the wording AND the credit sign —
  // so a merchant whose name happens to contain one of these words still
  // imports as the charge it is.
  if (isCredit && STATEMENT_FORMAT.cardPayment.test(foldForMatch(trimmed))) {
    return { kind: "skipped", skip: { sourceLine: trimmed, reason: "card_payment" } };
  }

  const installmentNo = installmentMatch ? Number(installmentMatch[1]) : null;
  const installmentCount = installmentMatch ? Number(installmentMatch[2]) : null;
  // `1/1` is a single payment printed in instalment notation, not a plan; and
  // an instalment beyond its own total is a misread, not an instalment.
  const hasPosition = installmentNo != null && installmentCount != null
    && installmentCount > 1 && installmentNo >= 1 && installmentNo <= installmentCount;
  // A remaining count of 1 means this is the last payment of a plan: still an
  // instalment, and worth saying so.
  const isInstallment = hasPosition || (remainingInstallments != null && remainingInstallments >= 1);

  return {
    kind: "candidate",
    candidate: {
      importKey: statementImportKey({
        period,
        date,
        description,
        amountMinor,
        installmentNo: hasPosition ? installmentNo : null,
      }),
      kind: isInstallment ? "installment" : "purchase",
      date,
      description,
      amountMinor,
      isRefund: isCredit,
      installmentNo: hasPosition ? installmentNo : null,
      installmentCount: hasPosition ? installmentCount : null,
      remainingInstallments,
      sourceLine: trimmed,
    },
  };
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
 */
export function parseStatement(text: string, period: string): StatementParseResult {
  const candidates: StatementCandidate[] = [];
  const rejected: StatementRejection[] = [];
  const skipped: StatementSkip[] = [];
  let ignoredLineCount = 0;
  const seenKeys = new Map<string, number>();

  for (const line of text.split("\n")) {
    if (candidates.length >= MAX_STATEMENT_CANDIDATES) break;
    const parsed = parseStatementLine(line, period);
    if (parsed.kind === "ignored") {
      ignoredLineCount += 1;
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
    candidates.push(seen === 0
      ? parsed.candidate
      : { ...parsed.candidate, importKey: `${parsed.candidate.importKey}#${seen + 1}` });
  }
  return { candidates, rejected, skipped, ignoredLineCount };
}

/**
 * The statement period, taken from the candidates themselves.
 *
 * Not read from a header: header wording is the most bank-specific thing on
 * the page, and getting it wrong would change every import key.
 */
export function periodFromDates(dates: readonly ISODate[]): string {
  if (dates.length === 0) return "unknown";
  const sorted = [...dates].sort();
  return sorted[Math.floor(sorted.length / 2)]!.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Review: what already exists, and what would be new
// ---------------------------------------------------------------------------

/** An existing ledger row, as the review needs to see it. */
export interface ExistingRow {
  id: string;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  importKey?: string | null;
  installmentPlanId?: string | null;
}

/** An existing plan, so an instalment line is not imported as a loose charge. */
export interface ExistingPlan {
  id: string;
  title: string;
  installmentCount: number;
  monthlyAmountMinor: Minor | null;
}

/**
 * What the review says about one candidate before anything is written.
 *
 * - `imported`: this exact line is already in the ledger. Re-importing the
 *   same statement must land here for every row, which is what makes the
 *   operation repeatable rather than doubling.
 * - `plan`: the line belongs to an instalment plan that already exists and
 *   already materialises its own monthly rows. Importing it would charge the
 *   same instalment twice.
 * - `similar`: nothing proves it is a repeat, but something close enough is
 *   already there. Offered for a decision, never resolved automatically.
 * - `new`: nothing like it was found.
 */
export type CandidateVerdict =
  | { state: "imported"; existingId: string }
  | { state: "plan"; planId: string; planTitle: string }
  | { state: "similar"; existingId: string; dayGap: number }
  | { state: "new" };

/** How close a date has to be for an unkeyed row to be worth mentioning. */
const STATEMENT_SIMILAR_WINDOW_DAYS = 3;

function normalizedTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Decide, for each candidate, whether the ledger already has it.
 *
 * Ordered from certainty to suspicion, and it stops at the first thing it can
 * prove: an exact import key is arithmetic, a matching plan is structural, and
 * only then does it fall back to "this looks similar", which is a question for
 * the owner rather than an answer.
 */
export function reviewCandidates(input: {
  candidates: readonly StatementCandidate[];
  existing: readonly ExistingRow[];
  plans: readonly ExistingPlan[];
}): Map<string, CandidateVerdict> {
  const byImportKey = new Map<string, ExistingRow>();
  for (const row of input.existing) {
    if (row.importKey) byImportKey.set(row.importKey, row);
  }
  const planByTitle = new Map<string, ExistingPlan>();
  for (const plan of input.plans) planByTitle.set(normalizedTitle(plan.title), plan);

  const verdicts = new Map<string, CandidateVerdict>();
  for (const candidate of input.candidates) {
    const alreadyImported = byImportKey.get(candidate.importKey);
    if (alreadyImported) {
      verdicts.set(candidate.importKey, { state: "imported", existingId: alreadyImported.id });
      continue;
    }
    if (candidate.kind === "installment") {
      // A plan already materialises one transaction per month. Importing its
      // statement line as well would charge the same instalment twice, and the
      // second copy would look exactly like a real purchase.
      const plan = planByTitle.get(normalizedTitle(candidate.description));
      if (plan && plan.installmentCount === candidate.installmentCount) {
        verdicts.set(candidate.importKey, { state: "plan", planId: plan.id, planTitle: plan.title });
        continue;
      }
    }
    const similar = input.existing.find((row) =>
      !row.importKey
      && Math.abs(row.amountTryMinor) === candidate.amountMinor
      && Math.abs(daysBetweenISO(candidate.date, row.effectiveDate)) <= STATEMENT_SIMILAR_WINDOW_DAYS);
    if (similar) {
      verdicts.set(candidate.importKey, {
        state: "similar",
        existingId: similar.id,
        dayGap: Math.abs(daysBetweenISO(candidate.date, similar.effectiveDate)),
      });
      continue;
    }
    verdicts.set(candidate.importKey, { state: "new" });
  }
  return verdicts;
}

/** What the review offers by default, per verdict. Nothing certain is ticked. */
export function defaultSelection(verdicts: ReadonlyMap<string, CandidateVerdict>): Set<string> {
  const selected = new Set<string>();
  for (const [key, verdict] of verdicts) {
    // Only rows with nothing like them already present start ticked. A repeat
    // and a plan instalment start OFF, so the safe outcome is the one that
    // happens when the owner accepts the defaults without reading closely.
    if (verdict.state === "new") selected.add(key);
  }
  return selected;
}

/**
 * How far the read fell short of the figure the owner checked it against.
 *
 * Positive means the statement says more than was read — the likeliest and
 * most damaging case, because the missing amount never reaches the ledger and
 * turns up later as balance drift with nothing pointing back here. Negative
 * means the opposite and matters just as much: something was read twice, or a
 * line that was not a charge became one.
 *
 * `null` is not "correct", it is "nothing to say" — either no figure was given
 * to check against, or the two agree. Both leave the screen with no difference
 * to report, and neither should be dressed up as the other.
 *
 * Refunds are netted the way the printed figure nets them: `amountMinor` is
 * always positive here and `isRefund` is what carries direction, so a period
 * with a return in it reconciles against the same number the bank shows.
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
