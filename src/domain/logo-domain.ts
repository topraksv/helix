/** Strict URL construction for optional remote subscription favicons. */

const NON_PUBLIC_SUFFIXES = [
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".test",
] as const;

function hasNonPublicSuffix(hostname: string): boolean {
  return NON_PUBLIC_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
}

export function normalizeLogoDomain(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw.length > 512) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = url.hostname.toLowerCase();
    if (
      url.username ||
      url.password ||
      url.port ||
      hostname.length > 253 ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hasNonPublicSuffix(hostname) ||
      /^\d+(?:\.\d+){3}$/.test(hostname) ||
      hostname.includes(":")
    ) return null;
    const labels = hostname.split(".");
    if (labels.some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function remoteFaviconUrl(value: string | null | undefined): string | null {
  const domain = normalizeLogoDomain(value);
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}
