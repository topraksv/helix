/** Strict URL construction for optional remote subscription favicons. */

const TURKISH_FOLD: Record<string, string> = {
  "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
  "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c",
};

/**
 * One spelling to match a subscription's name against.
 *
 * `/internet/i` returns FALSE for "İnternet aboneliği". Without the `u` flag a
 * JavaScript regex canonicalises by `toUpperCase`, and dotted capital İ upper-
 * cases to itself while `i` upper-cases to `I` — so every utility a Turkish
 * user actually types with a capital was left without its icon. The accents go
 * too, so a pattern can be written in plain ASCII once and still match
 * "Doğalgaz", "İSKİ" and "Isıtma".
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
 * Turkish card programmes are named by concatenation, not by spacing:
 * Worldeko, Worldgold, Bonus Platinium written as "bonusplatinium", Axessplus,
 * Parafpara, Maximumgenc. `nameMentions` refuses every one of those, because a
 * whole-word match is exactly what a concatenated sub-brand is not — so a card
 * the owner really does hold was drawn with a generic outline while the plain
 * "World" beside it got its mark.
 *
 * The prefix must be a word's OWN beginning, so "eko world" still resolves and
 * "kredi" inside "yapikredi" does not steal the tile from Yapı Kredi. Callers
 * enforce the minimum length that makes this safe; see `MIN_PREFIX_MATCH`.
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
 * How long a catalogue key must be before it may match as a word PREFIX.
 *
 * Short keys are ordinary Turkish and English fragments: "ing" begins
 * "İngiltere", "teb" begins "tebrik", "max" begins "maximum" — and that last
 * one is a case the catalogue already had to get right, because Max and
 * Maximum are two different companies. Five characters is where the fragments
 * stop and the brands start: World, Bonus, Axess, Paraf all clear it, and
 * every key below it keeps the strict whole-word rule it had before.
 */
export const MIN_PREFIX_MATCH = 5;

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

/**
 * 256, not 128.
 *
 * The tile is drawn at up to 46pt, and on a @3x screen that is 138 physical
 * pixels — so a 128px source was already being upscaled on every phone, which
 * is the softness in the marks the owner noticed. The service serves 256 for
 * the same request and falls back to whatever it has when a site publishes
 * nothing larger, so this costs a few KB on the sites that have it and nothing
 * on the ones that do not.
 */
export function remoteFaviconUrl(value: string | null | undefined): string | null {
  const domain = normalizeLogoDomain(value);
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256` : null;
}
