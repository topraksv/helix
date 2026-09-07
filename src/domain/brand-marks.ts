/**
 * Which favicon service the app asks for a given domain's mark, and which
 * marks are too small to enlarge.
 *
 * Three services index these sites and they disagree, domain by domain, by
 * more than an order of magnitude in both directions: Google has 32px for
 * Vodafone where icon.horse has 180, icon.horse has nothing for Akbank where
 * Google has 32, and DuckDuckGo has the only real mark for ING. So no service
 * is a safe default and none is a safe guess.
 *
 * The rule that matters more than any of that is A BIGGER PICTURE IS NOT A
 * BETTER LOGO. Every one of these services answers "never heard of it" with an
 * invented image rather than an error, and the invented ones are LARGER than
 * most genuine marks — icon.horse generates a 256x256 letter avatar, which
 * beats every real favicon in this catalogue on pixels alone. Scoring by size
 * is therefore wrong on its own; `scripts/audit-brand-marks.mjs` asks each
 * service for domains that cannot exist, one per letter, and treats anything
 * matching those answers as nothing.
 *
 * `brand-mark-audit.ts` holds all 180 measurements. This file holds only the
 * conclusions the app ACTS on, because shipping the record would put 7KB of
 * hashes into a web bundle no screen reads.
 *
 * There were three. `SMALL_MARK_PX` was the third and it is gone: the owner
 * chose one tile size for every mark, blur included, over a sharp mark half
 * the size of its neighbours, so nothing sizes by resolution any more. The
 * measurements stay in the audit file — they are the answer to "why is this
 * one soft" and the thing to read before anyone hunts for a better source
 * again — but they are evidence now, not a runtime table.
 */

/** The favicon services this app is willing to name. */
export type MarkProvider = "google" | "duckduckgo" | "iconhorse";

/** Domains icon.horse measured better than the others. */
const ICONHORSE_MARKS = new Set<string>([
  "alternatifbank.com.tr",
  "coursera.org",
  "github.com",
  "hepsiburada.com",
  "kuveytturk.com.tr",
  "maximiles.com.tr",
  "migros.com.tr",
  "podimo.com",
  "primevideo.com",
  "puhutv.com",
  "strava.com",
  "tivibu.com.tr",
  "turkishbank.com",
  "vercel.com",
  "yemeksepeti.com",
]);

/** Domains DuckDuckGo measured better than the others. */
const DUCKDUCKGO_MARKS = new Set<string>([
  "drive.google.com",
  "gemini.google.com",
  "ing.com.tr",
  "sokmarket.com.tr",
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
