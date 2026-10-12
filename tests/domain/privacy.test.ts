/** What the sensitive-UI cover decides, called rather than read; the source-text half is in tests/repo/privacy-wiring.test.ts, outside the mutation exclusion. */
import { describe, expect, it } from "vitest";
import { shouldCoverSensitiveUi } from "../../src/domain/privacy";

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
