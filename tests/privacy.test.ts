/**
 * What the sensitive-UI cover actually decides, called rather than read.
 *
 * The source-text half of this file moved to `privacy-wiring.test.ts` on
 * 2026-09-09. It had to: those assertions cannot run against an instrumented
 * copy, so `vitest.mutation.config.mts` excluded the whole file — and took
 * these three with it. `src/domain/privacy.ts` scored 0 in the mutation gate
 * as a result, which reads as "unguarded" when the truth was "its guards were
 * excluded by association".
 */
import { describe, expect, it } from "vitest";
import { shouldCoverSensitiveUi } from "../src/domain/privacy";

describe("sensitive UI cover policy", () => {
  it("covers native inactive and background snapshots", () => {
    expect(shouldCoverSensitiveUi("ios", "inactive", false)).toBe(true);
    expect(shouldCoverSensitiveUi("android", "background", false)).toBe(true);
    expect(shouldCoverSensitiveUi("ios", "active", false)).toBe(false);
  });

  it("does not interrupt native password-manager biometrics before sign-in", () => {
    expect(shouldCoverSensitiveUi("ios", "inactive", false, false)).toBe(false);
    expect(shouldCoverSensitiveUi("ios", "inactive", false, true)).toBe(true);
  });

  it("blocks framed web UI without hiding a direct page", () => {
    expect(shouldCoverSensitiveUi("web", "active", true)).toBe(true);
    expect(shouldCoverSensitiveUi("web", "active", false)).toBe(false);
  });
});
