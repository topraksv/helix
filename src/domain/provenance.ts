/** Where a ledger row came from. */
import type { TransactionOrigin } from "./types";

/** How a row is described to the owner. Unknown is its own answer. */
type ProvenanceLabel = "manual" | "spreadsheet" | "statement" | "expected" | "unknown";

/**
 * A row written before provenance existed is UNKNOWN, never "manual": that
 * would print a guess as a fact on the rows most likely to be imported.
 */
export function provenanceOf(row: { origin?: TransactionOrigin | null }): ProvenanceLabel {
  return row.origin ?? "unknown";
}

