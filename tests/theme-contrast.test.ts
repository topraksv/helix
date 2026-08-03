import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hexToRgb } from "../src/ui/badge-color";
import { BRAND, brandPlate } from "../src/ui/brand-colors";
import { badgeHue, initialsBadgeColor } from "../src/ui/badge-color";
import { darkPalette, DEFAULT_PALETTE_ID, generatedBadgeForeground, heroSurface, lightPalette, PALETTES, resolvePaletteId, type Palette } from "../src/ui/theme";

const shippedPalettes = Object.values(PALETTES).flatMap(({ light, dark }) => [light, dark]);

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
    [palette.textSecondary, palette.surfaceAlt],
    [palette.textMuted, palette.background],
    [palette.textMuted, palette.surface],
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

/** Flatten a translucent colour over what sits behind it. */
function blend(over: string, under: string, alpha: number): string {
  const [ur, ug, ub] = channels(under);
  return `#${channels(over)
    .map((value, index) => Math.round(alpha * value + (1 - alpha) * [ur, ug, ub][index]!)
      .toString(16)
      .padStart(2, "0"))
    .join("")}`;
}


/** Income reads green, expense reads red, warning reads warm amber — in every
 *  theme, whatever temperature that theme tunes them to. */
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
  // The ban is on SEMANTIC accents, not on a theme's brand colour. Its purpose
  // is that a status never reads as blue or purple and that the chart series
  // never form a status ramp — Liman's harbour blue is a brand identity and
  // means nothing about money, so it is deliberately outside this.
  for (const accent of [palette.warning, palette.warningText, palette.success, palette.error, palette.destructive, palette.positive, palette.negative]) {
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
  it("ships exactly the approved palette set", () => {
    expect(Object.keys(PALETTES)).toEqual(["clay", "ocean", "forest"]);
  });

  /**
   * A retired palette must resolve, not merely fail validation.
   *
   * `sand` and `cinnamon` are still written on devices that chose them. Left to
   * `isPaletteId` alone the caller gets "not a palette" and has to decide what
   * that means, which is how a stale preference becomes a blank theme.
   */
  it("resolves a retired, unknown or missing preference to the default", () => {
    for (const stored of ["sand", "cinnamon", "violet", "", null]) {
      expect(resolvePaletteId(stored), `stored: ${String(stored)}`).toBe(DEFAULT_PALETTE_ID);
    }
    for (const id of Object.keys(PALETTES)) {
      expect(resolvePaletteId(id)).toBe(id);
    }
  });

  // The floating tab bar paints `surfaceTranslucent` over whatever scrolls
  // past. Pinning its opaque prefix to `surface` is what lets every contrast
  // pair already proved against `surface` carry over, so the bar's label can
  // never become unreadable by drifting to a colour nothing measured.
  it("keeps the translucent surface a faded `surface`, never a second colour", () => {
    for (const palette of shippedPalettes) {
      expect(palette.surfaceTranslucent.slice(0, 7)).toBe(palette.surface);
      const alpha = Number.parseInt(palette.surfaceTranslucent.slice(7), 16);
      expect(palette.surfaceTranslucent).toHaveLength(9);
      expect(alpha).toBeGreaterThanOrEqual(0xe0);
      expect(alpha).toBeLessThan(0xff);
    }
  });

  /**
   * Clay is the default and therefore the one users see without choosing.
   * Pinning it keeps the warm Helix ramp intentional for everyone who never
   * opens the theme picker.
   */
  it("keeps the default ramp exact", () => {
    expect(lightPalette).toMatchObject({
      background: "#F1EDE8", surface: "#FFFDFB", surfaceAlt: "#E7DFD7",
      surfaceHover: "#D7CCC1", surfaceStrong: "#C2B2A3", textStrong: "#2A211B",
      text: "#3A3028", textSecondary: "#62564C", textMuted: "#6D6157",
      primary: "#A55335", accentText: "#7B3A28", primaryStrong: "#88432D",
      primarySoft: "#EED8CC", border: "#8B796A",
    });
    expect(darkPalette).toMatchObject({
      background: "#090807", surface: "#191512", surfaceAlt: "#27211D",
      surfaceHover: "#352D28", surfaceStrong: "#473D36", textStrong: "#F2ECE6",
      text: "#E5DDD6", textSecondary: "#BEB2A8", textMuted: "#9D9289",
      primary: "#D88967", accentText: "#E7A68B", primaryStrong: "#BE6B4A",
      primarySoft: "#3C2A22", border: "#5F534A",
    });
  });

  /**
   * Layers have to be readable as layers.
   *
   * A card used to be a per-cent lighter than the page behind it and leaned on
   * its shadow to exist at all — the "everything looks flat" the owner kept
   * reporting. Note the light ramp is not monotonic by design: the page is a
   * toned paper and the card is brighter than it, so the card lifts. What is
   * required is SEPARATION at every join, not a direction.
   *
   * The floor is per scheme because contrast ratios compress at the bottom of
   * the scale: two charcoals nine RGB points apart are plainly different to the
   * eye and only 1.10:1 apart on paper. Holding dark to the light floor would
   * force the whole dark ramp pale to satisfy arithmetic that does not describe
   * what a person sees there.
   */
  it("keeps each surface layer distinguishable from the one under it", () => {
    const ramp = ["background", "surface", "surfaceAlt", "surfaceHover", "surfaceStrong"] as const;
    for (const { light, dark } of Object.values(PALETTES)) {
      for (const [palette, floor] of [[light, 1.14], [dark, 1.1]] as const) {
        for (let i = 0; i < ramp.length - 1; i++) {
          const [under, over] = [palette[ramp[i]!], palette[ramp[i + 1]!]];
          expect(contrastRatio(under, over), `${ramp[i]} → ${ramp[i + 1]} (${under} → ${over})`)
            .toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });

  /**
   * Nothing in the app is a colour that belongs to no theme.
   *
   * Pure white and pure black are the two colours with no temperature at all;
   * every token here carries a trace of its own palette instead, which is what
   * keeps a dark background a warm charcoal rather than a void.
   */
  it("uses no pure white or pure black", () => {
    for (const palette of shippedPalettes) {
      for (const [role, value] of Object.entries(palette)) {
        expect(value.slice(0, 7).toUpperCase(), `${role}`).not.toBe("#FFFFFF");
        expect(value.slice(0, 7).toUpperCase(), `${role}`).not.toBe("#000000");
      }
    }
  });

  it("keeps light semantic accents on the green/red/amber contract", () => {
    for (const { light } of Object.values(PALETTES)) expectSemanticHues(light);
  });

  it("keeps dark semantic accents on the green/red/amber contract", () => {
    for (const { dark } of Object.values(PALETTES)) expectSemanticHues(dark);
  });

  it("keeps status, destructive-action and financial-direction roles explicit", () => {
    for (const palette of shippedPalettes) {
      expect(palette.success).toBe(palette.positive);
      expect(palette.successText).toBe(palette.positiveText);
      expect(palette.error).toBe(palette.negative);
      expect(palette.errorText).toBe(palette.negativeText);
      expect(palette.destructive).toBe(palette.negative);
      expect(palette.onDestructive).toBeDefined();
    }
  });

  /**
   * Semantics are per theme now, so the guarantee moves from "the same colour"
   * to "the same meaning": whatever green a palette tunes, it stays decisively
   * green, and its red decisively red. A theme may change their temperature and
   * may not weaken which way they point.
   *
   * Deliberately no luminance test between them. A first draft demanded the two
   * differ in brightness and failed at 1.27:1 — a green and a red of similar
   * lightness is normal, they are told apart by hue and by the sign in front of
   * the figure, and the rule would have forced one of them off its own palette
   * to satisfy a requirement the design never had.
   */
  it("keeps income and expense unmistakable in every theme", () => {
    for (const palette of shippedPalettes) {
      const [pr, pg] = channels(palette.positive);
      const [nr, ng] = channels(palette.negative);
      expect(pg - pr, `positive ${palette.positive} must lean green`).toBeGreaterThan(20);
      expect(nr - ng, `negative ${palette.negative} must lean red`).toBeGreaterThan(20);
    }
  });

  /** The balance stays neutral and must remain readable on both layer depths. */
  it("keeps the balance instrument readable in both schemes", () => {
    for (const { light, dark } of Object.values(PALETTES)) {
      for (const [palette, scheme] of [[light, "light"], [dark, "dark"]] as const) {
        const { fill, ink } = heroSurface(palette, scheme);
        expect(contrastRatio(ink, fill), `${scheme}: ${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps every shipped foreground at WCAG AA", () => {
    for (const palette of shippedPalettes) expectBodyTextContrast(palette);
  });

  it("keeps semantic card copy readable on its tinted surface", () => {
    const tones = [
      ["success", "successText"],
      ["warning", "warningText"],
      ["error", "errorText"],
    ] as const;
    for (const palette of shippedPalettes) {
      for (const [tone, foreground] of tones) {
        const fill = blend(palette[tone], palette.surface, 0x14 / 255);
        expect(
          contrastRatio(palette[foreground], fill),
          `${foreground} (${palette[foreground]}) on ${tone} card (${fill})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  /**
   * The waiting caption pulses, so its faintest frame is the one that has to
   * pass — a token that clears AA at full strength says nothing about the
   * trough. The floor is read from `motion.ts` rather than restated here, so
   * deepening the pulse fails this test instead of quietly dimming the only
   * text on the sign-in and sign-out screens.
   */
  it("keeps the waiting caption readable at the bottom of its pulse", () => {
    const source = readFileSync("src/ui/motion.ts", "utf8");
    const floor = Number(/WAITING_PULSE_FLOOR = ([\d.]+)/.exec(source)?.[1]);
    expect(floor).toBeGreaterThan(0);
    for (const palette of shippedPalettes) {
      // `hexToRgb` is normalised to 0–1, so scale back before re-encoding.
      const bg = hexToRgb(palette.background);
      const fg = hexToRgb(palette.text);
      const dimmed = `#${fg
        .map((value, index) =>
          Math.round((floor * value + (1 - floor) * (bg[index] ?? 0)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
      expect(contrastRatio(dimmed, palette.background), `dimmed text on ${palette.background}`)
        .toBeGreaterThanOrEqual(4.5);
    }
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
    for (const palette of shippedPalettes) {
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
    for (const palette of shippedPalettes) {
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
        [palette.primary, "primary"],
        [palette.primaryStrong, "primary"],
        [palette.accentText, "primary"],
        [palette.positive, "green"],
        [palette.warning, "amber"],
        [palette.negative, "red"],
        [palette.surfaceStrong, "neutral"],
        [palette.textSecondary, "neutral"],
      ]);

    for (const palette of shippedPalettes) {
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
    expect(badgeHue("Netflix")).toBe(10);
    expect(initialsBadgeColor("Netflix")).toBe("#a75444");
    expect(badgeHue("Spotify")).toBe(90);
    expect(initialsBadgeColor("Spotify")).toBe("#557b30");
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
