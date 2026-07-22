import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "../src/auth/auth-errors";
import {
  loadPreviousLogin,
  recordSuccessfulLogin,
  seedCurrentLogin,
  startLoginHistory,
  type LoginHistoryStorage,
} from "../src/auth/login-history";
import { parsePasswordRecoveryUrl, webPasswordRecoveryRedirectUrl } from "../src/auth/recovery";
import { signOutWithLocalFallback } from "../src/auth/sign-out";
import { tr } from "../src/i18n/tr";

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

describe("friendly auth errors", () => {
  it("maps the distinct Supabase failure families to their own Turkish messages", () => {
    expect(friendlyAuthError("Invalid login credentials")).toBe(tr.auth.errInvalidCredentials);
    expect(friendlyAuthError("User already registered")).toBe(tr.auth.errUserExists);
    expect(friendlyAuthError("Request rate limit reached")).toBe(tr.auth.errRateLimit);
    expect(friendlyAuthError("TypeError: Network request failed")).toBe(tr.auth.errNetwork);
    expect(friendlyAuthError("Failed to fetch")).toBe(tr.auth.errNetwork);
    expect(friendlyAuthError("Password should be at least 6 characters")).toBe(tr.auth.errWeakPassword);
    expect(friendlyAuthError("Email not confirmed")).toBe(tr.auth.errEmailNotConfirmed);
    expect(friendlyAuthError("Unable to validate email address: invalid format")).toBe(tr.auth.errInvalidEmail);
  });

  it("maps expired sessions and server failures instead of a generic fallback", () => {
    expect(friendlyAuthError("Invalid Refresh Token: Refresh Token Not Found")).toBe(tr.auth.errSessionExpired);
    expect(friendlyAuthError("JWT expired")).toBe(tr.auth.errSessionExpired);
    expect(friendlyAuthError("Internal Server Error")).toBe(tr.auth.errService);
    expect(friendlyAuthError("Error 503: Service Unavailable")).toBe(tr.auth.errService);
    expect(friendlyAuthError("something unexpected")).toBe(tr.auth.errGeneric);
  });
});

describe("password recovery links", () => {
  const webTarget = { platform: "web" as const, origin: "https://topraksv.github.io", baseUrl: "/helix" };
  const nativeTarget = { platform: "native" as const, scheme: "helix" };

  it("keeps the Expo Router base path in the web redirect", () => {
    expect(webPasswordRecoveryRedirectUrl("https://topraksv.github.io", "/helix")).toBe(
      "https://topraksv.github.io/helix/reset-password",
    );
  });

  it("parses web PKCE codes and native token deep links", () => {
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?code=one-time-code", webTarget)).toEqual({
      kind: "code",
      code: "one-time-code",
    });
    expect(parsePasswordRecoveryUrl("helix://reset-password#access_token=access&refresh_token=refresh&type=recovery", nativeTarget)).toEqual({
      kind: "tokens",
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("distinguishes expired links and rejects invalid or reused links", () => {
    expect(parsePasswordRecoveryUrl("helix://reset-password?error=access_denied&error_code=otp_expired", nativeTarget)).toEqual({ kind: "expired" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?error=access_denied&error_description=Link+already+used", webTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password", webTarget)).toEqual({ kind: "invalid" });
  });

  it("rejects recovery credentials on a modified host, scheme or route", () => {
    for (const url of [
      "https://evil.example/helix/reset-password?code=stolen",
      "https://topraksv.github.io/reset-password?code=wrong-base",
      "https://topraksv.github.io/helix/other?code=wrong-route",
      "javascript://reset-password?code=script",
    ]) {
      expect(parsePasswordRecoveryUrl(url, webTarget), url).toEqual({ kind: "invalid" });
    }
    expect(parsePasswordRecoveryUrl("other://reset-password?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("helix://other?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
  });

  it("accepts native triple-slash callbacks but rejects non-recovery token links", () => {
    expect(parsePasswordRecoveryUrl("helix:///reset-password?code=one-time-code", nativeTarget)).toEqual({
      kind: "code",
      code: "one-time-code",
    });
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password#access_token=access&refresh_token=refresh&type=signup",
      nativeTarget,
    )).toEqual({ kind: "invalid" });
  });
});

describe("session sign-out", () => {
  it("falls back to a local revoke when global sign-out returns an error", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      return { error: options?.scope === "local" ? null : new Error("offline") };
    });
    expect(calls).toEqual([undefined, "local"]);
  });

  it("does not repeat a successful global sign-out", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      return { error: null };
    });
    expect(calls).toEqual([undefined]);
  });

  it("also falls back when global sign-out throws", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      if (!options) throw new Error("transport");
      return { error: null };
    });
    expect(calls).toEqual([undefined, "local"]);
  });
});
