import { describe, expect, it } from "vitest";
import { classifyOutboxBatch, isUuidShaped, remoteWinsLww, shouldApplyServerAck } from "../src/sync/merge-policy";
import { completedSyncState } from "../src/sync/status";

describe("sync merge policy", () => {
  it("never reports a completed sync as healthy while quarantined rows remain", () => {
    expect(completedSyncState(0)).toBe("idle");
    expect(completedSyncState(1)).toBe("attention");
  });

  it("keeps the newest valid event per row and quarantines invalid ownership", () => {
    const result = classifyOutboxBatch(
      [
        { id: 1, row_id: "a", payload: JSON.stringify({ id: "a", user_id: "u1", value: 1 }) },
        { id: 2, row_id: "a", payload: JSON.stringify({ id: "a", user_id: "u1", value: 2 }) },
        { id: 3, row_id: "a", payload: "{" },
        { id: 4, row_id: "c", payload: JSON.stringify({ id: "c", user_id: "u2" }) },
        { id: 5, row_id: "d", payload: JSON.stringify({ id: "d", user_id: "u1", value: 1 }) },
        { id: 6, row_id: "d", payload: JSON.stringify({ id: "d", user_id: "u1", value: 2 }) },
      ],
      "u1",
    );

    expect(result.latestByRow.has("a")).toBe(false);
    expect(result.latestByRow.get("d")?.row.value).toBe(2);
    expect(result.rejected.map((event) => event.reason)).toEqual(["malformed_payload", "wrong_user"]);
  });

  it("does not apply a server acknowledgement over a newer local edit", () => {
    expect(shouldApplyServerAck(8, 9)).toBe(false);
    expect(shouldApplyServerAck(8, 8)).toBe(true);
    expect(shouldApplyServerAck(8, null)).toBe(true);
  });

  it("lets a valid remote timestamp repair a corrupt local clock value", () => {
    expect(remoteWinsLww("not-a-date", "2026-07-15T10:00:00.000Z")).toBe(true);
    expect(remoteWinsLww("2099-01-01T00:00:00.000Z", "2026-07-15T10:00:00.000Z")).toBe(false);
    expect(remoteWinsLww(null, "2026-07-15T10:00:00.000Z")).toBe(true);
  });

  it("never lets a newer stale-client clock resurrect an older delete generation", () => {
    expect(remoteWinsLww(
      "2026-07-15T10:00:00.000Z",
      "2099-01-01T00:00:00.000Z",
      2,
      1,
    )).toBe(false);
    expect(remoteWinsLww(
      "2099-01-01T00:00:00.000Z",
      "2026-07-15T10:00:00.000Z",
      1,
      2,
    )).toBe(true);
  });

  it("accepts only UUID-shaped row ids for the pull cursor", () => {
    expect(isUuidShaped("019f6bba-2c65-7ea8-a6c9-96d891155e83")).toBe(true); // UUIDv7
    expect(isUuidShaped("a1b2c3d4-e5f6-8a7b-8c9d-0e1f2a3b4c5d")).toBe(true); // deterministic v8 nibble
    expect(isUuidShaped("A1B2C3D4-E5F6-8A7B-8C9D-0E1F2A3B4C5D")).toBe(true); // case-insensitive
    expect(isUuidShaped("x),user_id.eq.attacker")).toBe(false); // filter-grammar injection
    expect(isUuidShaped("019f6bba2c657ea8a6c996d891155e83")).toBe(false); // missing hyphens
    expect(isUuidShaped(42)).toBe(false);
    expect(isUuidShaped(null)).toBe(false);
  });
});
