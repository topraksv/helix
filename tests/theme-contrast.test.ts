import { describe, expect, it } from "vitest";
import { darkPalette, lightPalette, type Palette } from "../src/ui/theme";

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${hex}`);
  const [red, green, blue] = channels.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  if (red == null || green == null || blue == null) throw new Error(`Unsupported color: ${hex}`);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  if (lighter == null || darker == null) throw new Error("Missing luminance");
  return (lighter + 0.05) / (darker + 0.05);
}

function expectBodyTextContrast(palette: Palette): void {
  const surfacePairs = [
    [palette.text, palette.background],
    [palette.text, palette.surface],
    [palette.textStrong, palette.background],
    [palette.textSecondary, palette.surface],
    [palette.textMuted, palette.background],
    [palette.primaryText, palette.surface],
    [palette.primaryText, palette.primarySoft],
    [palette.positiveText, palette.surface],
    [palette.negativeText, palette.surface],
    [palette.warningText, palette.surface],
    [palette.primaryText, palette.surfaceAlt],
    [palette.positiveText, palette.surfaceAlt],
    [palette.negativeText, palette.surfaceAlt],
    [palette.warningText, palette.surfaceAlt],
    [palette.accentText, palette.surface],
  ] as const;
  for (const [foreground, background] of surfacePairs) {
    expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.onNegative, palette.negative)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.focus, palette.surfaceAlt)).toBeGreaterThanOrEqual(3);
  for (const accent of [palette.primary, palette.positive, palette.negative, palette.warning]) {
    expect(contrastRatio(accent, palette.surface)).toBeGreaterThanOrEqual(3);
  }
}

function channels(hex: string): [number, number, number] {
  const parts = hex.match(/[0-9a-f]{2}/gi);
  if (!parts || parts.length !== 3) throw new Error(`Unsupported color: ${hex}`);
  return [Number.parseInt(parts[0]!, 16), Number.parseInt(parts[1]!, 16), Number.parseInt(parts[2]!, 16)];
}

/** Income reads green, expense reads red, warning reads warm amber — and no
 *  semantic accent may drift purple/blue again (the sole blue is `focus`). */
function expectSemanticHues(palette: Palette): void {
  for (const green of [palette.positive, palette.positiveText]) {
    const [r, g, b] = channels(green);
    expect(g, `${green} should be green-dominant`).toBeGreaterThan(r);
    expect(g, `${green} should be green-dominant`).toBeGreaterThan(b);
  }
  for (const red of [palette.negative, palette.negativeText]) {
    const [r, g, b] = channels(red);
    expect(r, `${red} should be red-dominant`).toBeGreaterThan(g);
    expect(r, `${red} should be red-dominant`).toBeGreaterThan(b);
  }
  for (const accent of [palette.primary, palette.warning, palette.warningText, palette.positive, palette.negative]) {
    const [r, g, b] = channels(accent);
    expect(b, `${accent} must not be blue/purple-dominant`).toBeLessThanOrEqual(Math.max(r, g));
  }
  {
    const [r, g, b] = channels(palette.warning);
    expect(r, `${palette.warning} should be a warm amber`).toBeGreaterThan(b);
    expect(g, `${palette.warning} should be a warm amber`).toBeGreaterThan(b);
  }
}

describe("semantic theme contrast", () => {
  it("keeps the warm neutral ramp exact", () => {
    expect(lightPalette).toMatchObject({
      background: "#F8F8F7", surface: "#F5F4EF", surfaceAlt: "#F0EEE5",
      surfaceHover: "#E8E5D8", surfaceStrong: "#DED8C4", textStrong: "#0F0F0D",
      text: "#29261B", textSecondary: "#535146", textMuted: "#737163",
      primary: "#BA5B38", accentText: "#AB5235", primaryStrong: "#C96442",
      primarySoft: "#F2E0DA", border: "#706B57",
    });
    expect(darkPalette).toMatchObject({
      background: "#1A1A19", surface: "#222220", surfaceAlt: "#2D2D2A",
      surfaceHover: "#393937", surfaceStrong: "#494946", textStrong: "#FAF9F5",
      text: "#EFEEEC", textSecondary: "#B6B5AF", textMuted: "#989790",
      primary: "#D56E48", accentText: "#D97959", primaryStrong: "#CC5933",
      primarySoft: "#493027", border: "#514F48",
    });
  });

  it("keeps light semantic accents on the green/red/amber contract", () => {
    expectSemanticHues(lightPalette);
  });

  it("keeps dark semantic accents on the green/red/amber contract", () => {
    expectSemanticHues(darkPalette);
  });

  it("keeps every light-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(lightPalette);
  });

  it("keeps every dark-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(darkPalette);
  });
});
