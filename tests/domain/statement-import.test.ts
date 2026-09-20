/**
 * Reading a card statement into reviewable candidates.
 *
 * Every fixture here is synthetic. The rule the whole module is built on is
 * that MISSING a row is acceptable and INVENTING one is not, so most of these
 * pin refusals: a line this cannot read confidently must produce nothing, or a
 * visible rejection, and never a plausible-looking charge.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_STATEMENT_CANDIDATES,
  amountFormat,
  billedMonthFromDates,
  cardFromPlans,
  defaultSelection,
  reviewCandidates,
  parseStatement,
  parseStatementLine,
  periodFromDates,
  matchStatementCategory,
  statementDifferenceMinor,
  statementImportKey,
  statementPlanSpec,
} from "../../src/domain/statement-import";

const PERIOD = "2026-08";
const parse = (line: string) => parseStatementLine(line, PERIOD);
const candidateOf = (line: string) => {
  const result = parse(line);
  if (result.kind !== "candidate") throw new Error(`expected a candidate for: ${line} (got ${result.kind})`);
  return result.candidate;
};

describe("reading one statement line", () => {
  it("reads a one-time purchase", () => {
    expect(candidateOf("12.08.2026 MIGROS MARKET ISTANBUL 1.234,56")).toMatchObject({
      kind: "purchase",
      date: "2026-08-12",
      description: "MIGROS MARKET ISTANBUL",
      amountMinor: 123_456,
      isRefund: false,
      installmentNo: null,
      installmentCount: null,
    });
  });

  it("reads an instalment purchase and the position within its plan", () => {
    expect(candidateOf("03.08.2026 TEKNOSA 3/9 500,00")).toMatchObject({
      kind: "installment",
      date: "2026-08-03",
      description: "TEKNOSA",
      amountMinor: 50_000,
      installmentNo: 3,
      installmentCount: 9,
    });
  });

  it("accepts the separators a statement actually uses", () => {
    expect(candidateOf("01/08/26 KAHVE DUKKANI 89,90").date).toBe("2026-08-01");
    expect(candidateOf("01.08.2026 KAHVE DUKKANI 89,90").date).toBe("2026-08-01");
  });

  it("reads a refund as a refund rather than as spending", () => {
    expect(candidateOf("15.08.2026 IADE TEKNOSA -250,00")).toMatchObject({
      isRefund: true,
      amountMinor: 25_000,
    });
  });

  /** `1/1` is a single payment printed in instalment notation, not a plan. */
  it("does not turn a single payment into a one-instalment plan", () => {
    expect(candidateOf("05.08.2026 ECZANE 1/1 120,00")).toMatchObject({
      kind: "purchase",
      installmentCount: null,
    });
  });

  it("refuses an instalment position that is beyond its own total", () => {
    expect(candidateOf("05.08.2026 DUKKAN 9/3 120,00").kind).toBe("purchase");
  });
});

describe("refusing what it cannot read", () => {
  it("ignores structure rather than calling it a refused entry", () => {
    for (const line of [
      "",
      "HESAP OZETI",
      "Sayfa 1 / 3",
      "Toplam 12.345,67",
      "Son Ödeme Tarihi 05.09.2026",
      "Kullanılabilir limit 10.000,00",
      "MIGROS MARKET",
      "12.08.2026 MIGROS MARKET",
    ]) {
      expect(parse(line).kind, line).toBe("ignored");
    }
  });

  /**
   * The failure this prevents: a statement that prints the charge and the
   * running balance on one row would otherwise import the balance as a
   * purchase, and nothing on screen would say so.
   */
  it("refuses a line carrying more than one amount", () => {
    const result = parse("12.08.2026 MIGROS 1.234,56 9.876,54");
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reason).toBe("ambiguous_amount");
  });

  it("refuses an impossible date instead of shifting it to a real one", () => {
    const result = parse("31.02.2026 MIGROS 100,00");
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reason).toBe("ambiguous_date");
  });

  it("refuses a line with no merchant to name", () => {
    const result = parse("12.08.2026 X 100,00");
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reason).toBe("no_description");
  });

  /** A decimal comma is required, so a reference number is never money. */
  it("does not read a card or reference number as an amount", () => {
    expect(parse("12.08.2026 REF 4508 0345 1122 3344").kind).toBe("ignored");
    expect(parse("12.08.2026 SIPARIS 2026").kind).toBe("ignored");
  });
});

describe("reading a whole statement", () => {
  const statement = [
    "HESAP OZETI",
    "12.08.2026 MIGROS MARKET 1.234,56",
    "03.08.2026 TEKNOSA 3/9 500,00",
    "31.02.2026 BOZUK TARIH 10,00",
    "Toplam 1.734,56",
  ].join("\n");

  it("separates candidates, refusals and structure", () => {
    const result = parseStatement(statement, PERIOD);
    expect(result.candidates.map((candidate) => candidate.description)).toEqual(["MIGROS MARKET", "TEKNOSA"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.ignoredLineCount).toBe(2);
  });

  /** Re-downloading and re-importing the same statement must converge. */
  it("gives the same line the same identity every time", () => {
    const first = parseStatement(statement, PERIOD).candidates.map((candidate) => candidate.importKey);
    const second = parseStatement(statement, PERIOD).candidates.map((candidate) => candidate.importKey);
    expect(second).toEqual(first);
  });

  it("separates the same period's identical charges from another period's", () => {
    const august = parseStatement("12.08.2026 KAHVE 89,90", "2026-08").candidates[0]!.importKey;
    const september = parseStatement("12.09.2026 KAHVE 89,90", "2026-09").candidates[0]!.importKey;
    expect(august).not.toBe(september);
  });

  /**
   * The same coffee twice in one day is two real charges. They must stay two
   * rows, and they must still be re-importable without becoming four.
   */
  it("keeps a genuine repeat as two rows with distinct identities", () => {
    const twice = "12.08.2026 KAHVE 89,90\n12.08.2026 KAHVE 89,90";
    const first = parseStatement(twice, PERIOD);
    expect(first.candidates).toHaveLength(2);
    expect(new Set(first.candidates.map((candidate) => candidate.importKey)).size).toBe(2);
    const again = parseStatement(twice, PERIOD);
    expect(again.candidates.map((candidate) => candidate.importKey))
      .toEqual(first.candidates.map((candidate) => candidate.importKey));
  });

  it("is bounded: a statement is not a ledger", () => {
    const huge = Array.from({ length: MAX_STATEMENT_CANDIDATES + 40 }, (_, index) =>
      `12.08.2026 DUKKAN ${index} 10,00`).join("\n");
    expect(parseStatement(huge, PERIOD).candidates.length).toBe(MAX_STATEMENT_CANDIDATES);
  });

  it("takes the period from the dates it read, not from a bank-specific header", () => {
    expect(periodFromDates(["2026-08-01", "2026-08-20", "2026-08-15"])).toBe("2026-08");
    expect(periodFromDates([])).toBe("unknown");
  });

  /**
   * An instalment line prints the day the purchase was MADE, months before the
   * statement it is billed on. Three running plans beside four new charges put
   * the median in the month before the bill — which is still the right key,
   * because a statement imported before must derive the keys it was imported
   * under, and the wrong month to offer as the bill's.
   */
  it("offers the month of the newest line, however old the running plans' purchase dates", () => {
    const dates = ["2026-03-25", "2026-04-25", "2026-06-02", "2026-07-19", "2026-07-22", "2026-07-28", "2026-08-10"] as const;
    expect(billedMonthFromDates(dates)).toBe("2026-08");
    expect(periodFromDates(dates)).toBe("2026-07");
    expect(billedMonthFromDates([])).toBeNull();
  });

  it("keys on what the bank printed, so a description's case cannot split it", () => {
    const base = { period: PERIOD, date: "2026-08-12" as const, amountMinor: 100, installmentNo: null };
    expect(statementImportKey({ ...base, description: "Migros  Market" }))
      .toBe(statementImportKey({ ...base, description: "MIGROS MARKET" }));
  });
});

describe("what the review already knows about a candidate", () => {
  const candidate = parseStatement("12.08.2026 MIGROS MARKET 1.234,56", PERIOD).candidates[0]!;
  const installment = parseStatement("03.08.2026 TEKNOSA 3/9 500,00", PERIOD).candidates[0]!;

  type Plans = Parameters<typeof reviewCandidates>[0]["plans"];
  const review = (existing: Parameters<typeof reviewCandidates>[0]["existing"], plans: Plans = []) =>
    reviewCandidates({ candidates: [candidate, installment], existing, plans, expected: [], period: PERIOD, paymentSourceId: "card" });
  /** The plan behind `TEKNOSA 3/9 500,00` on the August statement: nine from June. */
  const teknosa = (over: Partial<Plans[number]> = {}): Plans[number] => ({
    id: "plan-1",
    title: "Teknosa",
    startMonth: "2026-06",
    installmentCount: 9,
    totalAmountMinor: null,
    monthlyAmountMinor: 50_000,
    currency: "TRY",
    paymentSourceId: "card",
    ...over,
  });

  /** Re-importing the same statement must recognise every row it already has. */
  it("recognises a line it has already imported, by the line's own identity", () => {
    const verdicts = review([
      { id: "tx-1", amountTryMinor: 123_456, effectiveDate: "2026-08-12", importKey: candidate.importKey },
    ]);
    expect(verdicts.get(candidate.importKey)).toEqual({ state: "imported", existingId: "tx-1" });
  });

  /**
   * A plan already materialises one row per month. Importing its statement
   * line too would charge the same instalment twice, and the second copy would
   * look exactly like an ordinary purchase.
   */
  it("recognises an instalment that an existing plan already covers", () => {
    expect(review([], [teknosa()]).get(installment.importKey)).toEqual({
      state: "plan",
      planId: "plan-1",
      planTitle: "Teknosa",
      differenceMinor: 0,
    });
  });

  /**
   * A plan is known by its schedule. The owner names a plan after what was
   * bought; the statement prints who was paid. Matching on the title found
   * none of the three plans a workbook had already brought in for the owner's
   * own statement, and ticked all three to be written a second time.
   */
  it("recognises an instalment by its schedule when the plan carries another name", () => {
    expect(review([], [teknosa({ title: "Telefon" })]).get(installment.importKey))
      .toMatchObject({ state: "plan", planId: "plan-1", planTitle: "Telefon" });
  });

  it("does not claim a plan by its name when the schedule disagrees", () => {
    expect(review([], [teknosa({ installmentCount: 12 })]).get(installment.importKey)).toEqual({ state: "new" });
    expect(review([], [teknosa({ startMonth: "2026-05" })]).get(installment.importKey)).toEqual({ state: "new" });
  });

  it("finds a plan from a line that prints only what remains, whatever month it began", () => {
    const remainder = parseStatement("25 Mayıs 2026 BIR ISYERI TR 302,49 604,98 / 2", PERIOD).candidates[0]!;
    const verdicts = reviewCandidates({
      candidates: [remainder],
      existing: [],
      plans: [teknosa({ startMonth: "2026-05", installmentCount: 6, monthlyAmountMinor: 30_249 })],
      expected: [],
      period: PERIOD,
      paymentSourceId: null,
    });
    expect(verdicts.get(remainder.importKey)).toMatchObject({ state: "plan", planId: "plan-1" });
  });

  /** A kuruş the plan split differently is shown, and the plan is left as the owner made it. */
  it("names what the line bills beyond the plan's own instalment", () => {
    expect(review([], [teknosa({ monthlyAmountMinor: 49_998 })]).get(installment.importKey))
      .toMatchObject({ state: "plan", differenceMinor: 2 });
  });

  it("leaves a refund printed with an instalment marker to be read as a refund", () => {
    const refund = parseStatement("03.08.2026 TEKNOSA 3/9 -500,00", PERIOD).candidates[0]!;
    const verdicts = reviewCandidates({ candidates: [refund], existing: [], plans: [teknosa()], expected: [], period: PERIOD, paymentSourceId: "card" });
    expect(verdicts.get(refund.importKey)).toEqual({ state: "new" });
  });

  /**
   * A plan was entered against a card, and a statement is filed under one. The
   * statement's card is read from the plans its instalment lines already are,
   * so the import is tied to the owner's own card rather than to whichever one
   * was picked first.
   */
  it("reads the statement's card from the plans its lines already are", () => {
    const lines = parseStatement("03.08.2026 TEKNOSA 3/9 500,00\n12.08.2026 MIGROS 1.234,56", PERIOD).candidates;
    const onCard = (id: string, over: Partial<Plans[number]> = {}) => teknosa({ id: `plan-${id}`, paymentSourceId: id, ...over });
    expect(cardFromPlans(lines, [onCard("card-a")], PERIOD)).toBe("card-a");
    expect(cardFromPlans(lines, [onCard("card-a", { startMonth: "2026-05" })], PERIOD)).toBeNull();
    expect(cardFromPlans(lines, [teknosa({ paymentSourceId: null })], PERIOD)).toBeNull();
    // Two cards holding the same plan say nothing about which one this is.
    expect(cardFromPlans(lines, [onCard("card-a"), onCard("card-b")], PERIOD)).toBeNull();
  });

  it("lets the card most of the lines agree on win", () => {
    const lines = parseStatement([
      "03.08.2026 TEKNOSA 3/9 500,00",
      "04.08.2026 MEDIAMARKT 2/6 250,00",
    ].join("\n"), PERIOD).candidates;
    const plans = [
      teknosa({ id: "p1", paymentSourceId: "card-a" }),
      teknosa({ id: "p2", paymentSourceId: "card-b" }),
      teknosa({ id: "p3", paymentSourceId: "card-b", startMonth: "2026-07", installmentCount: 6, monthlyAmountMinor: 25_000 }),
    ];
    expect(cardFromPlans(lines, plans, PERIOD)).toBe("card-b");
    const refund = parseStatement("03.08.2026 TEKNOSA 3/9 -500,00", PERIOD).candidates;
    expect(cardFromPlans(refund, [teknosa()], PERIOD)).toBeNull();
  });

  /** Two genuinely identical purchases on one statement are two plans, and only one of them exists yet. */
  it("lets one plan account for one line of the statement, not two", () => {
    const twice = parseStatement("03.08.2026 TEKNOSA 3/9 500,00\n03.08.2026 TEKNOSA 3/9 500,00", PERIOD).candidates;
    const verdicts = reviewCandidates({ candidates: twice, existing: [], plans: [teknosa()], expected: [], period: PERIOD, paymentSourceId: "card" });
    expect(twice.map((line) => verdicts.get(line.importKey)?.state)).toEqual(["plan", "new"]);
  });

  it("raises a similar hand-entered row as a question, not as a fact", () => {
    const verdicts = review([
      { id: "tx-9", amountTryMinor: -123_456, effectiveDate: "2026-08-13", importKey: null },
    ]);
    expect(verdicts.get(candidate.importKey)).toEqual({ state: "similar", existingId: "tx-9", dayGap: 1 });
  });

  /** A card charge is due weeks after it was bought; the statement prints the day it was bought. */
  it("finds a card charge entered by hand by the day it was bought, not the day it is due", () => {
    const verdicts = review([
      { id: "tx-9", amountTryMinor: -123_456, effectiveDate: "2026-09-10", purchaseDate: "2026-08-11", importKey: null },
    ]);
    expect(verdicts.get(candidate.importKey)).toEqual({ state: "similar", existingId: "tx-9", dayGap: 1 });
  });

  describe("a subscription payment still expected", () => {
    const netflix = parseStatement("12.08.2026 NETFLIX.COM 229,99", PERIOD).candidates[0]!;
    const expecting = (over: Partial<Parameters<typeof reviewCandidates>[0]["expected"][number]> = {}) => ({
      id: "exp-1", title: "Film Aboneliği", dueDate: "2026-08-13" as const, amountMinor: 22_999, paymentSourceId: "card", ...over,
    });
    const verdictFor = (line: typeof netflix, expected: ReturnType<typeof expecting>[], paymentSourceId: string | null = "card") =>
      reviewCandidates({ candidates: [line], existing: [], plans: [], expected, period: PERIOD, paymentSourceId }).get(line.importKey);

    /** Imported, the line IS that payment; left expected, confirming it would write the same charge again. */
    it("settles the payment the line is, and offers it ticked", () => {
      const verdicts = reviewCandidates({ candidates: [netflix], existing: [], plans: [], expected: [expecting()], period: PERIOD, paymentSourceId: "card" });
      expect(verdicts.get(netflix.importKey)).toEqual({ state: "expected", expectedId: "exp-1", title: "Film Aboneliği" });
      expect(defaultSelection(verdicts).has(netflix.importKey)).toBe(true);
    });

    it("knows it by name when the price has moved", () => {
      expect(verdictFor(netflix, [expecting({ title: "Netflix", amountMinor: 19_999 })])).toMatchObject({ state: "expected" });
      expect(verdictFor(netflix, [expecting({ amountMinor: 19_999 })])).toEqual({ state: "new" });
    });

    it("is not another card's, another week's, a refund's or a plan's", () => {
      expect(verdictFor(netflix, [expecting({ paymentSourceId: "other" })])).toEqual({ state: "new" });
      expect(verdictFor(netflix, [expecting({ paymentSourceId: null })], null)).toMatchObject({ state: "expected" });
      expect(verdictFor(netflix, [expecting({ dueDate: "2026-08-16" })])).toEqual({ state: "new" });
      expect(verdictFor(netflix, [expecting({ dueDate: "2026-08-09" })])).toMatchObject({ state: "expected" });
      const refund = parseStatement("12.08.2026 NETFLIX.COM -229,99", PERIOD).candidates[0]!;
      expect(verdictFor(refund, [expecting()])).toEqual({ state: "new" });
      const instalment = parseStatement("12.08.2026 NETFLIX.COM 1/3 229,99", PERIOD).candidates[0]!;
      expect(verdictFor(instalment, [expecting()])).toEqual({ state: "new" });
    });

    it("lets one expected payment settle one line", () => {
      const twice = parseStatement("12.08.2026 NETFLIX.COM 229,99\n12.08.2026 NETFLIX.COM 229,99", PERIOD).candidates;
      const verdicts = reviewCandidates({ candidates: twice, existing: [], plans: [], expected: [expecting()], period: PERIOD, paymentSourceId: "card" });
      expect(twice.map((line) => verdicts.get(line.importKey)?.state)).toEqual(["expected", "new"]);
    });

    it("leaves a row already in the ledger to say so first", () => {
      const verdicts = reviewCandidates({
        candidates: [netflix],
        existing: [{ id: "tx-1", amountTryMinor: -22_999, effectiveDate: "2026-09-10", purchaseDate: "2026-08-12", importKey: null }],
        plans: [],
        expected: [expecting()],
        period: PERIOD,
        paymentSourceId: "card",
      });
      expect(verdicts.get(netflix.importKey)).toMatchObject({ state: "similar" });
    });
  });

  it("leaves a genuinely new line alone", () => {
    expect(review([]).get(candidate.importKey)).toEqual({ state: "new" });
  });

  /**
   * The default has to be the safe one: accepting without reading closely must
   * not import a repeat or double an instalment.
   */
  it("ticks only the rows nothing resembles", () => {
    const verdicts = review(
      [{ id: "tx-1", amountTryMinor: 123_456, effectiveDate: "2026-08-12", importKey: candidate.importKey }],
      [teknosa()],
    );
    expect([...defaultSelection(verdicts)]).toEqual([]);

    const clean = review([]);
    expect(new Set(defaultSelection(clean))).toEqual(new Set([candidate.importKey, installment.importKey]));
  });
});

/**
 * The layout of the statement this parser was calibrated against.
 *
 * Yapı Kredi World, `İşlem Tarihi | İşlemler | Tutar(TL) | Kalan
 * Tutar/Taksit | Puan`. Every fixture below is synthetic and reproduces a
 * SHAPE observed in a real document — no merchant, amount or date from it is
 * reproduced here, because a statement is the most sensitive file the owner
 * has and none of it belongs in a repository.
 */
describe("the reference statement layout", () => {
  it("reads a long Turkish date, which is how this statement prints them", () => {
    expect(candidateOf("04 Temmuz 2026 BIR ISYERI ANKARA TR 545,00")).toMatchObject({
      kind: "purchase",
      date: "2026-07-04",
      description: "BIR ISYERI ANKARA TR",
      amountMinor: 54_500,
    });
    expect(candidateOf("4 Ağustos 2026 BIR ISYERI TR 90,00").date).toBe("2026-08-04");
    expect(candidateOf("15 Eylül 2026 BIR ISYERI TR 10,00").date).toBe("2026-09-15");
  });

  it("reads every month name the calendar has", () => {
    const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
      "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    months.forEach((name, index) => {
      expect(candidateOf(`01 ${name} 2026 BIR ISYERI TR 10,00`).date)
        .toBe(`2026-${String(index + 1).padStart(2, "0")}-01`);
    });
  });

  /**
   * The trailing integer is `Puan`, not an instalment count. Reading it as one
   * would turn a 92-point grocery shop into a 92-payment plan.
   */
  it("does not mistake loyalty points for an instalment count", () => {
    expect(candidateOf("11 Temmuz 2026 BIR ISYERI TR 2.300,82 92")).toMatchObject({
      kind: "purchase",
      amountMinor: 230_082,
      installmentCount: null,
      remainingInstallments: null,
    });
  });

  /** `Kalan Tutar/Taksit` says how many payments are LEFT, never which one. */
  it("reads the remaining-instalment column without inventing a position", () => {
    expect(candidateOf("25 Mayıs 2026 BIR ISYERI TR 302,49 604,98 / 2")).toMatchObject({
      kind: "installment",
      amountMinor: 30_249,
      remainingInstallments: 2,
      installmentNo: null,
      installmentCount: null,
    });
  });

  it("counts a line with one payment still to follow as an instalment", () => {
    expect(candidateOf("25 Nisan 2026 BIR ISYERI TR 92,63 92,63 / 1")).toMatchObject({
      kind: "installment",
      remainingInstallments: 1,
    });
  });

  it("keeps the points column out of an instalment row's arithmetic", () => {
    expect(candidateOf("15 Haziran 2026 BIR ISYERI TR 7.333,34 14.666,66 / 2 2.200")).toMatchObject({
      kind: "installment",
      amountMinor: 733_334,
      remainingInstallments: 2,
    });
  });

  /** A credit is printed with a leading `+` and is money coming back. */
  it("reads a refund as a credit rather than as spending", () => {
    expect(candidateOf("14 Temmuz 2026 BIR ISYERI IADE +1.250,00")).toMatchObject({
      isRefund: true,
      amountMinor: 125_000,
    });
  });

  /**
   * Settling the card is not a transaction this ledger takes.
   *
   * The reference statement's first entry is last period's payment, printed
   * exactly like a refund: a dated line with a credit amount. It used to become
   * a candidate — the whole previous balance offered back as income — so no
   * total the importer produced could reconcile against the paper. The
   * purchases it settles are already in the ledger, and the money left an
   * account the ledger also tracks.
   */
  it("leaves the card's own settlement out, and says so", () => {
    for (const line of [
      "14 Temmuz 2026 ODEME-TESEKKUR EDERIZ +24.381,40",
      "14 Temmuz 2026 HESAPTAN YAPILAN ODEME -24.381,40",
      "01.08.2026 KREDI KARTI ODEMESI -5.000,00",
      "01.08.2026 OTOMATIK ODEME -1.234,56",
    ]) {
      const result = parse(line);
      expect(result.kind, line).toBe("skipped");
      if (result.kind === "skipped") expect(result.skip.reason).toBe("card_payment");
    }
  });

  /**
   * Turkish is what makes this a real rule rather than a word list.
   *
   * A statement is printed in capitals, and dotless `ı` does NOT case-fold to
   * `I` — `/yapılan/i` is simply false for "YAPILAN". The match runs over the
   * folded line, so one spelling covers every case the printer uses.
   */
  it("recognises the settlement however the printer capitalises it", () => {
    for (const line of [
      "14 Temmuz 2026 HESAPTAN YAPILAN ÖDEME -24.381,40",
      "14 Temmuz 2026 Hesaptan Yapılan Ödeme -24.381,40",
      "14 Temmuz 2026 hesaptan yapilan odeme -24.381,40",
    ]) {
      expect(parse(line).kind, line).toBe("skipped");
    }
  });

  /**
   * Both halves of the test matter. A charge at a merchant whose name contains
   * one of these words is still the charge it is — only a CREDIT can be a
   * settlement, and inventing a skip would lose a real expense silently.
   */
  it("still imports a charge from a merchant whose name reads like a payment", () => {
    expect(candidateOf("05.08.2026 TAHSILAT BUROSU 340,00")).toMatchObject({
      amountMinor: 34_000,
      isRefund: false,
    });
  });

  it("collects every skipped line so the total can be reconciled", () => {
    const parsed = parseStatement([
      "14 Temmuz 2026 ODEME-TESEKKUR EDERIZ +24.381,40",
      "15 Temmuz 2026 MIGROS 1.234,56",
      "16 Temmuz 2026 HESAPTAN YAPILAN ODEME -500,00",
    ].join("\n"), "2026-07");
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["card_payment", "card_payment"]);
    expect(parsed.skipped[0]!.sourceLine).toContain("ODEME-TESEKKUR");
  });

  /** An interest-rate table prints the same shape as money and is not money. */
  it("ignores the interest-rate rows entirely", () => {
    expect(parse("Akdi Oran 3,25 / %39,00 %4,25 / %51,00").kind).toBe("ignored");
    expect(parse("04 Temmuz 2026 ORAN %3,55 / %42,60").kind).toBe("ignored");
  });

  it("still refuses two amounts that no column explains", () => {
    const result = parse("04 Temmuz 2026 BIR ISYERI TR 100,00 250,00");
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reason).toBe("ambiguous_amount");
  });

  it("ignores this statement's own headers and totals", () => {
    for (const line of [
      "İşlem Tarihi İşlemler Tutar(TL) Kalan Tutar/Taksit Puan",
      "HESAP BİLGİLERİ",
      "Dönem Borcu : 23.679,35 TL",
      "Son Ödeme Tarihi : 14 Ağustos 2026",
      "Kullanılabilir Toplam Worldpuan/TL Karşılığı : 7 / 0,03 TL",
      "TOPLAM",
      "PUAN ÖZETİ",
    ]) {
      expect(parse(line).kind, line).toBe("ignored");
    }
  });

  /**
   * The position is printed on the line UNDER the charge, with the purchase's
   * whole total: measured on the owner's statement, eight of eight belong to
   * the line above, and all five remaining counts are `m − n`. On a plan's last
   * payment the line above prints no remaining count at all, so without this
   * line the final instalment read as a new purchase beside its plan's own row.
   */
  describe("the position printed under an instalment", () => {
    const read = (...lines: string[]) => parseStatement(lines.join("\n"), PERIOD);

    it("reads a plan's last payment as an instalment, not as a new purchase", () => {
      const [line] = read("25 Mayıs 2026 BIR ISYERI TR 302,49", "1.814,94 TL'lik işlemin 6 / 6 taksidi").candidates;
      expect(line).toMatchObject({ kind: "installment", installmentNo: 6, installmentCount: 6 });
      expect(statementPlanSpec(line!, PERIOD)).toEqual({ startMonth: "2026-03", installmentCount: 6, installmentNo: 6 });
    });

    it("meets the plan whose last month this is", () => {
      const [line] = read("25 Mayıs 2026 BIR ISYERI TR 302,49", "1.814,94 TL'lik işlemin 6 / 6 taksidi").candidates;
      const plan = { id: "plan-1", title: "Telefon", startMonth: "2026-03" as const, installmentCount: 6, totalAmountMinor: 181_494, monthlyAmountMinor: null, currency: "TRY", paymentSourceId: null };
      expect(reviewCandidates({ candidates: [line!], existing: [], plans: [plan], expected: [], period: PERIOD, paymentSourceId: null }).get(line!.importKey))
        .toMatchObject({ state: "plan", planId: "plan-1" });
    });

    it("gives a remaining-count line its position, and the key it had without it", () => {
      const alone = read("25 Mayıs 2026 BIR ISYERI TR 302,49 604,98 / 2").candidates[0]!;
      const result = read("25 Mayıs 2026 BIR ISYERI TR 302,49 604,98 / 2", "1.814,94 TL'lik işlemin 4 / 6 taksidi");
      expect(result.candidates).toEqual([{ ...alone, installmentNo: 4, installmentCount: 6 }]);
      expect(result.ignoredLineCount).toBe(1);
    });

    it("takes the first instalment's rounding as belonging to the purchase", () => {
      expect(read("25 Mayıs 2026 BIR ISYERI TR 333,34", "1.000,00 TL'lik işlemin 1 / 3 taksidi").candidates[0])
        .toMatchObject({ installmentNo: 1, installmentCount: 3 });
    });

    it("leaves a line alone when the arithmetic says the position is not its own", () => {
      for (const lines of [
        ["25 Mayıs 2026 BIR ISYERI TR 302,49", "1.814,94 TL'lik işlemin 5 / 5 taksidi"],
        ["25 Mayıs 2026 BIR ISYERI TR 302,49 604,98 / 2", "1.814,94 TL'lik işlemin 5 / 6 taksidi"],
        ["25 Mayıs 2026 BIR ISYERI TR 302,49", "Sayfa 2 / 3"],
        ["25 Mayıs 2026 BIR ISYERI TR 302,49", "1.814,94 TL 604,98 TL 6 / 6"],
        ["25 Mayıs 2026 BIR ISYERI TR 302,49", "1.814,94 TL'lik işlemin 7 / 6 taksidi"],
        ["25 Mayıs 2026 BIR ISYERI TR 302,49", "302,49 TL'lik işlemin 1 / 1 taksidi"],
      ]) {
        expect(read(...lines).candidates[0], lines[1]).toMatchObject({ installmentNo: null, installmentCount: null });
      }
    });

    it("belongs only to the line directly above it", () => {
      const result = read(
        "25 Mayıs 2026 BIR ISYERI TR 302,49",
        "TOPLAM",
        "1.814,94 TL'lik işlemin 6 / 6 taksidi",
      );
      expect(result.candidates[0]).toMatchObject({ kind: "purchase", installmentNo: null });
      for (const dated of ["Son Ödeme Tarihi 05.09.2026 1.814,94 TL 6 / 6", "Son Ödeme Tarihi 5 Eylül 2026 1.814,94 TL 6 / 6"]) {
        expect(read("25 Mayıs 2026 BIR ISYERI TR 302,49", dated).candidates[0], dated).toMatchObject({ kind: "purchase", installmentNo: null });
      }
    });

    it("never overrides a position the line itself printed", () => {
      expect(read("03.08.2026 TEKNOSA 3/9 500,00", "4.500,00 TL'lik işlemin 9 / 9 taksidi").candidates[0])
        .toMatchObject({ installmentNo: 3, installmentCount: 9 });
    });
  });
});

/** Layouts measured on real statements, rebuilt with invented merchants and figures. */
describe("other statement layouts", () => {
  /** Fields positioned rather than spaced, so the text runs them together. */
  it("reads a line whose date, merchant, amount and position were run together", () => {
    expect(candidateOf("16/07/2026MERKEZ ECZANE1.995,731/3 TAKSIT (5.987,19)")).toMatchObject({
      date: "2026-07-16",
      description: "MERKEZ ECZANE",
      amountMinor: 199_573,
      installmentNo: 1,
      installmentCount: 3,
    });
  });

  describe("money written 1,234.56, as a page-format statement prints it", () => {
    const read = (...lines: string[]) => parseStatement(["24/08/2026 BIR ISYERI TR 1,234.56", ...lines].join("\n"), PERIOD);

    it("tells how a statement writes money from its dated lines", () => {
      expect(amountFormat(["24/08/2026 BIR ISYERI TR 1,234.56", "Yıllık: %3,25"])).toBe("en");
      expect(amountFormat(["12.08.2026 MIGROS 1.234,56", "Toplam 12,50"])).toBe("tr");
      expect(amountFormat([])).toBe("tr");
    });

    it("reads the amount, and a credit marked after it", () => {
      const [charge, refund] = read("20/08/2026 IADE-BIR ISYERI 150.00(-)").candidates;
      expect(charge).toMatchObject({ amountMinor: 123_456, isRefund: false });
      expect(refund).toMatchObject({ amountMinor: 15_000, isRefund: true, description: "IADE-BIR ISYERI" });
    });

    it("leaves the card's own settlement out", () => {
      expect(read("05/08/2026 İNTERNET Şb-Ödemeniz için Teşekkürler 4,500.00(-)").skipped).toHaveLength(1);
    });

    /** `(total TL) count/position.taksit charge each×left`: the order is count first, proved by the total. */
    it("reads the purchase total, the position it proves and the payments left", () => {
      const [, line] = read("10/06/2026 BIR MAGAZA (9,000.00 TL) 9/4.taksit 1,000.00 1,000.00x5").candidates;
      expect(line).toMatchObject({
        kind: "installment",
        description: "BIR MAGAZA",
        amountMinor: 100_000,
        installmentNo: 4,
        installmentCount: 9,
        remainingInstallments: 5,
      });
      expect(read("10/06/2026 BIR MAGAZA (3,000.00 TL) 3/3.taksit 1,000.00").candidates[1])
        .toMatchObject({ installmentNo: 3, installmentCount: 3, remainingInstallments: null });
    });

    it("does not reverse a position the total does not prove", () => {
      expect(read("10/06/2026 BIR MAGAZA (9,000.00 TL) 9/4.taksit 1,500.00 1,000.00x5").candidates[1])
        .toMatchObject({ installmentNo: null, installmentCount: null });
    });
  });
});

/**
 * Whether the import accounted for the whole statement.
 *
 * The parser is deliberately narrow — only a line carrying a date, a merchant
 * and an amount becomes an entry — so lines it does not read are expected
 * rather than exceptional. Nothing noticed when one went missing: the ledger
 * was quietly short by its amount, and it surfaced months later as balance
 * drift with no way back to the cause.
 *
 * The figure it is checked against is TYPED, not parsed. The screen's own
 * promise is that a statement is a document the app cannot verify and
 * therefore does not guess at, and the total's wording is the most
 * bank-specific thing on the page. Reading it would be a guess about the one
 * number whose whole job is to be certain.
 */
describe("checking the read against the statement", () => {
  const charge = (amountMinor: number, isRefund = false) => ({ amountMinor, isRefund });

  it("nets refunds against charges, the way the printed figure does", () => {
    expect(statementDifferenceMinor(300_00, [charge(400_00), charge(100_00, true)])).toBeNull();
  });

  it("reports what is missing when the read falls short", () => {
    expect(statementDifferenceMinor(500_00, [charge(400_00)])).toBe(100_00);
  });

  it("reports the other direction too, rather than only under-reads", () => {
    expect(statementDifferenceMinor(300_00, [charge(400_00)])).toBe(-100_00);
  });

  it("says nothing at all when there is no figure to check against", () => {
    expect(statementDifferenceMinor(null, [charge(400_00)])).toBeNull();
  });

  it("treats an empty read as reading nothing, not as agreement", () => {
    expect(statementDifferenceMinor(500_00, [])).toBe(500_00);
  });
});

describe("the instalment plan a statement line implies", () => {
  const line = (over: Partial<Parameters<typeof statementPlanSpec>[0]> = {}) => ({
    kind: "installment" as const,
    installmentNo: 3,
    installmentCount: 9,
    remainingInstallments: null,
    ...over,
  });

  it("puts the first payment as many months back as this one is along", () => {
    expect(statementPlanSpec(line(), "2026-07")).toEqual({
      startMonth: "2026-05",
      installmentCount: 9,
      installmentNo: 3,
    });
  });

  it("starts the plan here when this is its first payment", () => {
    expect(statementPlanSpec(line({ installmentNo: 1 }), "2026-07")?.startMonth).toBe("2026-07");
  });

  /**
   * The reference statement's `Kalan Tutar/Taksit` column says how many
   * payments are LEFT after this one and never which one this is. A plan built
   * from it can only be the remainder, beginning here — everything earlier is
   * unknown, so nothing earlier is invented.
   */
  it("builds this payment and the ones left when the position was not printed", () => {
    expect(statementPlanSpec(
      line({ installmentNo: null, installmentCount: null, remainingInstallments: 2 }),
      "2026-07",
    )).toEqual({ startMonth: "2026-07", installmentCount: 3, installmentNo: null });
  });

  it("crosses a year boundary the way months do", () => {
    expect(statementPlanSpec(line({ installmentNo: 4, installmentCount: 6 }), "2026-02")?.startMonth)
      .toBe("2025-11");
  });

  it("is nothing at all for a line that is not an instalment", () => {
    expect(statementPlanSpec({ ...line(), kind: "purchase" }, "2026-07")).toBeNull();
    expect(statementPlanSpec(
      line({ installmentNo: null, installmentCount: null, remainingInstallments: null }),
      "2026-07",
    )).toBeNull();
  });

  it("refuses a remaining count of zero rather than opening an empty plan", () => {
    expect(statementPlanSpec(
      line({ installmentNo: null, installmentCount: null, remainingInstallments: 0 }),
      "2026-07",
    )).toBeNull();
  });

  it("takes a printed position over the count left, which says less", () => {
    expect(statementPlanSpec(line({ installmentNo: 4, installmentCount: 6, remainingInstallments: 2 }), "2026-07"))
      .toEqual({ startMonth: "2026-04", installmentCount: 6, installmentNo: 4 });
  });

  /** Two statements of one plan must derive the SAME plan, or each opens its own. */
  it("derives one start month and count from every statement of the same plan", () => {
    const july = statementPlanSpec(line({ installmentNo: 3 }), "2026-07");
    const august = statementPlanSpec(line({ installmentNo: 4 }), "2026-08");
    expect(august?.startMonth).toBe(july?.startMonth);
    expect(august?.installmentCount).toBe(july?.installmentCount);
  });
});

/**
 * Which of the owner's own columns a statement line belongs in.
 *
 * Every row used to default to whichever expense column sorted first, so a
 * statement filed a month of spending under one arbitrary heading and nothing
 * on screen admitted the guess.
 */
describe("fitting a statement line to a column the owner already has", () => {
  const columns = (...names: string[]) => names.map((name, index) => ({ id: `c${index}`, name }));

  it("uses the owner's own heading when the merchant prints it", () => {
    expect(matchStatementCategory("MIGROS MARKET", columns("Kira", "Market"))).toBe("c1");
  });

  it("reads the heading through Turkish casing, in either direction", () => {
    // A statement is printed in capitals and dotless ı does not fold to I, so
    // a plain lowercase comparison misses "GIDA" against a column named "Gıda".
    expect(matchStatementCategory("SOK MARKET GIDA", columns("Gıda"))).toBe("c0");
    expect(matchStatementCategory("İSTANBUL ECZANE", columns("Eczane"))).toBe("c0");
  });

  it("refuses a heading too short to mean anything on a statement line", () => {
    // "Ev" and "Su" would match half a statement between them.
    expect(matchStatementCategory("EVIM SUCUK", columns("Ev", "Su"))).toBeNull();
  });

  it("matches the same concept under different words", () => {
    // The merchant says market, the column says food. One vocabulary, two
    // words, and no entry needed for either of them.
    expect(matchStatementCategory("BIM MARKET", columns("Kira", "Gıda"))).toBe("c1");
  });

  it("places a merchant that names no concept of its own", () => {
    expect(matchStatementCategory("SHELL PETROL", columns("Kira", "Araç & Yakıt"))).toBe("c1");
    expect(matchStatementCategory("NETFLIX.COM", columns("Abonelikler"))).toBe("c0");
  });

  /**
   * Every merchant this claims to know, and every column word it claims to
   * answer with. A table rather than a sentence each, because the list IS the
   * feature: what is missing from here is what the importer cannot place, and
   * the only way to know a name still resolves is to ask it.
   *
   * Each case is chosen so the alias is the rule that answers — the merchant
   * carries no word of the column's own, and neither side names a concept the
   * shared vocabulary would have matched first.
   */
  it("knows every merchant and every column word in its own list", () => {
    const merchants: [string, string][] = [
      ["MIGROS SANAL", "Market"], ["CARREFOURSA", "Market"], ["A101 MAGAZA", "Market"],
      ["A 101 YENI", "Market"], ["BIM", "Market"],
      ["SHELL BAYI", "Yakıt"], ["OPET AS", "Yakıt"], ["PETROL OFISI", "Yakıt"], ["AYTEMIZ", "Yakıt"],
      ["YEMEKSEPETI", "Restoran"], ["GETIR", "Restoran"], ["STARBUCKS", "Restoran"], ["BURGER KING", "Restoran"],
      ["NETFLIX.COM", "Abonelik"], ["SPOTIFY AB", "Abonelik"], ["YOUTUBEPREMIUM", "Abonelik"], ["ICLOUD", "Abonelik"],
      ["TURKCELL", "İnternet"], ["VODAFONE", "İnternet"], ["TURK TELEKOM", "İnternet"], ["SUPERONLINE", "İnternet"],
      ["UBER BV", "Ulaşım"], ["BITAKSI", "Ulaşım"], ["MARTI", "Ulaşım"], ["HGS", "Ulaşım"],
      ["LC WAIKIKI", "Giyim"], ["DEFACTO", "Giyim"], ["KOTON", "Giyim"], ["ZARA", "Giyim"],
      ["TEKNOSA", "Alışveriş"], ["MEDIAMARKT", "Alışveriş"], ["HEPSIBURADA", "Alışveriş"], ["TRENDYOL", "Alışveriş"],
    ];
    for (const [merchant, column] of merchants) {
      expect(matchStatementCategory(merchant, columns("Kira", column)), merchant).toBe("c1");
    }

    // The other side of each entry: the words an owner's column might use.
    const columnWords: [string, string][] = [
      ["MIGROS SANAL", "Market"], ["MIGROS SANAL", "Gıda"], ["MIGROS SANAL", "Mutfak"],
      ["SHELL BAYI", "Yakıt"], ["SHELL BAYI", "Araç"], ["SHELL BAYI", "Benzin"], ["SHELL BAYI", "Otomobil"],
      ["GETIR", "Restoran"], ["GETIR", "Yemek"], ["GETIR", "Kafe"],
      ["NETFLIX.COM", "Abonelik"], ["NETFLIX.COM", "Dijital"], ["NETFLIX.COM", "Eğlence"],
      ["TURKCELL", "İnternet"], ["TURKCELL", "Telefon"], ["TURKCELL", "İletişim"],
      ["UBER BV", "Ulaşım"], ["UBER BV", "Taksi"], ["UBER BV", "Otobüs"],
      ["ZARA", "Giyim"], ["ZARA", "Kıyafet"], ["ZARA", "Ayakkabı"],
      ["TEKNOSA", "Alışveriş"], ["TEKNOSA", "Elektronik"], ["TEKNOSA", "Teknoloji"],
    ];
    for (const [merchant, column] of columnWords) {
      expect(matchStatementCategory(merchant, columns("Kira", column)), `${merchant} → ${column}`).toBe("c1");
    }
  });

  /** Null is the important answer: nothing is invented, and the review says so. */
  it("answers null rather than picking a column at random", () => {
    expect(matchStatementCategory("ABC XYZ 1234", columns("Kira", "Market"))).toBeNull();
    expect(matchStatementCategory("MIGROS MARKET", [])).toBeNull();
  });

  it("never invents a column that is not the owner's", () => {
    // A merchant this can read, in a workspace with no column for it.
    expect(matchStatementCategory("SHELL PETROL", columns("Kira"))).toBeNull();
  });
});
