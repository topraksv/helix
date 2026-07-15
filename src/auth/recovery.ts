/** Pure password-recovery deep-link parsing for web and native URLs. */

export type RecoveryLink =
  | { kind: "code"; code: string }
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "expired" }
  | { kind: "invalid" };

/** Expo Linking does not add Router's web base path to createURL(). */
export function webPasswordRecoveryRedirectUrl(origin: string, baseUrl: string): string {
  const normalizedBase = `/${baseUrl}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return new URL(`${normalizedBase}/reset-password`, origin).toString();
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

export function parsePasswordRecoveryUrl(url: string | null): RecoveryLink {
  if (!url) return { kind: "invalid" };
  const params = linkParams(url);
  const error = `${params.get("error_code") ?? ""} ${params.get("error_description") ?? ""}`;
  if (/expired|otp_expired/i.test(error)) return { kind: "expired" };
  if (params.has("error") || params.has("error_code")) return { kind: "invalid" };

  const code = params.get("code");
  if (code) return { kind: "code", code };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };
  return { kind: "invalid" };
}
