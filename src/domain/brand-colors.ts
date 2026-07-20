/**
 * Brand chip colours and the ink drawn on them.
 *
 * Pure data plus one pure decision, so the whole table can be asserted in
 * `tests/theme-contrast.test.ts` — `src/ui/logo.tsx` imports react-native and
 * cannot be loaded by vitest.
 */

import { contrastRatio, hexToRgb } from "../ui/badge-color";
import { darkPalette, lightPalette } from "../ui/theme";

/**
 * Accent colour + optional short monogram for well-known subscriptions, keyed
 * by a normalised name. Matched on the whole trimmed name first, then on the
 * first word, so "Netflix Premium" still resolves to Netflix.
 */
export const BRAND: Record<string, { color: string; mark?: string }> = {
  netflix: { color: "#e50914", mark: "N" },
  spotify: { color: "#1db954", mark: "S" },
  youtube: { color: "#ff0000", mark: "YT" },
  "youtube premium": { color: "#ff0000", mark: "YT" },
  "youtube music": { color: "#ff0000", mark: "YT" },
  disney: { color: "#113ccf", mark: "D+" },
  "disney+": { color: "#113ccf", mark: "D+" },
  amazon: { color: "#ff9900", mark: "a" },
  prime: { color: "#1a98ff", mark: "P" },
  "prime video": { color: "#1a98ff", mark: "P" },
  "amazon prime": { color: "#1a98ff", mark: "P" },
  hbo: { color: "#002be7", mark: "M" },
  "hbo max": { color: "#002be7", mark: "M" },
  max: { color: "#002be7", mark: "M" },
  "apple music": { color: "#fa243c", mark: "" },
  "apple tv": { color: "#000000", mark: "TV" },
  "apple tv+": { color: "#000000", mark: "TV" },
  icloud: { color: "#3693f3", mark: "i" },
  chatgpt: { color: "#10a37f", mark: "AI" },
  openai: { color: "#10a37f", mark: "AI" },
  x: { color: "#000000", mark: "X" },
  twitter: { color: "#000000", mark: "X" },
  "google one": { color: "#4285f4", mark: "G" },
  twitch: { color: "#9146ff", mark: "T" },
  steam: { color: "#1b2838", mark: "S" },
  playstation: { color: "#003791", mark: "PS" },
  "playstation plus": { color: "#003791", mark: "PS" },
  xbox: { color: "#107c10", mark: "X" },
  "xbox game pass": { color: "#107c10", mark: "X" },
  nintendo: { color: "#e60012", mark: "N" },
  github: { color: "#181717", mark: "GH" },
  "github copilot": { color: "#181717", mark: "GH" },
  notion: { color: "#111111", mark: "N" },
  dropbox: { color: "#0061ff", mark: "D" },
  adobe: { color: "#da1f26", mark: "A" },
  canva: { color: "#00c4cc", mark: "C" },
  linkedin: { color: "#0a66c2", mark: "in" },
  "linkedin premium": { color: "#0a66c2", mark: "in" },
  patreon: { color: "#f96854", mark: "P" },
  audible: { color: "#f8991c", mark: "A" },
  duolingo: { color: "#58cc02", mark: "D" },
  deezer: { color: "#a238ff", mark: "D" },
  tidal: { color: "#000000", mark: "T" },
  blutv: { color: "#f8009e", mark: "blu" },
  exxen: { color: "#00e0b8", mark: "e" },
  tabii: { color: "#ff6600", mark: "t" },
  gain: { color: "#7c4dff", mark: "G" },
  todtv: { color: "#ed1c24", mark: "tod" },
  tod: { color: "#ed1c24", mark: "tod" },
  storytel: { color: "#ff5a5f", mark: "S" },
  claude: { color: "#d97757", mark: "C" },
  anthropic: { color: "#d97757", mark: "A" },
  gemini: { color: "#4285f4", mark: "G" },
  perplexity: { color: "#20808d", mark: "P" },
  midjourney: { color: "#1a1a2e", mark: "MJ" },
  cursor: { color: "#111111", mark: "C" },
  microsoft: { color: "#0078d4", mark: "M" },
  office: { color: "#d83b01", mark: "O" },
  onedrive: { color: "#0364b8", mark: "OD" },
  google: { color: "#4285f4", mark: "G" },
  apple: { color: "#000000", mark: "" },
  discord: { color: "#5865f2", mark: "D" },
  telegram: { color: "#26a5e4", mark: "T" },
  zoom: { color: "#0b5cff", mark: "Z" },
  slack: { color: "#611f69", mark: "S" },
  figma: { color: "#f24e1e", mark: "F" },
  evernote: { color: "#00a82d", mark: "E" },
  todoist: { color: "#e44332", mark: "T" },
  "1password": { color: "#0572ec", mark: "1P" },
  bitwarden: { color: "#175ddc", mark: "B" },
  nordvpn: { color: "#4687ff", mark: "N" },
  expressvpn: { color: "#da3940", mark: "EV" },
  surfshark: { color: "#178a9e", mark: "S" },
  crunchyroll: { color: "#f47521", mark: "CR" },
  mubi: { color: "#001489", mark: "M" },
  paramount: { color: "#0064ff", mark: "P+" },
  "paramount+": { color: "#0064ff", mark: "P+" },
  bein: { color: "#63276f", mark: "b" },
  "bein connect": { color: "#63276f", mark: "b" },
  "s sport": { color: "#e4002b", mark: "S" },
  "s sport plus": { color: "#e4002b", mark: "S" },
  "tv+": { color: "#ffc900", mark: "TV" },
  "tv plus": { color: "#ffc900", mark: "TV" },
  fizy: { color: "#8624db", mark: "f" },
  muud: { color: "#e6006d", mark: "M" },
  soundcloud: { color: "#ff5500", mark: "SC" },
  podimo: { color: "#5b2e90", mark: "P" },
  turkcell: { color: "#ffc900", mark: "T" },
  vodafone: { color: "#e60000", mark: "V" },
  "türk telekom": { color: "#0056a3", mark: "TT" },
  turktelekom: { color: "#0056a3", mark: "TT" },
  strava: { color: "#fc4c02", mark: "S" },
  macfit: { color: "#e30613", mark: "M" },
  nike: { color: "#111111", mark: "N" },
  medium: { color: "#191919", mark: "M" },
  scribd: { color: "#1e7b85", mark: "S" },
  blinkist: { color: "#2ce080", mark: "B" },
  roblox: { color: "#393b3d", mark: "R" },
  "epic games": { color: "#2f2d2e", mark: "E" },
  epic: { color: "#2f2d2e", mark: "E" },
  ubisoft: { color: "#0070ff", mark: "U" },
  "ea play": { color: "#ff4747", mark: "EA" },
  tinder: { color: "#fd5068", mark: "t" },
  bumble: { color: "#ffc629", mark: "b" },
  trendyol: { color: "#f27a1a", mark: "ty" },
  hepsiburada: { color: "#ff6000", mark: "hb" },
  getir: { color: "#5d3ebc", mark: "g" },
  yemeksepeti: { color: "#fa0050", mark: "ys" },
};

/**
 * Monogram plate for a brand chip.
 *
 * The mark used to be drawn straight onto the brand colour, with the ink picked
 * by NTSC "perceived brightness" on GAMMA-ENCODED sRGB. WCAG contrast uses
 * LINEARIZED luminance, and the two diverge most in saturated greens and cyans
 * where this table is dense: 49 chips failed AA and 16 fell below even 3:1.
 * Measuring properly fixed the worst of it, but twelve brand colours still land
 * at 4.30–4.41:1 — and the mark is normal-size text (`size * 0.42`, ~17 px on a
 * 40 px tile), so 4.5:1 genuinely applies and neither ink can reach it.
 *
 * A brand colour belongs to the brand, so instead of tinting it the mark now
 * sits on a NEUTRAL PLATE inside the tile. Contrast then stops depending on the
 * brand at all: it is the theme's own text-on-surface pair, which
 * `tests/theme-contrast.test.ts` already guarantees. The plate itself is chosen
 * by measured contrast against the brand colour so its edge clears the 3:1
 * non-text boundary of WCAG 1.4.11, and the tile keeps the full brand colour
 * around it.
 */
export interface BrandPlate {
  /** Fill behind the monogram. */
  plate: string;
  /** Monogram colour, the theme pair of `plate`. */
  ink: string;
}

export function brandPlate(hex: string): BrandPlate {
  const background = hexToRgb(hex);
  const onLight = contrastRatio(background, hexToRgb(lightPalette.surface));
  const onDark = contrastRatio(background, hexToRgb(darkPalette.surface));
  return onLight >= onDark
    ? { plate: lightPalette.surface, ink: lightPalette.textStrong }
    : { plate: darkPalette.surface, ink: darkPalette.textStrong };
}
