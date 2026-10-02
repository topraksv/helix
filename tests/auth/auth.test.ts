import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "../../src/auth/auth-errors";
import { requestPasswordRecoveryEmail, resendSignUpConfirmation } from "../../src/auth/email-flows";
import {
  loadPreviousLogin,
  recordSuccessfulLogin,
  startLoginHistory,
  type LoginHistoryStorage,
} from "../../src/auth/login-history";
import {
  parseEmailLinkLanding,
  parsePasswordRecoveryUrl,
  passwordRecoveryRequestRedirect,
  webPasswordRecoveryRedirectUrl,
} from "../../src/auth/recovery";
import { pendingChangesWouldBeLost, signOutWithLocalFallback } from "../../src/auth/sign-out";
import { tr } from "../../src/i18n/tr";

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

  it("starts new accounts without a previous login", async () => {
    const storage = memoryStorage();
    await startLoginHistory(storage, "u1", "2026-07-15T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBeNull();
    expect(await recordSuccessfulLogin(storage, "u1", "2026-07-16T09:00:00.000Z")).toBe("2026-07-15T08:00:00.000Z");
    expect(await loadPreviousLogin(storage, "u1")).toBe("2026-07-15T08:00:00.000Z");
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
    expect(friendlyAuthError("Email address not authorized")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Error sending recovery email")).toBe(tr.auth.errEmailDelivery);
    // What Auth answers a sign-up when its SMTP refuses, measured on Gital's live project 2026-09-28.
    expect(friendlyAuthError("Error sending confirmation email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Error sending email change email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Unable to validate email address: invalid format")).toBe(tr.auth.errInvalidEmail);
  });

  it("maps expired sessions and server failures instead of a generic fallback", () => {
    expect(friendlyAuthError("Invalid Refresh Token: Refresh Token Not Found")).toBe(tr.auth.errSessionExpired);
    expect(friendlyAuthError("JWT expired")).toBe(tr.auth.errSessionExpired);
    // Auth's same-password refusal contains "password should be", which the
    // weak-password rule used to claim.
    expect(friendlyAuthError("New password should be different from the old password.")).toBe(tr.auth.errSamePassword);
    expect(friendlyAuthError("same_password")).toBe(tr.auth.errSamePassword);
    expect(friendlyAuthError("Internal Server Error")).toBe(tr.auth.errService);
    expect(friendlyAuthError("Error 503: Service Unavailable")).toBe(tr.auth.errService);
    expect(friendlyAuthError("something unexpected")).toBe(tr.auth.errGeneric);
  });
});

describe("server-side password policy", () => {
  const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");

  it("requires strong new passwords and current-password verification", () => {
    expect(config).toMatch(/^minimum_password_length = 8$/m);
    expect(config).toMatch(/^secure_password_change = true$/m);
    expect(config).toMatch(/\[auth\.email\][\s\S]*?^enable_confirmations = true$/m);
  });

  /**
   * The reset e-mail's link is the fix for two reported failures, so it is
   * held here rather than trusted to the dashboard. Auth's own verify endpoint
   * spends the token on the first GET and returns a PKCE code only the browser
   * that requested the reset can redeem: a link checker produced "the link has
   * expired" seconds after delivery, and a phone's mail app opened sign-in.
   */
  it("sends reset links that reach the app with the token unspent, for five minutes", () => {
    expect(config).toMatch(/^otp_expiry = 300$/m);
    expect(config).toMatch(/\[auth\.email\.template\.recovery\][\s\S]*?^content_path = "\.\/supabase\/templates\/recovery\.html"$/m);
    const template = readFileSync(join(process.cwd(), "supabase/templates/recovery.html"), "utf8");
    expect(template).toContain('href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery"');
    expect(template).not.toContain("{{ .ConfirmationURL }}");
  });

  /**
   * The same shape as the reset link, for a different reason. Auth's verify
   * endpoint confirmed on the first GET and handed back a PKCE code, and a
   * code only the signing-up browser can redeem proves nothing to any other:
   * the app said "confirmed" to any address carrying `?code=`, a forged one
   * included. A token hash is checked by Auth itself, from any browser.
   */
  it("sends sign-up confirmations to the app with a token Auth checks", () => {
    expect(config).toMatch(/\[auth\.email\.template\.confirmation\][\s\S]*?^content_path = "\.\/supabase\/templates\/confirmation\.html"$/m);
    const template = readFileSync(join(process.cwd(), "supabase/templates/confirmation.html"), "utf8");
    expect(template).toContain('href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"');
    expect(template).not.toContain("{{ .ConfirmationURL }}");
  });

  // Mailed to both addresses while double_confirm_changes is on; the verify GET confirms each.
  it("sends an e-mail change through Auth's own verify link, naming both addresses", () => {
    expect(config).toMatch(/\[auth\.email\.template\.email_change\][\s\S]*?^content_path = "\.\/supabase\/templates\/email_change\.html"$/m);
    const template = readFileSync(join(process.cwd(), "supabase/templates/email_change.html"), "utf8");
    expect(template).toContain('href="{{ .ConfirmationURL }}"');
    expect(template).toContain("{{ .Email }}");
    expect(template).toContain("{{ .NewEmail }}");
    expect(template).not.toContain("{{ .TokenHash }}");
  });
});

describe("password recovery links", () => {
  const webTarget = { platform: "web" as const, origin: "https://topraksv.github.io", baseUrl: "/helix" };
  const nativeTarget = { platform: "native" as const, scheme: "helix" };

  it("keeps the Expo Router base path in the web redirect", () => {
    expect(webPasswordRecoveryRedirectUrl("https://topraksv.github.io", "/helix")).toBe(
      "https://topraksv.github.io/helix/reset-password",
    );
    expect(webPasswordRecoveryRedirectUrl("https://example.com", "/nested//path/")).toBe(
      "https://example.com/nested/path/reset-password",
    );
  });

  it("uses the stable HTTPS recovery screen for Expo Go requests", () => {
    expect(passwordRecoveryRequestRedirect({ platform: "native" })).toBe(
      "https://topraksv.github.io/helix/reset-password",
    );
    expect(passwordRecoveryRequestRedirect({
      platform: "web",
      origin: "https://example.com",
      baseUrl: "/preview",
    })).toBe("https://example.com/preview/reset-password");
  });

  it("holds the unspent token link the reset e-mail carries, and only for recovery", () => {
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?token_hash=pkce_abc&type=recovery", webTarget))
      .toEqual({ kind: "tokenHash", tokenHash: "pkce_abc" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?token_hash=abc&type=signup", webTarget))
      .toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?token_hash=abc", webTarget))
      .toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("https://attacker.example/helix/reset-password?token_hash=abc&type=recovery", webTarget))
      .toEqual({ kind: "invalid" });
    // An error Auth attached still wins over a token beside it.
    expect(parsePasswordRecoveryUrl("https://topraksv.github.io/helix/reset-password?token_hash=abc&type=recovery&error_code=otp_expired", webTarget))
      .toEqual({ kind: "expired" });
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
      "helix://evil/reset-password?code=stolen",
    ]) {
      const target = url.startsWith("helix:") ? nativeTarget : webTarget;
      expect(parsePasswordRecoveryUrl(url, target), url).toEqual({ kind: "invalid" });
    }
    expect(parsePasswordRecoveryUrl("other://reset-password?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("helix://other?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
  });

  it("rejects malformed targets and URLs containing authority credentials", () => {
    expect(parsePasswordRecoveryUrl(null, webTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("not a URL", webTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl(
      "https://topraksv.github.io/helix/reset-password?code=one-time-code",
      { ...webTarget, origin: "not an origin" },
    )).toEqual({ kind: "invalid" });
    for (const authority of ["user@", "user:secret@", ":secret@"] as const) {
      expect(parsePasswordRecoveryUrl(
        `https://${authority}topraksv.github.io/helix/reset-password?code=stolen`,
        webTarget,
      ), authority).toEqual({ kind: "invalid" });
    }
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
    expect(parsePasswordRecoveryUrl("helix://reset-password/?code=with-slash", nativeTarget)).toEqual({
      kind: "code",
      code: "with-slash",
    });
    expect(parsePasswordRecoveryUrl("helix://reset-password/other?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl("helix:///other?code=stolen", nativeTarget)).toEqual({ kind: "invalid" });
  });

  it("requires complete recovery tokens and handles each Supabase error channel", () => {
    for (const fragment of [
      "access_token=access&type=recovery",
      "refresh_token=refresh&type=recovery",
    ]) {
      expect(parsePasswordRecoveryUrl(`helix://reset-password#${fragment}`, nativeTarget)).toEqual({ kind: "invalid" });
    }
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password?error_description=OTP+expired",
      nativeTarget,
    )).toEqual({ kind: "expired" });
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password?error=access_denied",
      nativeTarget,
    )).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password?error_code=access_denied",
      nativeTarget,
    )).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password?error=access_denied&code=must-not-be-exchanged",
      nativeTarget,
    )).toEqual({ kind: "invalid" });
    expect(parsePasswordRecoveryUrl(
      "helix://reset-password?error_code=access_denied&code=must-not-be-exchanged",
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

  it("does not report success when the project's mail transport rejects delivery", async () => {
    const error = await requestPasswordRecoveryEmail(
      {
        resetPasswordForEmail: async () => ({ error: { message: "Email address not authorized" } }),
      },
      "kisi@example.com",
      "https://topraksv.github.io/helix/reset-password",
    );

    expect(error).toBe(tr.auth.errEmailDelivery);
  });
});

/**
 * What a sign-up confirmation link carries back to the Site URL. Only Auth can
 * say whether it confirmed anything, so the parser reports what to ask it, and
 * a bare `code` — which no browser but the one that signed up can redeem —
 * is not read as an answer.
 */
describe("e-mail link landings on the Site URL", () => {
  const site = "https://topraksv.github.io/helix/";

  it("hands a confirmation token on to be checked", () => {
    expect(parseEmailLinkLanding(`${site}?token_hash=pkce_0b6f&type=email`)).toEqual({ tokenHash: "pkce_0b6f" });
    expect(parseEmailLinkLanding(`${site}#token_hash=pkce_0b6f&type=email`)).toEqual({ tokenHash: "pkce_0b6f" });
  });

  it("reads Auth's error, in the query or the fragment, as a link that no longer works", () => {
    expect(parseEmailLinkLanding(`${site}?error=access_denied&error_code=otp_expired`)).toBe("unusable");
    expect(parseEmailLinkLanding(`${site}#error_code=otp_expired&error_description=Email+link+is+invalid`)).toBe("unusable");
    expect(parseEmailLinkLanding(`${site}#error=server_error`)).toBe("unusable");
    expect(parseEmailLinkLanding(`${site}?token_hash=pkce_0b6f&type=email&error=access_denied`)).toBe("unusable");
  });

  it("claims nothing it cannot prove", () => {
    expect(parseEmailLinkLanding(`${site}?code=0b6f`)).toBeNull();
    expect(parseEmailLinkLanding(`${site}?token_hash=pkce_0b6f`)).toBeNull();
    expect(parseEmailLinkLanding(`${site}?token_hash=pkce_0b6f&type=recovery`)).toBeNull();
    expect(parseEmailLinkLanding(`${site}?token_hash=&type=email`)).toBeNull();
    expect(parseEmailLinkLanding(site)).toBeNull();
    expect(parseEmailLinkLanding(`${site}?tab=durum`)).toBeNull();
    expect(parseEmailLinkLanding("not a url")).toBeNull();
  });

  it("leaves reset links to the reset screen", () => {
    expect(parseEmailLinkLanding(`${site}reset-password?token_hash=pkce_0b6f&type=email`)).toBeNull();
    expect(parseEmailLinkLanding(`${site}reset-password/#error_code=otp_expired`)).toBeNull();
    // Only the reset screen itself: a path that merely passes through the name
    // is not it.
    expect(parseEmailLinkLanding(`${site}reset-password/done?token_hash=pkce_0b6f&type=email`)).toEqual({ tokenHash: "pkce_0b6f" });
  });
});

describe("sign-up confirmation resend", () => {
  it("asks Auth for a new sign-up link to the trimmed address", async () => {
    const calls: unknown[] = [];
    const error = await resendSignUpConfirmation(
      { resend: async (request) => { calls.push(request); return { error: null }; } },
      "  kisi@example.com ",
    );
    expect(error).toBeNull();
    expect(calls).toEqual([{ type: "signup", email: "kisi@example.com" }]);
  });

  it("names Auth's wait-before-retrying answer as a rate limit", async () => {
    const error = await resendSignUpConfirmation(
      { resend: async () => ({ error: { message: "For security purposes, you can only request this after 42 seconds." } }) },
      "kisi@example.com",
    );
    expect(error).toBe(tr.auth.errRateLimit);
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
