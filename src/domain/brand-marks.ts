/**
 * Which favicon service the app asks for a given domain's mark.
 *
 * Two services index these sites and they disagree, domain by domain, by more
 * than a factor of three. Google returns 16x16 for `teb.com.tr` where
 * DuckDuckGo has the real 48x48 mark; DuckDuckGo has nothing at all for
 * `akbank.com.tr` where Google has 32x32; and DuckDuckGo's "never heard of
 * it" answer is a 48px grey tile that BEATS most genuine marks on size alone.
 * So neither service is a safe default and neither is a safe guess:
 * `scripts/audit-brand-marks.mjs` asks both once, records every measurement in
 * `brand-mark-audit.ts`, and the conclusion — the short list below — is the
 * only part of it the app carries.
 *
 * Kept short deliberately. The full record is 180 rows of pixel widths and
 * hashes; shipping it would put 7KB of evidence into a web bundle that only
 * ever needs to know which handful of domains take the other route.
 */

/** The favicon services this app is willing to name. */
export type MarkProvider = "google" | "duckduckgo";

/**
 * The domains DuckDuckGo measured better than Google, and the only ones the
 * app asks it for. Everything else goes to Google, which indexes far more of
 * the web and is already in the page's `img-src`.
 */
const DUCKDUCKGO_MARKS = new Set<string>([
  "anadolubank.com.tr",
  "drive.google.com",
  "gemini.google.com",
  "ing.com.tr",
  "sokmarket.com.tr",
]);

/** The service with the best mark for this domain. */
export function markProvider(domain: string): MarkProvider {
  return DUCKDUCKGO_MARKS.has(domain) ? "duckduckgo" : "google";
}

/**
 * The URL that serves `domain`'s mark from the service that has the best one.
 *
 * `provider` is required rather than defaulting to Google. The default was
 * dead — every caller asks `markProvider` first — and a defaulted argument
 * nothing exercises is an untested branch that looks like a convenience.
 */
export function markUrl(domain: string, provider: MarkProvider): string {
  return provider === "duckduckgo"
    ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}
