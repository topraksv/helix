/** Pure password-recovery deep-link parsing for web and native URLs. */

type RecoveryLink =
  | { kind: "tokenHash"; tokenHash: string }
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "expired" }
  | { kind: "invalid" };

type RecoveryTarget =
  | { platform: "web"; origin: string; baseUrl: string }
  | { platform: "native"; scheme: string };

const PRODUCTION_WEB_ORIGIN = "https://topraksv.github.io";
const PRODUCTION_WEB_BASE_URL = "/helix";

/** Expo Linking does not add Router's web base path to createURL(). */
export function webPasswordRecoveryRedirectUrl(origin: string, baseUrl: string): string {
  const normalizedBase = `/${baseUrl}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return new URL(`${normalizedBase}/reset-password`, origin).toString();
}

/**
 * Expo Go's callback URL is reissued with the client, so it cannot be registered as a redirect target:
 * every native request returns to the hosted HTTPS recovery screen, which finishes in a phone browser
 * without forwarding the credentials.
 */
export function passwordRecoveryRequestRedirect(
  runtime:
    | { platform: "web"; origin: string; baseUrl: string }
    | { platform: "native" },
): string {
  return runtime.platform === "web"
    ? webPasswordRecoveryRedirectUrl(runtime.origin, runtime.baseUrl)
    : webPasswordRecoveryRedirectUrl(PRODUCTION_WEB_ORIGIN, PRODUCTION_WEB_BASE_URL);
}

/** Recovery credentials are bearer material: accepted only on the exact callback target the app generated. */
function expectedRecoveryUrl(url: string | null, target: RecoveryTarget): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.port) return null;
  if (target.platform === "web") {
    let expected: URL;
    try {
      expected = new URL(webPasswordRecoveryRedirectUrl(target.origin, target.baseUrl));
    } catch {
      return null;
    }
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname
      ? parsed
      : null;
  }

  if (parsed.protocol !== `${target.scheme}:`) return null;
  const matches = (
    (parsed.hostname === "reset-password" && (parsed.pathname === "" || parsed.pathname === "/")) ||
    (parsed.hostname === "" && parsed.pathname === "/reset-password")
  );
  return matches ? parsed : null;
}

function linkParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((value, key) => params.set(key, value));
  return params;
}

export function parsePasswordRecoveryUrl(url: string | null, target: RecoveryTarget): RecoveryLink {
  const parsed = expectedRecoveryUrl(url, target);
  if (!parsed) return { kind: "invalid" };
  const params = linkParams(parsed);
  const expired = ["error_code", "error_description"]
    .some((key) => /expired|otp_expired/i.test(params.get(key) ?? ""));
  if (expired) return { kind: "expired" };
  if (params.has("error") || params.has("error_code")) return { kind: "invalid" };

  // The e-mail's link lands here with the token unspent. Supabase's verify endpoint spends it on the first GET (a link
  // checker, a second tap) and returns a PKCE code only the browser that requested the reset can redeem.
  const tokenHash = params.get("token_hash");
  if (tokenHash) return params.get("type") === "recovery" ? { kind: "tokenHash", tokenHash } : { kind: "invalid" };
  // Kept for links already sitting in inboxes from before the template moved.
  const code = params.get("code");
  if (code) return { kind: "code", code };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken && params.get("type") === "recovery") {
    return { kind: "tokens", accessToken, refreshToken };
  }
  return { kind: "invalid" };
}

/**
 * What a sign-up confirmation or e-mail change link carries back to the Site URL: a token for Auth to check,
 * or its refusal. A bare `code` is not an answer: only the browser that signed up can redeem it, and
 * reading it as "confirmed" would let any `?code=` address say so. Read before supabase-js strips the URL.
 */
export function parseEmailLinkLanding(
  url: string,
): { tokenHash: string; type: "email" | "email_change" } | "unusable" | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (/\/reset-password\/?$/.test(parsed.pathname)) return null;
  const params = linkParams(parsed);
  if (params.has("error") || params.has("error_code")) return "unusable";
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  return tokenHash && (type === "email" || type === "email_change") ? { tokenHash, type } : null;
}
