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
 * three conclusions the app acts on, because shipping the record would put 7KB
 * of hashes into a web bundle no screen reads.
 */

/** The favicon services this app is willing to name. */
export type MarkProvider = "google" | "duckduckgo" | "iconhorse";

/** Domains icon.horse measured better than the others. */
const ICONHORSE_MARKS = new Set<string>([
  "alternatifbank.com.tr",
  "burgan.com.tr",
  "coursera.org",
  "deezer.com",
  "digiturk.com.tr",
  "drive.google.com",
  "ea.com",
  "github.com",
  "halkbank.com.tr",
  "hepsiburada.com",
  "maximiles.com.tr",
  "migros.com.tr",
  "notion.so",
  "openai.com",
  "podimo.com",
  "puhutv.com",
  "strava.com",
  "todtv.com.tr",
  "vercel.com",
  "vodafone.com.tr",
  "wetransfer.com",
  "x.com",
  "xbox.com",
  "yemeksepeti.com",
]);

/** Domains DuckDuckGo measured better than the others. */
const DUCKDUCKGO_MARKS = new Set<string>([
  "anadolubank.com.tr",
  "gemini.google.com",
  "ing.com.tr",
  "sokmarket.com.tr",
  "turkishbank.com",
]);

/**
 * Marks whose real pixel width is under the tile they are drawn in.
 *
 * These brands publish nothing larger — not at another service, and not on
 * their own sites: `worldcard.com.tr` and `vakifbank.com.tr` serve a single
 * 16x16 entry inside their `.ico`, `turktelekom.com.tr` serves a 16px PNG, and
 * none of them links an apple-touch-icon or a manifest icon at all. So there
 * is no better picture to fetch, and the softness the owner reported is not
 * the service's doing: it is ours, from painting a 16px source across a 44pt
 * tile, which is an eight-fold enlargement on a 3x screen.
 *
 * `logo.tsx` uses these to stop enlarging past what the source can carry. A
 * small sharp logo is a better picture of a brand than a large soft one.
 */
export const SMALL_MARK_PX: Record<string, number> = {
  "adabank.com.tr": 16,
  "akbank.com.tr": 32,
  "bkm.com.tr": 16,
  "blinkist.com": 16,
  "bonus.com.tr": 44,
  "drive.google.com": 32,
  "dropbox.com": 32,
  "dsmart.com.tr": 16,
  "evernote.com": 32,
  "headspace.com": 32,
  "icbc.com.tr": 16,
  "ininal.com": 32,
  "kaspersky.com": 16,
  "kuveytturk.com.tr": 32,
  "marti.tech": 32,
  "odeabank.com.tr": 16,
  "one.google.com": 32,
  "param.com.tr": 32,
  "qnb.com.tr": 16,
  "sekerbank.com.tr": 16,
  "slack.com": 35,
  "superonline.net": 16,
  "tbank.com.tr": 16,
  "teb.com.tr": 16,
  "turkcell.com.tr": 16,
  "turktelekom.com.tr": 16,
  "twitch.tv": 32,
  "vakifbank.com.tr": 16,
  "whatsapp.com": 23,
  "worldcard.com.tr": 16,
  "zoom.us": 32,
};

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
