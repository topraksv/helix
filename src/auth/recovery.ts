/** Pure password-recovery deep-link parsing for web and native URLs. */

type RecoveryLink =
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "expired" }
  | { kind: "invalid" };

export type RecoveryTarget =
  | { platform: "web"; origin: string; baseUrl: string }
  | { platform: "native"; scheme: string };

/** Expo Linking does not add Router's web base path to createURL(). */
export function webPasswordRecoveryRedirectUrl(origin: string, baseUrl: string): string {
  const normalizedBase = `/${baseUrl}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return new URL(`${normalizedBase}/reset-password`, origin).toString();
}

/** Recovery credentials are bearer material. Accept them only on the exact
 * callback target the app generated; a matching query on an attacker-owned
 * host, another app's custom scheme, or a sibling route is not a Helix
 * recovery link. */
function hasExpectedRecoveryTarget(url: string, target: RecoveryTarget): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.port) return false;
  if (target.platform === "web") {
    let expected: URL;
    try {
      expected = new URL(webPasswordRecoveryRedirectUrl(target.origin, target.baseUrl));
    } catch {
      return false;
    }
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
  }

  if (parsed.protocol !== `${target.scheme}:`) return false;
  return (
    (parsed.hostname === "reset-password" && (parsed.pathname === "" || parsed.pathname === "/")) ||
    (parsed.hostname === "" && parsed.pathname === "/reset-password")
  );
}

function linkParams(url: string): URLSearchParams {
  const params = new URLSearchParams();
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  for (const raw of [query, hash]) {
    const source = new URLSearchParams(raw);
    source.forEach((value, key) => params.set(key, value));
  }
  return params;
}

export function parsePasswordRecoveryUrl(url: string | null, target: RecoveryTarget): RecoveryLink {
  if (!url) return { kind: "invalid" };
  if (!hasExpectedRecoveryTarget(url, target)) return { kind: "invalid" };
  const params = linkParams(url);
  const error = `${params.get("error_code") ?? ""} ${params.get("error_description") ?? ""}`;
  if (/expired|otp_expired/i.test(error)) return { kind: "expired" };
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
