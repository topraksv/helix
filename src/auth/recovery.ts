/** Pure password-recovery deep-link parsing for web and native URLs. */

type RecoveryLink =
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "expired" }
  | { kind: "invalid" };

type RecoveryTarget =
  | { platform: "web"; origin: string; baseUrl: string }
  | { platform: "native"; scheme: string };

const PRODUCTION_WEB_ORIGIN = "https://topraksv.github.io";
const PRODUCTION_WEB_BASE_URL = "/helix";
const EXPO_PROJECT_ID = "f71b0477-c800-45cc-903a-9b4d32a9c6b4";
const EXPO_GO_RUNTIME = "exposdk:54.0.0";

/** Expo Linking does not add Router's web base path to createURL(). */
export function webPasswordRecoveryRedirectUrl(origin: string, baseUrl: string): string {
  const normalizedBase = `/${baseUrl}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return new URL(`${normalizedBase}/reset-password`, origin).toString();
}

/**
 * Password links carry one-time bearer material after Supabase verifies them.
 * Published Expo Go callback URLs are explicitly unstable in Expo SDK 54, so
 * every native request returns to the same hosted HTTPS recovery screen. The
 * responsive web screen completes recovery safely from a phone browser and
 * can then reopen the stable Expo Go preview channel without forwarding the
 * credentials.
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

/** Stable channel URL returned by Expo's official EAS Update QR service. It
 * opens the latest compatible preview rather than pinning a release group. */
export function expoGoPreviewUrl(): string {
  return `exp://u.expo.dev/${EXPO_PROJECT_ID}?runtime-version=${encodeURIComponent(EXPO_GO_RUNTIME)}&channel-name=preview`;
}

/** Recovery credentials are bearer material. Accept them only on the exact
 * callback target the app generated; a matching query on an attacker-owned
 * host, another app's custom scheme, or a sibling route is not a Helix
 * recovery link. */
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

  const code = params.get("code");
  if (code) return { kind: "code", code };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken && params.get("type") === "recovery") {
    return { kind: "tokens", accessToken, refreshToken };
  }
  return { kind: "invalid" };
}
