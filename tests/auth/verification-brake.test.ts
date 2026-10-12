// Keyed to its owner, so no session transition needs an explicit reset.

import { describe, expect, it } from "vitest";

import {
  IDLE_BRAKE,
  isVerificationBlocked,
  recordVerificationFailure,
  recordVerificationSuccess,
  VERIFY_COOLDOWN_MS,
  VERIFY_MAX_FAILURES,
  type VerificationBrake,
} from "../../src/auth/verification-brake";

const A = "user-a";
const B = "user-b";
const T0 = 1_000_000;

/** Drive `count` consecutive failures for one user. */
function fail(brake: VerificationBrake, userId: string, count: number, now = T0): VerificationBrake {
  let next = brake;
  for (let i = 0; i < count; i++) next = recordVerificationFailure(next, userId, now);
  return next;
}

describe("verification brake — single account", () => {
  it("does not block before the failure limit", () => {
    const brake = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES - 1);
    expect(isVerificationBlocked(brake, A, T0)).toBe(false);
  });

  it("blocks for the cooldown once the limit is reached", () => {
    const brake = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    expect(isVerificationBlocked(brake, A, T0)).toBe(true);
    expect(isVerificationBlocked(brake, A, T0 + VERIFY_COOLDOWN_MS - 1)).toBe(true);
    expect(isVerificationBlocked(brake, A, T0 + VERIFY_COOLDOWN_MS)).toBe(false);
  });

  it("restarts the streak after engaging, so the next block needs a full run", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    const afterCooldown = T0 + VERIFY_COOLDOWN_MS;
    const oneMore = recordVerificationFailure(engaged, A, afterCooldown);
    expect(isVerificationBlocked(oneMore, A, afterCooldown)).toBe(false);
  });

  it("clears the streak and any cooldown on success", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    const cleared = recordVerificationSuccess(engaged, A);
    expect(cleared).toEqual({ userId: null, failures: 0, blockedUntil: 0 });
    expect(isVerificationBlocked(cleared, A, T0)).toBe(false);
  });
});

describe("verification brake — account transitions", () => {
  it("never blocks a DIFFERENT user, whatever the previous streak was", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    expect(isVerificationBlocked(engaged, A, T0)).toBe(true);
    expect(isVerificationBlocked(engaged, B, T0)).toBe(false);
  });

  it("does not carry A's failure count into B's streak", () => {
    const almost = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES - 1);
    // One failure as B must be B's FIRST, not A's fifth.
    const bFirst = recordVerificationFailure(almost, B, T0);
    expect(isVerificationBlocked(bFirst, B, T0)).toBe(false);
    expect(bFirst.userId).toBe(B);
    expect(bFirst.failures).toBe(1);
  });

  it("does not inherit A's pending cooldown when B starts failing", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    const bFirst = recordVerificationFailure(engaged, B, T0);
    expect(bFirst.blockedUntil).toBe(0);
    expect(isVerificationBlocked(bFirst, B, T0)).toBe(false);
  });

  it("B's success does not clear A's cooldown", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    const afterB = recordVerificationSuccess(engaged, B);
    expect(isVerificationBlocked(afterB, A, T0)).toBe(true);
  });

  it("survives a return to A after B used the app", () => {
    const engaged = fail(IDLE_BRAKE, A, VERIFY_MAX_FAILURES);
    const bTook = recordVerificationFailure(engaged, B, T0);
    // A's streak is gone because the brake now belongs to B — A starts clean.
    expect(isVerificationBlocked(bTook, A, T0)).toBe(false);
  });
});
