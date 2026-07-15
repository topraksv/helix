import { describe, expect, it } from "vitest";
import { SessionEpoch, SessionEpochCancelledError } from "../src/sync/session-epoch";

describe("session epoch", () => {
  it("keeps the same user's active epoch stable", () => {
    const epoch = new SessionEpoch();
    const first = epoch.start("user-a");
    const second = epoch.start("user-a");

    expect(second.epoch).toBe(first.epoch);
    expect(second.signal).toBe(first.signal);
    expect(epoch.isCurrent(first)).toBe(true);
  });

  it("invalidates and aborts the old user when an account changes", () => {
    const epoch = new SessionEpoch();
    const oldUser = epoch.start("user-a");
    const newUser = epoch.start("user-b");

    expect(oldUser.signal.aborted).toBe(true);
    expect(epoch.isCurrent(oldUser)).toBe(false);
    expect(epoch.isCurrent(newUser)).toBe(true);
    expect(() => epoch.assertCurrent(oldUser)).toThrow(SessionEpochCancelledError);
  });

  it("does not let a late callback reactivate a stopped session", () => {
    const epoch = new SessionEpoch();
    const token = epoch.start("user-a");
    epoch.stop("user-a");

    expect(token.signal.aborted).toBe(true);
    expect(epoch.capture("user-a")).toBeNull();
    expect(epoch.isCurrent(token)).toBe(false);
  });
});
