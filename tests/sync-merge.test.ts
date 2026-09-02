import { describe, expect, it } from "vitest";
import {
  classifyOutboxBatch,
  cursorIsAtServerHead,
  formatPullCursor,
  isUuidShaped,
  parsePullCursor,
  PULL_EPOCH,
  remoteWinsLww,
  shouldApplyServerAck,
} from "../src/sync/merge-policy";
import { classifyRefreshFailure, completedSyncState } from "../src/sync/status";

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

  it("accepts equal server timestamps for idempotent convergence", () => {
    const stamp = "2026-07-15T10:00:00.000Z";
    expect(remoteWinsLww(stamp, stamp)).toBe(true);
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

/**
 * A failed token refresh has two completely different meanings and the engine
 * used to give them one answer.
 *
 * `tryRefreshSession` returned a bare boolean, so "the refresh token was
 * revoked" and "we could not reach the auth service at all" both became
 * `false`. Both then produced "Eşitleme için tekrar giriş yapman gerekiyor" AND
 * stopped the retry backoff — telling a user whose session is perfectly valid,
 * and who is simply in a tunnel, to go and sign in again at a login screen they
 * cannot reach either. Only an answer FROM the auth service can retire a
 * session; silence from the network is a network problem.
 */
describe("token refresh failure classification", () => {
  it("treats an unreachable auth service as a network problem, not a dead session", () => {
    // supabase-js's own class for a transport failure.
    const retryable = new Error("Failed to fetch");
    retryable.name = "AuthRetryableFetchError";
    expect(classifyRefreshFailure(retryable)).toBe("unavailable");
    expect(classifyRefreshFailure(new Error("network request failed"))).toBe("unavailable");
    expect(classifyRefreshFailure(new Error("timeout of 10000ms exceeded"))).toBe("unavailable");
    expect(classifyRefreshFailure(new Error("Gateway Timeout (504)"))).toBe("unavailable");
  });

  it("retires the session only when the service actually answered", () => {
    expect(classifyRefreshFailure(new Error("Invalid Refresh Token: Already Used"))).toBe("expired");
    expect(classifyRefreshFailure(new Error("refresh_token_not_found"))).toBe("expired");
    // An unrecognised answer still came FROM the service, so it is treated as a
    // real refusal rather than optimistically retried forever.
    expect(classifyRefreshFailure(new Error("something else"))).toBe("expired");
    expect(classifyRefreshFailure(null)).toBe("expired");
  });
});

/**
 * What lets a sync skip a table without asking PostgREST for a page.
 *
 * The risk this covers is asymmetric: skipping a table that HAS moved omits a
 * row until something else happens to move that table, which on an
 * offline-first ledger is indistinguishable from losing it. Pulling a table
 * that has not moved costs one empty page. So every case that is not provably
 * "the cursor is standing on the newest row" must pull.
 */
describe("pull cursor policy", () => {
  const HEAD = { ts: "2026-09-02T10:00:00.000Z", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

  it("round-trips the stored keyset and reads a legacy cursor as having no id", () => {
    expect(parsePullCursor(formatPullCursor(HEAD))).toEqual(HEAD);
    expect(parsePullCursor("2026-09-02T10:00:00.000Z")).toEqual({ ts: "2026-09-02T10:00:00.000Z", id: "" });
    expect(parsePullCursor(null)).toEqual({ ts: PULL_EPOCH, id: "" });
    expect(parsePullCursor("")).toEqual({ ts: PULL_EPOCH, id: "" });
  });

  it("skips only a table whose newest row is the one the cursor stands on", () => {
    expect(cursorIsAtServerHead(HEAD, HEAD)).toBe(true);
    // Server has nothing for this user: there is no page to fetch.
    expect(cursorIsAtServerHead(HEAD, null)).toBe(true);
  });

  it("pulls whenever the head is a different row, in either direction", () => {
    const otherId = { ...HEAD, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(cursorIsAtServerHead(HEAD, otherId)).toBe(false);
    expect(cursorIsAtServerHead(HEAD, { ...HEAD, ts: "2026-09-02T10:00:01.000Z" })).toBe(false);
    // A cursor ahead of the head is not evidence of anything; pull and let the
    // keyset filter decide.
    expect(cursorIsAtServerHead({ ...HEAD, ts: "2026-09-02T11:00:00.000Z" }, HEAD)).toBe(false);
  });

  it("pulls a table this device has never pulled", () => {
    expect(cursorIsAtServerHead(parsePullCursor(null), HEAD)).toBe(false);
  });

  it("pulls a legacy cursor, which cannot prove which row it stands on", () => {
    expect(cursorIsAtServerHead({ ts: HEAD.ts, id: "" }, HEAD)).toBe(false);
  });

  it("pulls rather than trusting an unparseable timestamp on either side", () => {
    expect(cursorIsAtServerHead(HEAD, { ...HEAD, ts: "not a date" })).toBe(false);
    expect(cursorIsAtServerHead({ ...HEAD, ts: "not a date" }, HEAD)).toBe(false);
  });

  it("does not let sub-millisecond precision hide a newer row", () => {
    // Postgres keeps updated_at to microseconds; the stored cursor is an
    // ISO string truncated to milliseconds. A "head is not greater than the
    // cursor" test would compare these equal and skip the table forever.
    const microsecondsLater = { ts: "2026-09-02T10:00:00.000Z", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(cursorIsAtServerHead(HEAD, microsecondsLater)).toBe(false);
  });
});
