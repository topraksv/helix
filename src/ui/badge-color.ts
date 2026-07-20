/**
 * Deterministic avatar colour for the name-derived initials badge.
 *
 * The hue is a stable hash of the name, but a raw HSL ramp at one fixed
 * lightness is not a safe canvas for the white monogram drawn on it: relative
 * luminance varies enormously around the wheel (yellow at L=46% is ~4x brighter
 * than blue), so white text dropped to 2.6:1 on roughly half of the hues. The
 * generated colour is therefore capped in RELATIVE LUMINANCE — the quantity
 * WCAG contrast is computed from — instead of in HSL lightness. Hues that were
 * already dark enough are returned unchanged; only the bright half is darkened,
 * and every hue keeps the same readable floor.
 */

const SATURATION = 0.42;
const LIGHTNESS = 0.46;

/**
 * Highest background luminance that still clears WCAG AA (4.5:1) against white
 * is 0.1833; the cap keeps a margin so rounding to 8-bit channels cannot cross
 * the threshold. At the cap the ratio is ~4.67:1.
 */
const MAX_LUMINANCE = 0.175;

export function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** WCAG contrast ratio between two sRGB colours given as 0–1 channel triples. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `#rrggbb` → 0–1 channel triple. Throws on anything else, so a malformed
 *  brand colour fails loudly instead of silently contrasting against black. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`Invalid hex colour: ${hex}`);
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

export function relativeLuminance([red, green, blue]: [number, number, number]): number {
  return 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
}

function hslToRgb(hue: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * LIGHTNESS - 1)) * SATURATION;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base: [number, number, number] =
    sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
    : sector < 3 ? [0, chroma, second]
    : sector < 4 ? [0, second, chroma]
    : sector < 5 ? [second, 0, chroma]
    : [chroma, 0, second];
  const offset = LIGHTNESS - chroma / 2;
  return [base[0] + offset, base[1] + offset, base[2] + offset];
}

function toHex([red, green, blue]: [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** Stable 0–359 hue for a name. Exported so the contrast contract can prove it
 *  covers every reachable hue rather than a sample of names. */
export function badgeHue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

/** Background colour for `InitialsBadge`, guaranteed AA-readable under white. */
export function initialsBadgeColor(name: string): string {
  const rgb = hslToRgb(badgeHue(name));
  const luminance = relativeLuminance(rgb);
  if (luminance <= MAX_LUMINANCE) return toHex(rgb);
  const scale = MAX_LUMINANCE / luminance;
  return toHex([
    toSrgb(toLinear(rgb[0]) * scale),
    toSrgb(toLinear(rgb[1]) * scale),
    toSrgb(toLinear(rgb[2]) * scale),
  ]);
}
