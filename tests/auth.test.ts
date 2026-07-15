import { describe, expect, it } from "vitest";
import {
  loadPreviousLogin,
  recordSuccessfulLogin,
  seedCurrentLogin,
  startLoginHistory,
  type LoginHistoryStorage,
} from "../src/auth/login-history";
import { parsePasswordRecoveryUrl, webPasswordRecoveryRedirectUrl } from "../src/auth/recovery";

function memoryStorage(): LoginHistoryStorage {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
  };
}

describe("successful login history", () => {
  it("shows the prior successful login across two sign-in/sign-out cycles", async () => {
    const storage = memoryStorage();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-07-15T08:00:00.000Z")).toBeNull();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-07-15T10:30:00.000Z")).toBe("2026-07-15T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBe("2026-07-15T08:00:00.000Z");
  });

  it("does not advance on a cold start and starts new accounts without a previous login", async () => {
    const storage = memoryStorage();
    await startLoginHistory(storage, "u1", "2026-07-15T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBeNull();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-07-16T09:00:00.000Z")).toBe("2026-07-15T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBe("2026-07-15T08:00:00.000Z");
  });

  it("seeds an existing mid-session user only once", async () => {
    const storage = memoryStorage();
    await seedCurrentLogin(storage, "u1", "2026-07-15T08:00:00.000Z");
    await seedCurrentLogin(storage, "u1", "2026-07-15T09:00:00.000Z");
    expect(await recordSuccessfulLogin(storage, "u1", "2026-07-16T10:00:00.000Z")).toBe("2026-07-15T08:00:00.000Z");
  });
});

describe("password recovery links", () => {
  it("keeps the Expo Router base path in the web redirect", () => {
    expect(webPasswordRecoveryRedirectUrl("https://topraksv.github.io", "/helix")).toBe(
      "https://topraksv.github.io/helix/reset-password",
    );
  });

  it("parses web PKCE codes and native token deep links", () => {
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?code=one-time-code")).toEqual({
      kind: "code",
      code: "one-time-code",
    });
    expect(parsePasswordRecoveryUrl("helix://reset-password#access_token=access&refresh_token=refresh&type=recovery")).toEqual({
      kind: "tokens",
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("distinguishes expired links and rejects invalid or reused links", () => {
    expect(parsePasswordRecoveryUrl("helix://reset-password?error=access_denied&error_code=otp_expired")).toEqual({ kind: "expired" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?error=access_denied&error_description=Link+already+used")).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password")).toEqual({ kind: "invalid" });
  });
});
