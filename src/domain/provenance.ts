/**
 * Where a transaction came from, and which rows might be the same money twice.
 *
 * Two questions the ledger could not answer before. "Did I type this, or did
 * it come from the spreadsheet?" mattered the moment an import could run
 * twice. "Is this the payment I was expecting, or a second copy of it?"
 * mattered the moment anything but hand entry could create a row.
 *
 * Both are answered here, purely, because the answer has to be identical in
 * the importer, the duplicate review and the matching flow — a duplicate rule
 * that differs between the screen that finds them and the screen that resolves
 * them is worse than no rule at all.
 */

import { daysBetweenISO, type ISODate } from "./dates";
import type { Minor } from "./money";
import type { TransactionOrigin } from "./types";

/** How a row is described to the owner. Unknown is its own answer. */
export type ProvenanceLabel = "manual" | "spreadsheet" | "statement" | "expected" | "unknown";

/**
 * A row written before provenance existed is UNKNOWN, never "manual".
 *
 * Backfilling those to "manual" would print a guess as a fact, on exactly the
 * rows most likely to have come from the original spreadsheet import.
 */
export function provenanceOf(row: { origin?: TransactionOrigin | null }): ProvenanceLabel {
  return row.origin ?? "unknown";
}

/** A row as duplicate detection sees it. */
export interface CandidateRow {
  id: string;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  categoryId: string | null;
  paymentSourceId?: string | null;
  origin?: TransactionOrigin | null;
  importKey?: string | null;
}

export interface DuplicatePair {
  /** The row that already existed. */
  existingId: string;
  /** The row that looks like a repeat of it. */
  duplicateId: string;
  /** Same source line: the same money twice, not a coincidence. */
  certain: boolean;
  /** Whole days between the two dates. */
  dayGap: number;
}

/**
 * How far apart two records of the same payment can plausibly sit.
 *
 * A statement posts a purchase up to a few days after it happened, and a
 * hand-entered row is dated when the owner remembers it. Three days either way
 * covers that without sweeping in a genuinely repeated weekly charge.
 */
export const DUPLICATE_WINDOW_DAYS = 3;

/**
 * Rows that may be the same money recorded twice.
 *
 * Two strengths, and they are NOT the same claim:
 *
 * - `certain`: both carry the same `importKey`. One source line was imported
 *   twice; no judgement is involved.
 * - otherwise: same amount, same category, within the window. That is a
 *   suspicion and the product must treat it as one — an identical weekly
 *   grocery shop is a real pattern, and merging it silently would delete money
 *   that was actually spent.
 *
 * Nothing here merges or deletes. It returns pairs for a person to look at.
 */
export function findDuplicates(rows: readonly CandidateRow[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const byImportKey = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (!row.importKey) continue;
    const bucket = byImportKey.get(row.importKey);
    if (bucket) bucket.push(row);
    else byImportKey.set(row.importKey, [row]);
  }
  const certainIds = new Set<string>();
  for (const bucket of byImportKey.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort((a, b) => a.id.localeCompare(b.id));
    const first = ordered[0]!;
    for (const other of ordered.slice(1)) {
      certainIds.add(other.id);
      pairs.push({
        existingId: first.id,
        duplicateId: other.id,
        certain: true,
        dayGap: Math.abs(daysBetweenISO(first.effectiveDate, other.effectiveDate)),
      });
    }
  }

  // Suspicion pass, bucketed by the two fields that must match exactly so this
  // stays linear rather than comparing every pair with every other.
  const byShape = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (certainIds.has(row.id)) continue;
    const key = [row.amountTryMinor, row.categoryId ?? ""].join("\u0000");
    const bucket = byShape.get(key);
    if (bucket) bucket.push(row);
    else byShape.set(key, [row]);
  }
  for (const bucket of byShape.values()) {
    if (bucket.length < 2) continue;
    const ordered = [...bucket].sort(
      (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      // Two rows from the same import with DIFFERENT keys are two different
      // source lines, and two different lines are not a duplicate.
      if (previous.importKey && current.importKey && previous.importKey !== current.importKey) continue;
      const dayGap = Math.abs(daysBetweenISO(previous.effectiveDate, current.effectiveDate));
      if (dayGap > DUPLICATE_WINDOW_DAYS) continue;
      pairs.push({ existingId: previous.id, duplicateId: current.id, certain: false, dayGap });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Expected to actual matching
// ---------------------------------------------------------------------------

export interface ExpectedLike {
  id: string;
  dueDate: ISODate;
  amountMinor: Minor;
  currency: string;
  direction: "in" | "out";
}

export interface MatchCandidate {
  transactionId: string;
  amountTryMinor: Minor;
  effectiveDate: ISODate;
  /** Closeness, 0..100, for ordering only — never a threshold to act on. */
  score: number;
  /** Why it scored what it did, so the owner can disagree with a reason. */
  sameAmount: boolean;
  dayGap: number;
}

/** How far from the due date a payment can still be that payment. */
export const MATCH_WINDOW_DAYS = 10;

/**
 * Transactions that could be the actual payment for an expected item.
 *
 * Ordered by closeness and never applied automatically. An exact amount on the
 * due date is a strong candidate and still only a candidate: the owner is the
 * one who knows whether the electricity bill they paid was this month's.
 *
 * TRY only. An expected item in another currency needs a rate for the
 * transaction's own day to be comparable, and converting at today's rate would
 * rank the wrong payment first while looking authoritative.
 */
export function matchCandidates(
  expected: ExpectedLike,
  transactions: readonly CandidateRow[],
  options: { alreadyLinkedIds?: ReadonlySet<string> } = {},
): MatchCandidate[] {
  if (expected.currency !== "TRY") return [];
  const linked = options.alreadyLinkedIds ?? new Set<string>();
  return transactions
    .flatMap((row) => {
      if (linked.has(row.id)) return [];
      const dayGap = Math.abs(daysBetweenISO(expected.dueDate, row.effectiveDate));
      if (dayGap > MATCH_WINDOW_DAYS) return [];
      const sameAmount = Math.abs(row.amountTryMinor) === Math.abs(expected.amountMinor);
      // Amount is the strong signal; proximity only breaks ties among equals.
      const score = (sameAmount ? 70 : 0) + Math.max(0, 30 - dayGap * 3);
      if (score === 0) return [];
      return [{
        transactionId: row.id,
        amountTryMinor: row.amountTryMinor,
        effectiveDate: row.effectiveDate,
        score,
        sameAmount,
        dayGap,
      }];
    })
    .sort((a, b) => b.score - a.score || a.dayGap - b.dayGap || a.transactionId.localeCompare(b.transactionId));
}
