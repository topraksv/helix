import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hexToRgb } from "../src/ui/badge-color";
import { BRAND, brandPlate } from "../src/domain/brand-colors";
import { badgeHue, initialsBadgeColor } from "../src/ui/badge-color";
import { darkPalette, generatedBadgeForeground, lightPalette, type Palette } from "../src/ui/theme";

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
    [palette.successText, palette.surface],
    [palette.errorText, palette.surface],
    [palette.positiveText, palette.surface],
    [palette.negativeText, palette.surface],
    [palette.warningText, palette.surface],
    [palette.primaryText, palette.surfaceAlt],
    [palette.positiveText, palette.surfaceAlt],
    [palette.negativeText, palette.surfaceAlt],
    [palette.warningText, palette.surfaceAlt],
    [palette.accentText, palette.surface],
    // The undo snackbar is the one INVERTED surface in the app: it paints
    // `text` as its background, so both its message and its action label must
    // be the page background ink, never a normal-surface foreground role.
    [palette.background, palette.text],
  ] as const;
  for (const [foreground, background] of surfacePairs) {
    expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.onDestructive, palette.destructive)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.focus, palette.surfaceAlt)).toBeGreaterThanOrEqual(3);
  for (const accent of [palette.primary, palette.success, palette.error, palette.destructive, palette.positive, palette.negative, palette.warning]) {
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
  for (const green of [palette.success, palette.successText, palette.positive, palette.positiveText]) {
    const [r, g, b] = channels(green);
    expect(g, `${green} should be green-dominant`).toBeGreaterThan(r);
    expect(g, `${green} should be green-dominant`).toBeGreaterThan(b);
  }
  for (const red of [palette.error, palette.errorText, palette.destructive, palette.negative, palette.negativeText]) {
    const [r, g, b] = channels(red);
    expect(r, `${red} should be red-dominant`).toBeGreaterThan(g);
    expect(r, `${red} should be red-dominant`).toBeGreaterThan(b);
  }
  for (const accent of [palette.primary, palette.warning, palette.warningText, palette.success, palette.error, palette.destructive, palette.positive, palette.negative]) {
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

  it("keeps status, destructive-action and financial-direction roles explicit", () => {
    for (const palette of [lightPalette, darkPalette]) {
      expect(palette.success).toBe(palette.positive);
      expect(palette.successText).toBe(palette.positiveText);
      expect(palette.error).toBe(palette.negative);
      expect(palette.errorText).toBe(palette.negativeText);
      expect(palette.destructive).toBe(palette.negative);
      expect(palette.onDestructive).toBeDefined();
    }
  });

  it("keeps every light-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(lightPalette);
  });

  it("keeps every dark-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(darkPalette);
  });

  // Generated colours escape the token table above, so the badge that renders a
  // white monogram on a name-derived hue needs its own contract.
  it("keeps the white initials monogram at WCAG AA on every reachable hue", () => {
    for (let hue = 0; hue < 360; hue++) {
      const name = String.fromCharCode(hue);
      expect(badgeHue(name), `hue ${hue} must be reachable from a name`).toBe(hue);
      const background = initialsBadgeColor(name);
      expect(contrastRatio(generatedBadgeForeground, background), `hue ${hue} → ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The snackbar paints `palette.text` as its own background, which inverts the
  // usual foreground rules: a role that is readable on `surface` (primaryText,
  // accentText…) is invisible here. Read the roles the component actually uses
  // instead of asserting one expected name, so the contract survives a redesign.
  it("keeps every undo-snackbar foreground readable on its inverted surface", () => {
    const source = readFileSync("src/ui/undo.tsx", "utf8");
    const roles = [...source.matchAll(/color: palette\.([A-Za-z]+)/g)].map((match) => match[1]!);
    expect(roles.length, "undo snackbar must declare its text colours").toBeGreaterThan(0);
    for (const palette of [lightPalette, darkPalette]) {
      for (const role of roles) {
        const foreground = palette[role as keyof Palette];
        expect(contrastRatio(foreground, palette.text), `${role} (${foreground}) on snackbar ${palette.text}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // WCAG 1.4.11: an interactive control has to be distinguishable from its
  // background, in every state. Both toggle track fills are low-contrast warm
  // neutrals, so the track's own boundary is what satisfies this — and on the
  // refund row, whose background IS the active track colour, the switch was
  // rendering at exactly 1.00:1 and could not be seen at all.
  it("outlines interactive controls against every surface they sit on", () => {
    // `primarySoft` stays in this list on purpose: it is both the active track
    // fill and a real row background, so it is the worst case the token has to
    // survive if either is ever used behind a control again.
    const controlSurfaces = ["background", "surface", "surfaceAlt", "surfaceHover", "primarySoft"] as const;
    for (const palette of [lightPalette, darkPalette]) {
      for (const surface of controlSurfaces) {
        expect(
          contrastRatio(palette.controlBorder, palette[surface]),
          `controlBorder (${palette.controlBorder}) on ${surface} (${palette[surface]})`,
        ).toBeGreaterThanOrEqual(3);
      }
      // The boundary must also read against the fills it wraps, so neither the
      // on nor the off state can collapse into an unoutlined blob.
      for (const track of ["surfaceStrong", "primarySoft"] as const) {
        expect(
          contrastRatio(palette.controlBorder, palette[track]),
          `controlBorder (${palette.controlBorder}) around ${track} track (${palette[track]})`,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  // Categorical chart fills identify a category; they must not read as a
  // status scale. Amber beside red is the worst case — a warning-then-danger
  // ramp for two categories that mean nothing of the kind, and the pair hardest
  // to tell apart with a red-green colour vision deficiency.
  it("never places the semantic accents next to each other in chart series", () => {
    // Hue families, since the palette has three near-identical clay tones that
    // would otherwise count as three distinct categories.
    const family = (palette: Palette) =>
      new Map<string, string>([
        [palette.primary, "clay"],
        [palette.primaryStrong, "clay"],
        [palette.accentText, "clay"],
        [palette.positive, "green"],
        [palette.warning, "amber"],
        [palette.negative, "red"],
        [palette.surfaceStrong, "neutral"],
        [palette.textSecondary, "neutral"],
      ]);

    for (const palette of [lightPalette, darkPalette]) {
      // Mirrors `useSeriesColors`, which cannot be imported here (it is a hook).
      const series = [
        palette.primary,
        palette.positive,
        palette.surfaceStrong,
        palette.primaryStrong,
        palette.warning,
        palette.textSecondary,
        palette.accentText,
        palette.negative,
      ];
      const families = series.map((color) => family(palette).get(color));
      expect(families, "every series colour must be a known palette token").not.toContain(undefined);

      const semantic = new Set(["green", "amber", "red"]);
      for (let index = 0; index < families.length; index += 1) {
        // Charts wrap: with more categories than colours the last is drawn
        // beside the first, so the adjacency check has to wrap too.
        const current = families[index]!;
        const next = families[(index + 1) % families.length]!;
        expect(current, `series ${index} and ${(index + 1) % families.length} share a hue family`).not.toBe(next);
        expect(
          semantic.has(current) && semantic.has(next),
          `series ${index} (${current}) sits next to ${next}`,
        ).toBe(false);
      }
    }
  });

  it("keeps the badge colour deterministic per name", () => {
    expect(initialsBadgeColor("Netflix")).toBe(initialsBadgeColor("Netflix"));
    expect(initialsBadgeColor("Netflix")).not.toBe(initialsBadgeColor("Spotify"));
  });
});

/**
 * Brand chips are the offline / failed-favicon fallback, so they must stay
 * readable exactly when the network does not.
 *
 * `logo.tsx`'s `inkFor` used to weight GAMMA-ENCODED sRGB with the NTSC
 * "perceived brightness" coefficients and threshold at 0.62. WCAG contrast is
 * computed from LINEARIZED relative luminance, and the two diverge most in
 * saturated greens and cyans — where this table is dense. Measured across it,
 * 49 chips failed AA and 16 fell below even the 3:1 large-text floor, while the
 * opposite ink would have passed comfortably in every one of those cases.
 *
 * `tests/theme-contrast.test.ts` already guards the other generated colour
 * (`InitialsBadge`, all 360 hues); this closes the gap for the brand table.
 */
describe("brand chip monogram", () => {
  const brandEntries = Object.entries(BRAND) as [string, { color: string }][];

  it("covers a real table, so a passing run means something", () => {
    expect(brandEntries.length).toBeGreaterThan(50);
  });

  /**
   * The mark is normal-size text (`size * 0.34`), so AA 4.5:1 applies — not the
   * large-text 3:1. Drawn straight on the brand colour it could not get there
   * for twelve brands whatever ink was chosen, so it now sits on a neutral
   * plate and the ratio stops depending on the brand at all.
   */
  it("clears AA for the monogram on EVERY brand, with no exceptions", () => {
    const failures: string[] = [];
    for (const [name, { color }] of brandEntries) {
      const { plate, ink } = brandPlate(color);
      const ratio = contrastRatio(plate, ink);
      if (ratio < 4.5) failures.push(`${name} ${color} → ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps the plate edge visible against the brand colour (WCAG 1.4.11)", () => {
    const failures: string[] = [];
    for (const [name, { color }] of brandEntries) {
      const ratio = contrastRatio(color, brandPlate(color).plate);
      if (ratio < 3) failures.push(`${name} ${color} → ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("always picks the plate that measures better against the brand colour", () => {
    for (const [name, { color }] of brandEntries) {
      const chosen = contrastRatio(color, brandPlate(color).plate);
      const best = Math.max(
        contrastRatio(color, lightPalette.surface),
        contrastRatio(color, darkPalette.surface),
      );
      expect(chosen, name).toBeCloseTo(best, 6);
    }
  });

  it("pairs each plate with its own theme ink", () => {
    for (const [name, { color }] of brandEntries) {
      const { plate, ink } = brandPlate(color);
      const pair = plate === lightPalette.surface
        ? lightPalette.textStrong
        : darkPalette.textStrong;
      expect(ink, name).toBe(pair);
    }
  });

  it("rejects a malformed brand colour instead of contrasting against black", () => {
    expect(() => brandPlate("nope")).toThrow(/invalid hex/i);
    expect(() => brandPlate("#12345")).toThrow(/invalid hex/i);
  });
});
