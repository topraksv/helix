import { describe, expect, it } from "vitest";
import { classifyOutboxBatch, remoteWinsLww, shouldApplyServerAck } from "../src/sync/merge-policy";

describe("sync merge policy", () => {
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
});
