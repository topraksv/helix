import { describe, expect, it } from "vitest";
import { resolveTombstoneVersion } from "../src/sync/tombstone-policy";
import { remoteWinsLww } from "../src/sync/merge-policy";

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

  it("makes generation precedence immune to a stale client's future clock", () => {
    expect(remoteWinsLww(
      "2026-07-22T08:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
      4,
      3,
    )).toBe(false);
  });
});
