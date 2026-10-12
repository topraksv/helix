/** Strict URL construction for optional remote subscription favicons. */

import { markProvider, markUrl } from "./brand-marks";

const TURKISH_FOLD: Record<string, string> = {
  "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
  "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
};

/**
 * One spelling to match a subscription's name against. `/internet/i` is FALSE
 * for "İnternet aboneliği" (a non-`u` regex canonicalises by `toUpperCase`, and
 * dotted İ stays itself), so the accents are folded away and a pattern can be
 * written in plain ASCII.
 */
export function foldForMatch(value: string): string {
  return value
    .trim()
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (character) => TURKISH_FOLD[character] ?? character)
    .toLowerCase();
}

/** Whether `needle` appears in `name` as a whole word, both folded. */
export function nameMentions(name: string, needle: string): boolean {
  const folded = foldForMatch(name);
  const target = foldForMatch(needle);
  if (!target) return false;
  const index = folded.indexOf(target);
  if (index < 0) return false;
  const before = folded[index - 1];
  const after = folded[index + target.length];
  const isWordCharacter = (character: string | undefined) => character != null && /[a-z0-9]/.test(character);
  return !isWordCharacter(before) && !isWordCharacter(after);
}

/**
 * Whether `name` contains a WORD THAT STARTS WITH `needle`, both folded.
 *
 * Turkish card programmes are named by concatenation (Worldeko, Axessplus,
 * Parafpara), which the whole-word `nameMentions` refuses. The prefix must be a
 * word's OWN beginning, so "kredi" inside "yapikredi" does not steal that
 * bank's tile. Callers enforce the minimum length; see `MIN_PREFIX_MATCH`.
 */
export function nameStartsWord(name: string, needle: string): boolean {
  const folded = foldForMatch(name);
  const target = foldForMatch(needle);
  if (!target) return false;
  let index = folded.indexOf(target);
  while (index >= 0) {
    const before = folded[index - 1];
    if (before == null || !/[a-z0-9]/.test(before)) return true;
    index = folded.indexOf(target, index + 1);
  }
  return false;
}

/**
 * How long a catalogue key must be before it may match as a word PREFIX. Short
 * keys are ordinary fragments ("ing" begins "İngiltere", "max" begins
 * "maximum", and Max and Maximum are different companies); five characters is
 * where the brands start. Shorter keys keep the strict whole-word rule.
 */
export const MIN_PREFIX_MATCH = 5;

/**
 * The catalogue entry a name refers to.
 *
 * Whole name, then first word, then any brand mentioned as a whole word inside
 * it — "Ailem için Netflix" is a Netflix subscription, and "maximum" is not
 * Max. Longest key first, so "youtube music" wins over "youtube".
 */
export function catalogueKey<T>(name: string, table: Record<string, T>): T | null {
  const key = foldForMatch(name);
  if (table[key] != null) return table[key]!;
  const firstWord = key.split(/\s+/)[0];
  if (firstWord && table[firstWord] != null) return table[firstWord]!;
  const keys = Object.keys(table);
  const longestFirst = (a: string, b: string) => b.length - a.length;
  const mentioned = keys
    .filter((entry) => entry.length >= 3 && nameMentions(name, entry))
    .sort(longestFirst)[0];
  if (mentioned != null) return table[mentioned]!;
  // Last, and only for keys long enough to be a brand rather than a fragment:
  // the concatenated sub-brand. "Worldeko", "Worldgold" and "bonusplatinium"
  // are cards people really hold, and every one of them fails all three passes
  // above. Longest key first here too, so a name that begins two keys resolves
  // to the more specific one.
  const prefixed = keys
    .filter((entry) => entry.length >= MIN_PREFIX_MATCH && nameStartsWord(name, entry))
    .sort(longestFirst)[0];
  return prefixed != null ? table[prefixed]! : null;
}

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
  // A bare "local" or "localhost" has no dot and is refused before this.
  return NON_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
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

/**
 * The remote mark at 256px, not 128: the tile is drawn at up to 46pt, which is
 * 138 physical pixels on a @3x screen. The service falls back to whatever it
 * has when a site publishes nothing larger.
 */
export function remoteFaviconUrl(value: string | null | undefined): string | null {
  const domain = normalizeLogoDomain(value);
  if (!domain) return null;
  // The service is chosen per domain by `markProvider`; an unaudited domain
  // (a user's own override) gets Google, which indexes far more of the web.
  return markUrl(domain, markProvider(domain));
}
