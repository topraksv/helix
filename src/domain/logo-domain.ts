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
