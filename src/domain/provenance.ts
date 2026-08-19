/**
 * Where a ledger row came from.
 *
 * The only thing this module still answers. It used to also find duplicate
 * pairs and rank candidate payments for an expectation; both were review
 * surfaces the owner removed — the duplicate list could not tell two identical
 * grocery shops from one entered twice, and matching an expectation to an
 * existing payment asked a question that "ödendi" already answers.
 */
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

