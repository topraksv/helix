import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "../src/auth/auth-errors";
import { requestPasswordRecoveryEmail } from "../src/auth/email-flows";
import {
  loadPreviousLogin,
  recordSuccessfulLogin,
  seedCurrentLogin,
  startLoginHistory,
  type LoginHistoryStorage,
} from "../src/auth/login-history";
import {
  expoGoPreviewUrl,
  parsePasswordRecoveryUrl,
  passwordRecoveryRequestRedirect,
  webPasswordRecoveryRedirectUrl,
} from "../src/auth/recovery";
import { pendingChangesWouldBeLost, signOutWithLocalFallback } from "../src/auth/sign-out";
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

  it("uses the stable HTTPS recovery screen for Expo Go requests", () => {
    expect(passwordRecoveryRequestRedirect({ platform: "native" })).toBe(
      "https://topraksv.github.io/helix/reset-password",
    );
  });

  it("returns to the latest compatible Expo Go preview channel after recovery", () => {
    expect(expoGoPreviewUrl()).toBe(
      "exp://u.expo.dev/f71b0477-c800-45cc-903a-9b4d32a9c6b4?runtime-version=exposdk%3A54.0.0&channel-name=preview",
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

describe("password recovery e-mail request", () => {
  it("sends the normalized address with the explicit recovery callback", async () => {
    const calls: Array<{ email: string; redirectTo: string }> = [];
    const error = await requestPasswordRecoveryEmail(
      {
        resetPasswordForEmail: async (email, options) => {
          calls.push({ email, redirectTo: options.redirectTo });
          return { error: null };
        },
      },
      "  kisi@example.com ",
      "https://topraksv.github.io/helix/reset-password",
    );

    expect(error).toBeNull();
    expect(calls).toEqual([{
      email: "kisi@example.com",
      redirectTo: "https://topraksv.github.io/helix/reset-password",
    }]);
  });

  it("keeps unknown addresses indistinguishable from successful delivery", async () => {
    for (const message of ["User not found", "Email address not found"]) {
      const error = await requestPasswordRecoveryEmail(
        {
          resetPasswordForEmail: async () => ({ error: { message } }),
        },
        "unknown@example.com",
        "https://topraksv.github.io/helix/reset-password",
      );

      expect(error, message).toBeNull();
    }
  });

  it("still surfaces actionable network and rate-limit failures", async () => {
    const networkError = await requestPasswordRecoveryEmail(
      {
        resetPasswordForEmail: async () => ({ error: { message: "Failed to fetch" } }),
      },
      "kisi@example.com",
      "https://topraksv.github.io/helix/reset-password",
    );
    const rateLimitError = await requestPasswordRecoveryEmail(
      {
        resetPasswordForEmail: async () => ({ error: { message: "Request rate limit reached" } }),
      },
      "kisi@example.com",
      "https://topraksv.github.io/helix/reset-password",
    );

    expect(networkError).toBe(tr.auth.errNetwork);
    expect(rateLimitError).toBe(tr.auth.errRateLimit);
  });
});

describe("session sign-out", () => {
  /**
   * Supabase defaults `signOut()` to `scope: "global"`, which revokes every
   * refresh token the account holds. Leaving the scope implicit meant signing
   * out of the web app killed the phone: its refresh was rejected, the
   * invalidation path wiped that device — unsynced rows included — and
   * "Cihazlarını Güncelle" could only answer 401 until the user signed in
   * again. An ordinary sign-out ends THIS device's session and nothing else.
   */
  it("ends only this device's session by default", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      return { error: null };
    });
    expect(calls).toEqual(["local"]);
  });

  it("revokes every device only when the caller asks for it", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      return { error: null };
    }, "global");
    expect(calls).toEqual(["global"]);
  });

  it("falls back to a local revoke when a global sign-out returns an error", async () => {
    const calls: Array<string | undefined> = [];
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      return { error: options?.scope === "local" ? null : new Error("offline") };
    }, "global");
    expect(calls).toEqual(["global", "local"]);
  });

  it("retries locally when the local revoke itself fails", async () => {
    const calls: Array<string | undefined> = [];
    let first = true;
    await signOutWithLocalFallback(async (options) => {
      calls.push(options?.scope);
      if (first) {
        first = false;
        throw new Error("transport");
      }
      return { error: null };
    });
    // A persisted session that survives a failed revoke would silently reopen
    // the account on the next bootstrap.
    expect(calls).toEqual(["local", "local"]);
  });
});

describe("sign-out data safety", () => {
  it("lets a clean workspace sign out without a flush", async () => {
    let flushes = 0;
    const lost = await pendingChangesWouldBeLost({
      pendingCount: async () => 0,
      flush: async () => void flushes++,
    });
    expect(lost).toBe(false);
    expect(flushes).toBe(0);
  });

  it("flushes queued rows and allows the sign-out once they land", async () => {
    let pending = 3;
    const lost = await pendingChangesWouldBeLost({
      pendingCount: async () => pending,
      flush: async () => {
        pending = 0;
      },
    });
    expect(lost).toBe(false);
  });

  it("reports the loss when rows cannot reach the server", async () => {
    const lost = await pendingChangesWouldBeLost({
      pendingCount: async () => 2,
      flush: async () => {},
    });
    expect(lost).toBe(true);
  });

  it("treats a thrown flush as unsynced rather than as success", async () => {
    const lost = await pendingChangesWouldBeLost({
      pendingCount: async () => 1,
      flush: async () => {
        throw new Error("offline");
      },
    });
    expect(lost).toBe(true);
  });
});
