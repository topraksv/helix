/**
 * Target allocation and the drift away from it.
 *
 * This is a MEASUREMENT, never a recommendation. It reports three things and
 * stops: what share each product was meant to be, what share it is, and the
 * difference. It does not suggest a trade, rank products, or describe a drift
 * as good or bad — the owner set the targets and is the only one who knows why.
 *
 * ## What the shares are computed from
 *
 * Book cost, not market value, because that is what the wallet already knows.
 * Helix records what was paid for a holding; it does not hold a live per-product
 * valuation, and inventing one from a market feed would silently mix a fresh
 * quote for gold with a stale or absent one for a fund and present the mixture
 * as one number. `AllocationBasis` travels with the result so the surface
 * showing it can say which it is, rather than leaving the owner to assume.
 */

import type { Minor } from "./money";

/** Basis points: 10000 = 100%. Integers, like every other share here. */
export const FULL_ALLOCATION_BP = 10_000;

type AllocationBasis = "cost";

export interface AllocationInput {
  id: string;
  name: string;
  /** Book cost currently held in this product. */
  valueMinor: Minor;
  /** Intended share in basis points, or null when none was set. */
  targetWeightBp: number | null;
  active: boolean;
}

interface AllocationRow {
  id: string;
  name: string;
  valueMinor: Minor;
  /** Actual share of the measured total, in basis points. */
  actualBp: number;
  targetBp: number | null;
  /** actual − target, in basis points. Null when no target is set. */
  driftBp: number | null;
  /** Signed money distance from the target, for the same total. */
  driftMinor: Minor | null;
}

export interface AllocationReport {
  basis: AllocationBasis;
  totalMinor: Minor;
  rows: AllocationRow[];
  /** Sum of every set target. 10000 means the plan is complete. */
  targetedBp: number;
  /** Products carrying no target; their share is measured, never assumed. */
  untargetedCount: number;
  /**
   * How far the whole portfolio is from its plan: half the sum of absolute
   * drifts, which is the share that would have to move to reach the targets.
   * Halved because every point that is over somewhere is under somewhere else,
   * and counting both ends reports twice the work that is actually required.
   */
  totalDriftBp: number;
  /** True when the targets do not add up to a whole portfolio. */
  incompletePlan: boolean;
}

/** Integer basis-point share of `total`, rounded to nearest. */
function shareBp(value: Minor, total: Minor): number {
  if (total <= 0) return 0;
  return Math.round((value * FULL_ALLOCATION_BP) / total);
}

export function isValidTargetWeightBp(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= FULL_ALLOCATION_BP;
}

/**
 * Compare where the money is against where it was meant to be.
 *
 * Only active products participate: a product that has been fully sold holds
 * nothing, and leaving it in would dilute every other share with a zero.
 */
export function allocationReport(products: AllocationInput[]): AllocationReport {
  const active = products.filter((product) => product.active);
  const totalMinor = active.reduce((sum, product) => sum + Math.max(0, product.valueMinor), 0);
  let targetedBp = 0;
  let untargetedCount = 0;
  let absoluteDriftBp = 0;

  const rows = active.map<AllocationRow>((product) => {
    const actualBp = shareBp(Math.max(0, product.valueMinor), totalMinor);
    const targetBp = isValidTargetWeightBp(product.targetWeightBp) ? product.targetWeightBp : null;
    if (targetBp == null) untargetedCount += 1;
    else targetedBp += targetBp;
    const driftBp = targetBp == null ? null : actualBp - targetBp;
    if (driftBp != null) absoluteDriftBp += Math.abs(driftBp);
    return {
      id: product.id,
      name: product.name,
      valueMinor: product.valueMinor,
      actualBp,
      targetBp,
      driftBp,
      driftMinor: driftBp == null ? null : Math.round((driftBp * totalMinor) / FULL_ALLOCATION_BP),
    };
  });

  return {
    basis: "cost",
    totalMinor,
    rows,
    targetedBp,
    untargetedCount,
    totalDriftBp: Math.round(absoluteDriftBp / 2),
    // A plan that does not add up to 100% cannot be drifted from meaningfully,
    // and saying so is more use than a drift figure computed against a partial
    // plan and presented as if it were whole.
    incompletePlan: rows.length > 0 && (untargetedCount > 0 || targetedBp !== FULL_ALLOCATION_BP),
  };
}

/** "12,5%" needs one decimal; basis points give it without floating point. */
export function formatBasisPoints(bp: number): string {
  const sign = bp < 0 ? "-" : "";
  const absolute = Math.abs(bp);
  const whole = Math.floor(absolute / 100);
  const fraction = Math.round((absolute % 100) / 10);
  return fraction === 0 ? `${sign}%${whole}` : `${sign}%${whole},${fraction}`;
}
