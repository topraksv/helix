/**
 * Provenance, duplicate review and expected-to-actual matching.
 *
 * The whole point of these rules is that they never act on their own. What is
 * pinned here is therefore as much about what they REFUSE to claim as about
 * what they find.
 */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_DAYS,
  MATCH_WINDOW_DAYS,
  findDuplicates,
  matchCandidates,
  provenanceOf,
  type CandidateRow,
  type ExpectedLike,
} from "../src/domain/provenance";

const row = (over: Partial<CandidateRow> & Pick<CandidateRow, "id">): CandidateRow => ({
  amountTryMinor: -100_00,
  effectiveDate: "2026-08-10",
  categoryId: "market",
  ...over,
});

describe("provenance", () => {
  it("reports a row written before provenance existed as unknown, not manual", () => {
    expect(provenanceOf({})).toBe("unknown");
    expect(provenanceOf({ origin: null })).toBe("unknown");
    expect(provenanceOf({ origin: "manual" })).toBe("manual");
    expect(provenanceOf({ origin: "spreadsheet" })).toBe("spreadsheet");
    expect(provenanceOf({ origin: "statement" })).toBe("statement");
  });
});

describe("duplicate review", () => {
  /** The same source line twice is arithmetic, not judgement. */
  it("is certain when two rows carry the same source line", () => {
    const pairs = findDuplicates([
      row({ id: "a", importKey: "stmt:1" }),
      row({ id: "b", importKey: "stmt:1", effectiveDate: "2026-08-12" }),
    ]);
    expect(pairs).toEqual([{ existingId: "a", duplicateId: "b", certain: true, dayGap: 2 }]);
  });

  it("is only suspicious when the shape matches but the source does not", () => {
    const pairs = findDuplicates([row({ id: "a" }), row({ id: "b", effectiveDate: "2026-08-11" })]);
    expect(pairs).toEqual([{ existingId: "a", duplicateId: "b", certain: false, dayGap: 1 }]);
  });

  /** An identical weekly shop is a real pattern, not a duplicate. */
  it("leaves a genuine repeat outside the window alone", () => {
    const pairs = findDuplicates([
      row({ id: "a", effectiveDate: "2026-08-03" }),
      row({ id: "b", effectiveDate: "2026-08-10" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("holds the window boundary exactly", () => {
    const inside = findDuplicates([
      row({ id: "a", effectiveDate: "2026-08-10" }),
      row({ id: "b", effectiveDate: `2026-08-1${DUPLICATE_WINDOW_DAYS}` }),
    ]);
    expect(inside).toHaveLength(1);
    const outside = findDuplicates([
      row({ id: "a", effectiveDate: "2026-08-10" }),
      row({ id: "b", effectiveDate: "2026-08-14" }),
    ]);
    expect(outside).toEqual([]);
  });

  it("does not pair two different lines of the same import", () => {
    const pairs = findDuplicates([
      row({ id: "a", importKey: "stmt:1" }),
      row({ id: "b", importKey: "stmt:2" }),
    ]);
    expect(pairs).toEqual([]);
  });

  it("separates rows that differ in amount or category", () => {
    expect(findDuplicates([row({ id: "a" }), row({ id: "b", amountTryMinor: -100_01 })])).toEqual([]);
    expect(findDuplicates([row({ id: "a" }), row({ id: "b", categoryId: "fuel" })])).toEqual([]);
  });

  it("reports a triple import as two pairs against the first row", () => {
    const pairs = findDuplicates([
      row({ id: "a", importKey: "k" }),
      row({ id: "b", importKey: "k" }),
      row({ id: "c", importKey: "k" }),
    ]);
    expect(pairs.map((pair) => pair.duplicateId)).toEqual(["b", "c"]);
    expect(pairs.every((pair) => pair.existingId === "a" && pair.certain)).toBe(true);
  });
});

describe("matching an expected payment to a real one", () => {
  const expected: ExpectedLike = {
    id: "exp-1",
    dueDate: "2026-08-10",
    amountMinor: 100_00,
    currency: "TRY",
    direction: "out",
  };

  it("ranks the exact amount on the day above everything else", () => {
    const candidates = matchCandidates(expected, [
      row({ id: "near-wrong-amount", amountTryMinor: -95_00, effectiveDate: "2026-08-10" }),
      row({ id: "exact-late", amountTryMinor: -100_00, effectiveDate: "2026-08-14" }),
      row({ id: "exact-onday", amountTryMinor: -100_00, effectiveDate: "2026-08-10" }),
    ]);
    expect(candidates.map((candidate) => candidate.transactionId))
      .toEqual(["exact-onday", "exact-late", "near-wrong-amount"]);
    expect(candidates[0]).toMatchObject({ sameAmount: true, dayGap: 0, score: 100 });
  });

  it("ignores anything outside the window", () => {
    const candidates = matchCandidates(expected, [
      row({ id: "far", amountTryMinor: -100_00, effectiveDate: "2026-09-01" }),
    ]);
    expect(candidates).toEqual([]);
  });

  it("holds the window boundary exactly", () => {
    const atEdge = matchCandidates(expected, [row({ id: "edge", amountTryMinor: -100_00, effectiveDate: "2026-08-20" })]);
    expect(atEdge).toHaveLength(1);
    expect(atEdge[0]?.dayGap).toBe(MATCH_WINDOW_DAYS);
    expect(matchCandidates(expected, [row({ id: "past", amountTryMinor: -100_00, effectiveDate: "2026-08-21" })])).toEqual([]);
  });

  it("never offers a transaction already linked to something", () => {
    const candidates = matchCandidates(
      expected,
      [row({ id: "taken", amountTryMinor: -100_00 })],
      { alreadyLinkedIds: new Set(["taken"]) },
    );
    expect(candidates).toEqual([]);
  });

  /**
   * A foreign-currency expectation needs a rate for the transaction's own day.
   * Converting at today's rate would rank the wrong payment first while
   * looking exact, so it offers nothing instead.
   */
  it("offers nothing rather than a wrong ranking for a foreign currency", () => {
    expect(matchCandidates({ ...expected, currency: "USD" }, [row({ id: "a", amountTryMinor: -100_00 })])).toEqual([]);
  });

  it("compares magnitudes, so a stored sign convention cannot hide a match", () => {
    const income: ExpectedLike = { ...expected, direction: "in" };
    const candidates = matchCandidates(income, [row({ id: "salary", amountTryMinor: 100_00 })]);
    expect(candidates[0]?.sameAmount).toBe(true);
  });
});
