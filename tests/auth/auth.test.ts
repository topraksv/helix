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
    expect(friendlyAuthError("Error sending confirmation email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Error sending email change email")).toBe(tr.auth.errEmailDelivery);
    expect(friendlyAuthError("Unable to validate email address: invalid format")).toBe(tr.auth.errInvalidEmail);
  });

  it("maps expired sessions and server failures instead of a generic fallback", () => {
    expect(friendlyAuthError("Invalid Refresh Token: Refresh Token Not Found")).toBe(tr.auth.errSessionExpired);
    expect(friendlyAuthError("JWT expired")).toBe(tr.auth.errSessionExpired);
    // "password should be" is also inside Auth's same-password refusal; it must not read as weak.
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

  // A code, not a link: nothing a mail scanner fetches can spend it, it works
  // on whichever device reads the mail, and a link-free message is what spam
  // filters score lowest.
  it.each([
    ["confirmation", "Helix onay kodun"],
    ["recovery", "Helix şifre yenileme kodun"],
    ["email_change", "Helix e-posta değişikliği kodun"],
  ])("mails the %s as a five-minute code with no link, subject or body built to pass spam filters", (kind, subject) => {
    expect(config).toMatch(/^otp_expiry = 300$/m);
    expect(config).toMatch(new RegExp(`\\[auth\\.email\\.template\\.${kind}\\]\\nsubject = "${subject}"\\ncontent_path = "\\./supabase/templates/${kind}\\.html"$`, "m"));
    const template = readFileSync(join(process.cwd(), `supabase/templates/${kind}.html`), "utf8");
    expect(template).toContain("{{ .Token }}");
    expect(template).not.toMatch(/href=|<img|TokenHash|ConfirmationURL|&#(8199|65279|847);|Gital/);
  });

  it("asks both addresses of an e-mail change for a code of their own, and leaves no address to come back to", () => {
    expect(config).toMatch(/^double_confirm_changes = true$/m);
    expect(config).toMatch(/^additional_redirect_urls = \[\]$/m);
    const template = readFileSync(join(process.cwd(), "supabase/templates/email_change.html"), "utf8");
    expect(template).toContain("{{ .Email }}");
    expect(template).toContain("{{ .NewEmail }}");
  });
});

describe("password recovery e-mail request", () => {
  it("sends the normalized address alone: a code needs no page to come back to", async () => {
    const calls: unknown[][] = [];
    const error = await requestPasswordRecoveryEmail(
      {
        resetPasswordForEmail: async (...args) => {
          calls.push(args);
          return { error: null };
        },
      },
      "  kisi@example.com ",
    );

    expect(error).toBeNull();
    expect(calls).toEqual([["kisi@example.com"]]);
  });

  it("keeps unknown addresses indistinguishable from successful delivery", async () => {
    // Auth's wording varies; anything may stand between "user" and "not found".
    for (const message of ["User not found", "User with this address was not found", "Email address not found"]) {
      const error = await requestPasswordRecoveryEmail(
        {
          resetPasswordForEmail: async () => ({ error: { message } }),
        },
        "unknown@example.com",
      );

      expect(error, message).toBeNull();
    }
  });

  it.each([
    ["Failed to fetch", tr.auth.errNetwork],
    ["Request rate limit reached", tr.auth.errRateLimit],
    ["Email address not authorized", tr.auth.errEmailDelivery],
  ])("surfaces the actionable failure %s", async (message, expected) => {
    const error = await requestPasswordRecoveryEmail(
      { resetPasswordForEmail: async () => ({ error: { message } }) },
      "kisi@example.com",
    );
    expect(error).toBe(expected);
  });
});

describe("sign-up confirmation resend", () => {
  it("asks Auth for a new sign-up code to the trimmed address", async () => {
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

/** A sign-out client that records the scope of every call and answers with `answer`. */
function recordSignOut(answer: (scope: string | undefined) => { error: Error | null } = () => ({ error: null })) {
  const calls: Array<string | undefined> = [];
  const client = async (options?: { scope?: "local" | "global" | "others" }) => {
    calls.push(options?.scope);
    return answer(options?.scope);
  };
  return { calls, client };
}

describe("session sign-out", () => {
  // Supabase defaults `signOut()` to global scope, which would sign out every other device too.
  it("ends only this device's session by default", async () => {
    const { calls, client } = recordSignOut();
    await signOutWithLocalFallback(client);
    expect(calls).toEqual(["local"]);
  });

  it("revokes every device only when the caller asks for it", async () => {
    const { calls, client } = recordSignOut();
    await signOutWithLocalFallback(client, "global");
    expect(calls).toEqual(["global"]);
  });

  it("falls back to a local revoke when a global sign-out returns an error", async () => {
    const { calls, client } = recordSignOut((scope) => ({ error: scope === "local" ? null : new Error("offline") }));
    await signOutWithLocalFallback(client, "global");
    expect(calls).toEqual(["global", "local"]);
  });

  it("retries locally when the local revoke itself fails", async () => {
    let first = true;
    const { calls, client } = recordSignOut(() => {
      if (first) {
        first = false;
        throw new Error("transport");
      }
      return { error: null };
    });
    await signOutWithLocalFallback(client);
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
