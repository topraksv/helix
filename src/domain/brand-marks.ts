/**
 * Which favicon service the app asks for a given domain's mark. The services
 * disagree domain by domain by more than an order of magnitude, so none is a
 * safe default.
 *
 * A BIGGER PICTURE IS NOT A BETTER LOGO: every service answers "never heard of
 * it" with an invented image rather than an error, and the invented ones are
 * larger than most genuine marks (icon.horse makes a 256x256 letter avatar).
 * `scripts/audit-brand-marks.mjs` asks each service for domains that cannot
 * exist and treats anything matching those answers as nothing.
 *
 * `tests/fixtures/brand-mark-audit.ts` holds the measurements; this file holds
 * only the conclusions the app acts on, since shipping the record would put
 * hashes into a bundle no screen reads.
 */

/** The favicon services this app is willing to name. */
export type MarkProvider = "google" | "duckduckgo" | "iconhorse";

/** Domains where icon.horse audited better than the others. */
const ICONHORSE_MARKS = new Set<string>([
  "alternatifbank.com.tr",
  "coursera.org",
  "github.com",
  "kuveytturk.com.tr",
  "maximiles.com.tr",
  "migros.com.tr",
  "podimo.com",
  "primevideo.com",
  "puhutv.com",
  "strava.com",
  "turkishbank.com",
  "vercel.com",
  "yemeksepeti.com",
]);

/** Domains where DuckDuckGo audited better than the others. */
const DUCKDUCKGO_MARKS = new Set<string>([
  "gemini.google.com",
]);


/** The service with the best mark for this domain. */
export function markProvider(domain: string): MarkProvider {
  if (ICONHORSE_MARKS.has(domain)) return "iconhorse";
  if (DUCKDUCKGO_MARKS.has(domain)) return "duckduckgo";
  return "google";
}

/** The URL that serves `domain`'s mark from the service that has the best one. */
export function markUrl(domain: string, provider: MarkProvider): string {
  if (provider === "duckduckgo") return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  if (provider === "iconhorse") return `https://icon.horse/icon/${encodeURIComponent(domain)}`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}
