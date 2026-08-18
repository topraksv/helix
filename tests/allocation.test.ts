/**
 * Target allocation and drift.
 *
 * The figures here are the ones a person would act on, so each is pinned
 * against a worked example rather than a property. The measurement must also
 * refuse to look complete when the plan is not — an authoritative-looking
 * drift computed against half a plan is worse than saying the plan is half.
 */
import { describe, expect, it } from "vitest";
import {
  allocationReport,
  formatBasisPoints,
  isValidTargetWeightBp,
  FULL_ALLOCATION_BP,
  type AllocationInput,
} from "../src/domain/allocation";

const product = (over: Partial<AllocationInput> & Pick<AllocationInput, "id" | "valueMinor">): AllocationInput => ({
  name: over.id,
  targetWeightBp: null,
  active: true,
  ...over,
});

describe("allocation drift", () => {
  it("reports the share each product is, against the share it was meant to be", () => {
    const report = allocationReport([
      product({ id: "gold", valueMinor: 60_000_00, targetWeightBp: 5_000 }),
      product({ id: "fund", valueMinor: 40_000_00, targetWeightBp: 5_000 }),
    ]);
    expect(report.totalMinor).toBe(100_000_00);
    expect(report.rows.map((row) => [row.id, row.actualBp, row.driftBp])).toEqual([
      ["gold", 6_000, 1_000],
      ["fund", 4_000, -1_000],
    ]);
    // Ten points over here is ten points under there: the work is ten, not twenty.
    expect(report.totalDriftBp).toBe(1_000);
    expect(report.incompletePlan).toBe(false);
  });

  it("states the drift in money as well as in share", () => {
    const [row] = allocationReport([
      product({ id: "gold", valueMinor: 60_000_00, targetWeightBp: 5_000 }),
      product({ id: "fund", valueMinor: 40_000_00, targetWeightBp: 5_000 }),
    ]).rows;
    expect(row?.driftMinor).toBe(10_000_00);
  });

  it("says the plan is incomplete rather than drifting from half a plan", () => {
    const partial = allocationReport([
      product({ id: "gold", valueMinor: 50_00, targetWeightBp: 3_000 }),
      product({ id: "fund", valueMinor: 50_00 }),
    ]);
    expect(partial.untargetedCount).toBe(1);
    expect(partial.incompletePlan).toBe(true);
    expect(partial.rows[1]?.driftBp).toBeNull();
    expect(partial.rows[1]?.driftMinor).toBeNull();

    const overCommitted = allocationReport([
      product({ id: "gold", valueMinor: 50_00, targetWeightBp: 8_000 }),
      product({ id: "fund", valueMinor: 50_00, targetWeightBp: 8_000 }),
    ]);
    expect(overCommitted.targetedBp).toBe(16_000);
    expect(overCommitted.incompletePlan).toBe(true);
  });

  /** A fully sold product holds nothing and would dilute every other share. */
  it("measures only what is still held", () => {
    const report = allocationReport([
      product({ id: "gold", valueMinor: 100_00, targetWeightBp: FULL_ALLOCATION_BP }),
      product({ id: "sold", valueMinor: 0, active: false, targetWeightBp: 0 }),
    ]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.actualBp).toBe(FULL_ALLOCATION_BP);
    expect(report.incompletePlan).toBe(false);
  });

  it("survives an empty wallet without dividing by zero", () => {
    expect(allocationReport([])).toMatchObject({ totalMinor: 0, rows: [], totalDriftBp: 0, incompletePlan: false });
    const zeroed = allocationReport([product({ id: "gold", valueMinor: 0, targetWeightBp: 5_000 })]);
    expect(zeroed.rows[0]?.actualBp).toBe(0);
    expect(Number.isFinite(zeroed.totalDriftBp)).toBe(true);
  });

  /** The basis travels with the numbers so a surface cannot imply another one. */
  it("declares that the shares are book cost, not market value", () => {
    expect(allocationReport([product({ id: "gold", valueMinor: 1 })]).basis).toBe("cost");
  });

  it("refuses a target that is not a whole share between nothing and everything", () => {
    for (const value of [0, 1, 5_000, FULL_ALLOCATION_BP]) expect(isValidTargetWeightBp(value)).toBe(true);
    for (const value of [-1, 10_001, 1.5, NaN, "5000", null, undefined]) {
      expect(isValidTargetWeightBp(value), String(value)).toBe(false);
    }
  });

  it("formats a share the way the rest of the product writes numbers", () => {
    expect(formatBasisPoints(5_000)).toBe("%50");
    expect(formatBasisPoints(1_250)).toBe("%12,5");
    expect(formatBasisPoints(-320)).toBe("-%3,2");
    expect(formatBasisPoints(0)).toBe("%0");
    // Rounds to one decimal rather than showing a share nobody can act on.
    expect(formatBasisPoints(1_234)).toBe("%12,3");
  });
});
