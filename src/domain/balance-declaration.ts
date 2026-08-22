/**
 * What the user last told the app they really have, and whether the ledger
 * still agrees with it.
 *
 * Reconciling writes an adjustment so the ledger lands on the declared figure,
 * and from that instant the app has no memory of what was confirmed. Keeping
 * the declaration lets every surface say "you told me ₺20.000 on 4 Ağustos; the
 * table now says ₺30.000" rather than quietly drifting away from the one number
 * the user checked against a bank.
 *
 * Drift is not an error. It is the ordinary result of entering more records —
 * which is exactly when a person should look at their account again.
 */
import type { ISODate } from "./dates";
import { projectedTransactionFlow } from "./transactions";
import type { TxLike } from "./types";
export interface BalanceDeclaration {
  minor: number;
  at: string;
}

export function parseBalanceDeclaration(value: unknown): BalanceDeclaration | null {
  if (typeof value !== "object" || value === null) return null;
  const { minor, at } = value as Partial<BalanceDeclaration>;
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  if (typeof at !== "string" || at === "") return null;
  return { minor, at };
}

/**
 * The difference between the ledger now and the last declaration, or `null`
 * when there is nothing to compare — no declaration, or no computed balance.
 */
export function balanceDeclarationDrift(
  declaration: BalanceDeclaration | null,
  computedMinor: number | null,
): number | null {
  if (declaration == null || computedMinor == null) return null;
  const drift = computedMinor - declaration.minor;
  return drift === 0 ? null : drift;
}

/** A row that, if it really happened, would account for part of a drift. */
export interface DriftCandidate {
  id: string;
  /** How the displayed balance would move once this row is realized. */
  effectMinor: number;
  date: ISODate;
}

/** How many candidates a surface is given before the list stops helping. */
const DRIFT_CANDIDATE_LIMIT = 5;

/**
 * The unconfirmed rows that would move the ledger toward what was declared.
 *
 * Saying how far off the table is leaves the owner to find the reason from
 * memory, and the app already holds the one thing memory is worst at: which
 * rows are still pending. `countsTowardBalance` requires `realized`, so a row
 * dated in the past and never confirmed is money the table has not counted —
 * if it really moved, the table is wrong by exactly that amount.
 *
 * Only rows pointing the RIGHT WAY are offered. A ledger reading higher than
 * the declaration can only be explained by money that left, so an unconfirmed
 * income is not a candidate for it, and offering one would send the owner to
 * check a row that cannot be the answer.
 *
 * These are candidates and never a finding. Whether a row happened is
 * something only the person who wrote it knows, so the list ranks by size —
 * the largest is the likeliest to matter — and stops before it becomes
 * something to read rather than act on.
 */
export function driftCandidates(
  driftMinor: number,
  transactions: readonly TxLike[],
  today: ISODate,
  limit = DRIFT_CANDIDATE_LIMIT,
): DriftCandidate[] {
  if (driftMinor === 0) return [];
  const wanted = driftMinor > 0 ? -1 : 1;
  const candidates: DriftCandidate[] = [];
  for (const transaction of transactions) {
    if (transaction.status !== "pending" || !transaction.personIsSelf) continue;
    if (transaction.effectiveDate > today) continue;
    const flow = projectedTransactionFlow(transaction);
    const effectMinor = flow.direction === "in" ? flow.amountTryMinor : -flow.amountTryMinor;
    if (Math.sign(effectMinor) !== wanted) continue;
    candidates.push({ id: transaction.id, effectMinor, date: transaction.effectiveDate });
  }
  return candidates
    .sort((a, b) => Math.abs(b.effectMinor) - Math.abs(a.effectMinor))
    .slice(0, limit);
}
