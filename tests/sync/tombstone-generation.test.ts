import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveTombstoneVersion } from "../../src/sync/tombstone-policy";

const PROPERTY_SEED = 20_260_812;

describe("tombstone generations", () => {
  it("increments exactly once for a delete and preserves that generation for undo", () => {
    const deleted = resolveTombstoneVersion(
      { deletedAt: null, tombstoneVersion: 3 },
      "2026-07-22T08:00:00.000Z",
      3,
    );
    expect(deleted).toBe(4);
    expect(resolveTombstoneVersion(
      { deletedAt: "2026-07-22T08:00:00.000Z", tombstoneVersion: deleted },
      null,
      3,
    )).toBe(4);
  });

  it("marks an imported/new tombstone and never lowers an observed generation", () => {
    expect(resolveTombstoneVersion(null, "2026-07-22T08:00:00.000Z", 0)).toBe(1);
    expect(resolveTombstoneVersion(null, "2026-07-22T08:00:00.000Z", 4)).toBe(4);
    expect(resolveTombstoneVersion(
      { deletedAt: null, tombstoneVersion: 5 },
      null,
      0,
    )).toBe(5);
  });
});

describe("tombstone generation properties", () => {
  it("never moves backwards", () => {
    // Sync merges compare generations. A version that can decrease lets a
    // resurrected row win against its own delete.
    fc.assert(
      fc.property(
        fc.record({ deletedAt: fc.option(fc.constant("2026-01-01T00:00:00.000Z"), { nil: null }), tombstoneVersion: fc.nat({ max: 50 }) }),
        fc.option(fc.constant("2026-02-01T00:00:00.000Z"), { nil: null }),
        fc.nat({ max: 50 }),
        (existing, requestedDeletedAt, requestedVersion) => {
          const next = resolveTombstoneVersion(existing, requestedDeletedAt, requestedVersion);
          expect(next).toBeGreaterThanOrEqual(existing.tombstoneVersion);
          expect(next).toBeGreaterThanOrEqual(requestedVersion);
        },
      ),
      { numRuns: 500, seed: PROPERTY_SEED },
    );
  });

  it("advances exactly one generation when a live row is deleted", () => {
    fc.assert(
      fc.property(fc.nat({ max: 50 }), fc.nat({ max: 50 }), (existingVersion, requestedVersion) => {
        const next = resolveTombstoneVersion(
          { deletedAt: null, tombstoneVersion: existingVersion },
          "2026-02-01T00:00:00.000Z",
          requestedVersion,
        );
        expect(next).toBe(Math.max(existingVersion, requestedVersion) + 1);
      }),
      { numRuns: 300, seed: PROPERTY_SEED },
    );
  });
});
