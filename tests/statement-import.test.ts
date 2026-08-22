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
  defaultSelection,
  reviewCandidates,
  parseStatement,
  parseStatementLine,
  periodFromDates,
  statementDifferenceMinor,
  statementImportKey,
} from "../src/domain/statement-import";

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

  it("keys on what the bank printed, so a description's case cannot split it", () => {
    const base = { period: PERIOD, date: "2026-08-12" as const, amountMinor: 100, installmentNo: null };
    expect(statementImportKey({ ...base, description: "Migros  Market" }))
      .toBe(statementImportKey({ ...base, description: "MIGROS MARKET" }));
  });
});

describe("what the review already knows about a candidate", () => {
  const candidate = parseStatement("12.08.2026 MIGROS MARKET 1.234,56", PERIOD).candidates[0]!;
  const installment = parseStatement("03.08.2026 TEKNOSA 3/9 500,00", PERIOD).candidates[0]!;

  const review = (existing: Parameters<typeof reviewCandidates>[0]["existing"], plans: Parameters<typeof reviewCandidates>[0]["plans"] = []) =>
    reviewCandidates({ candidates: [candidate, installment], existing, plans });

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
    const verdicts = review([], [
      { id: "plan-1", title: "Teknosa", installmentCount: 9, monthlyAmountMinor: 50_000 },
    ]);
    expect(verdicts.get(installment.importKey)).toEqual({
      state: "plan",
      planId: "plan-1",
      planTitle: "Teknosa",
    });
  });

  it("does not claim a plan when the instalment count disagrees", () => {
    const verdicts = review([], [
      { id: "plan-1", title: "Teknosa", installmentCount: 12, monthlyAmountMinor: 50_000 },
    ]);
    expect(verdicts.get(installment.importKey)).toEqual({ state: "new" });
  });

  it("raises a similar hand-entered row as a question, not as a fact", () => {
    const verdicts = review([
      { id: "tx-9", amountTryMinor: -123_456, effectiveDate: "2026-08-13", importKey: null },
    ]);
    expect(verdicts.get(candidate.importKey)).toEqual({ state: "similar", existingId: "tx-9", dayGap: 1 });
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
      [{ id: "plan-1", title: "Teknosa", installmentCount: 9, monthlyAmountMinor: 50_000 }],
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

  it("still counts the last payment of a plan as an instalment", () => {
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

