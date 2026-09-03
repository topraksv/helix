import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND, brandPlate } from "../src/ui/brand-colors";
import { badgeHue, initialsBadgeColor } from "../src/ui/badge-color";
import { INVESTMENT_ASSET_TYPES } from "../src/domain/investments";
import { chartSeriesColors, darkPalette, DEFAULT_PALETTE_ID, generatedBadgeForeground, heroSurface, lightPalette, PALETTES, resolvePaletteId, type Palette } from "../src/ui/theme";

/** sRGB hex to CIE Lab (D65), for perceptual difference rather than luminance. */
function toLab(hex: string): [number, number, number] {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${hex}`);
  const [r, g, b] = channels.map((value) => {
    const c = Number.parseInt(value, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function lchHue(hex: string): number {
  const [, a, b] = toLab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

/** CIEDE2000. Below ~10 two fills stop being two categories to a reader. */
function deltaE2000(hexA: string, hexB: string): number {
  const [L1, a1, b1] = toLab(hexA);
  const [L2, a2, b2] = toLab(hexB);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2p = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dhp = C1p * C2p === 0 ? 0 : (((h2p - h1p + 180) % 360) - 180);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(60 * Math.exp(-(((hbp - 275) / 25) ** 2))))
    * (2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)));
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/**
 * Brettel/Viénot deuteranopia, the common red-green deficiency (~6% of men).
 *
 * This is the case the old ramp failed hardest: two pairs measured ΔE 1.1,
 * which is one colour wearing two names in the legend.
 */
function simulateDeuteranopia(hex: string): string {
  const channels = hex.match(/[0-9a-f]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${hex}`);
  const [r, g, b] = channels.map((value) => {
    const c = Number.parseInt(value, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const S = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  const Md = 0.494207 * L + 1.24827 * S;
  const back = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    const encoded = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255).toString(16).padStart(2, "0");
  };
  return "#"
    + back(0.080944 * L - 0.130504 * Md + 0.116721 * S)
    + back(-0.0102485 * L + 0.0540194 * Md - 0.113615 * S)
    + back(-0.000365 * L - 0.00412 * Md + 0.693513 * S);
}

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
      surfaceStrong: "#C2B2A3", textStrong: "#2A211B",
      text: "#3A3028", textSecondary: "#62564C", textMuted: "#6D6157",
      primary: "#A55335", accentText: "#7B3A28", primaryStrong: "#88432D",
      primarySoft: "#EED8CC", border: "#8B796A",
    });
    expect(darkPalette).toMatchObject({
      background: "#090807", surface: "#191512", surfaceAlt: "#27211D",
      surfaceStrong: "#473D36", textStrong: "#F2ECE6",
      text: "#E5DDD6", textSecondary: "#BEB2A8", textMuted: "#9D9289",
      primary: "#D88967", accentText: "#E7A68B", primaryStrong: "#BE6B4A",
      primarySoft: "#3C2A22", border: "#807064",
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
  /**
   * A hover is the quietest thing a control says, and it says it the same way
   * everywhere.
   *
   * The tokens this replaced were picked per palette by eye, and it showed:
   * surface → surfaceHover measured 1.253:1 in Petrol Dark against 1.556:1 in
   * Amber Light, so the same pointer resting on the same control was almost
   * twice as loud depending on which theme was on. Both ends were also far past
   * what the state means — 1.5:1 is what a SELECTED row is allowed, and a
   * pointer passing over something has not selected it.
   *
   * One alpha of the palette's own ink, composited over whatever is underneath,
   * is what makes the step identical: it is measured here against three
   * different surfaces precisely because a row sits on a card, a chip sits on
   * `surfaceAlt`, and a matrix cell sits on the table.
   */
  it("moves every palette by the same amount under a pointer", () => {
    const composite = (base: string, tint: string, alpha: number) =>
      `#${[1, 3, 5]
        .map((at) => Math.round(
          Number.parseInt(base.slice(at, at + 2), 16) * (1 - alpha)
            + Number.parseInt(tint.slice(at, at + 2), 16) * alpha,
        ))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")}`;
    // Kept in step with `INTERACTION_ALPHA` in `src/ui/interaction.ts`.
    const [hover, pressed] = [0.06, 0.11];
    const steps: number[] = [];
    for (const palette of shippedPalettes) {
      for (const under of [palette.surface, palette.surfaceAlt, palette.primarySoft] as const) {
        const hovered = contrastRatio(under, composite(under, palette.textStrong, hover));
        const held = contrastRatio(under, composite(under, palette.textStrong, pressed));
        // Visible at all — a state nobody can see is a control that gets
        // clicked twice.
        expect(hovered, `hover on ${under}`).toBeGreaterThan(1.05);
        // And never as loud as a selection.
        expect(hovered, `hover on ${under}`).toBeLessThan(1.25);
        // Pressed has to be plainly deeper than hover, or the pointer cannot
        // tell "I am over it" from "I am on it".
        expect(held, `pressed on ${under}`).toBeGreaterThan(hovered);
        steps.push(hovered);
      }
    }
    // The whole point: one gesture, one size, in every theme and on every
    // surface. The old tokens spread 0.303 across the six palettes.
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.09);
  });

  it("keeps each surface layer distinguishable from the one under it", () => {
    const ramp = ["background", "surface", "surfaceAlt", "surfaceStrong"] as const;
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

  /** The waiting surface is static, so its normal text token must clear AA. */
  it("keeps the static waiting caption readable on its surface", () => {
    const source = readFileSync("src/ui/motion.ts", "utf8");
    expect(source).not.toContain("WAITING_PULSE_FLOOR");
    for (const palette of shippedPalettes) {
      expect(contrastRatio(palette.text, palette.surface), `waiting text on ${palette.surface}`)
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
    const controlSurfaces = ["background", "surface", "surfaceAlt", "primarySoft"] as const;
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

  /**
   * The categorical ramp, measured rather than described.
   *
   * The test that stood here claimed to "mirror `useSeriesColors`, which cannot
   * be imported (it is a hook)" — and had drifted: it checked eight tokens
   * (`positive`, `warning`, `negative`, `accentText` …) that the hook had
   * stopped returning, so for as long as it was green it was guarding a ramp
   * that did not exist. That is why none of the following was caught:
   *
   *   - `surfaceStrong` sat in slot 2 and measured 1.68-2.03 against the
   *     surfaces it was drawn on, where a graphical object owes 3:1;
   *   - the three `*Strong` entries were 7.4-8.6 ΔE from their own base hue;
   *   - under deuteranopia two pairs fell to ΔE 1.1 — one colour, not two.
   *
   * The fix is structural: the ramp is a plain function, so this imports the
   * real thing. And the assertions are measurements, so a future ramp has to
   * earn its slot rather than be described accurately.
   */
  const SURFACES = shippedPalettes.flatMap((p) => [p.surface, p.surfaceAlt]);

  it("keeps every series colour legible on every surface it is drawn on", () => {
    for (const scheme of ["light", "dark"] as const) {
      const grounds = shippedPalettes
        .filter((p) => (luminance(p.surface) > 0.5) === (scheme === "light"))
        .flatMap((p) => [p.surface, p.surfaceAlt]);
      for (const colour of chartSeriesColors(scheme)) {
        for (const ground of grounds) {
          expect(
            contrastRatio(colour, ground),
            `series ${colour} on ${ground} (${scheme})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
    expect(SURFACES.length).toBeGreaterThan(0);
  });

  /**
   * A chart mark never comes from a surface token.
   *
   * The wallet ring painted free cash in `surfaceStrong` — the colour that
   * looks like the right answer for "this one is not a category", and the one
   * value the ramp's own note above records as measured and rejected. The
   * numbers below re-derive why: against the ring's unfilled track it lands
   * around 1.5, where a graphical object owes 3. Cash is usually the largest
   * thing in the wallet, so the ring's biggest slice read as the part of the
   * ring nobody had filled in — and selecting it painted the centre readout in
   * that same colour, so a lock that HAD been taken showed nothing at all. It
   * was reported as the ring refusing to lock, which is exactly how it looked.
   *
   * `walletDonutSlices` now emits ramp entries only, so this pins the reason
   * rather than the symptom: any surface token fails the floor a mark must
   * clear, whichever ground it is drawn on.
   */
  it("rules out every surface token as a chart mark", () => {
    for (const palette of shippedPalettes) {
      for (const token of ["surface", "surfaceAlt", "surfaceStrong"] as const) {
        for (const ground of [palette.surface, palette.surfaceAlt]) {
          expect(
            contrastRatio(palette[token], ground),
            `${token} (${palette[token]}) as a mark on ${ground}`,
          ).toBeLessThan(3);
        }
      }
    }
  });

  /**
   * Cash keeps the ramp's last slot, and no asset type can reach it.
   *
   * The wallet binds a colour to an asset type's POSITION in the canonical
   * list, and cash — which is not an asset type — takes the far end. That only
   * stays a rule while the list is shorter than the ramp; a seventh type is
   * fine, a ninth would silently hand cash's colour to a holding.
   */
  it("leaves the wallet ring a slot no asset type can take", () => {
    // Spelled out because the ORDER is the contract: position N in this list is
    // colour N in the ring, so a reorder recolours holdings someone has already
    // learned to read, and this is where that has to be argued rather than
    // noticed.
    expect(INVESTMENT_ASSET_TYPES).toEqual(["metal", "currency", "equity", "fund", "crypto", "pension"]);
    expect(INVESTMENT_ASSET_TYPES.length).toBeLessThan(chartSeriesColors("light").length);
    expect(new Set(INVESTMENT_ASSET_TYPES).size).toBe(INVESTMENT_ASSET_TYPES.length);
  });

  it("keeps every pair of series colours apart, in normal and red-green vision", () => {
    for (const scheme of ["light", "dark"] as const) {
      const ramp = chartSeriesColors(scheme);
      expect(ramp).toHaveLength(8);
      for (let i = 0; i < ramp.length; i += 1) {
        for (let j = i + 1; j < ramp.length; j += 1) {
          const a = ramp[i]!;
          const b = ramp[j]!;
          expect(deltaE2000(a, b), `${scheme}: ${a} vs ${b}`).toBeGreaterThanOrEqual(10);
          expect(
            deltaE2000(simulateDeuteranopia(a), simulateDeuteranopia(b)),
            `${scheme}: ${a} vs ${b} under deuteranopia`,
          ).toBeGreaterThanOrEqual(9);
        }
      }
    }
  });

  /**
   * Why a selected chart mark is emphasised rather than the others faded.
   *
   * Fading is the obvious way to say "this one, not those", and it is not
   * available here: the ramp is designed to sit just above the 3:1 floor the
   * test above enforces, so there is no headroom to spend on an alpha. This
   * pins the arithmetic that ruled it out, and it is written as a THRESHOLD
   * rather than as a ban — if the ramp is ever rebuilt with real headroom,
   * this test is where that becomes visible.
   */
  it("leaves no headroom for de-emphasising a mark with opacity", () => {
    let worstFull = Infinity;
    let worstDimmed = Infinity;
    for (const scheme of ["light", "dark"] as const) {
      const grounds = shippedPalettes
        .filter((p) => (luminance(p.surface) > 0.5) === (scheme === "light"))
        .flatMap((p) => [p.surface, p.surfaceAlt]);
      for (const colour of chartSeriesColors(scheme)) {
        for (const ground of grounds) {
          worstFull = Math.min(worstFull, contrastRatio(colour, ground));
          // 0.8 is the gentlest fade anyone would reach for; if even that
          // fails, every stronger one does too.
          worstDimmed = Math.min(worstDimmed, contrastRatio(blend(colour, ground, 0.8), ground));
        }
      }
    }
    // The ramp clears the floor, and clears it by too little to fade.
    expect(worstFull).toBeGreaterThanOrEqual(3);
    expect(worstFull).toBeLessThan(3.5);
    expect(worstDimmed).toBeLessThan(3);
  });

  /**
   * A category's colour has to survive a theme change.
   *
   * The dark ramp was measured for separation and never for identity, and six
   * of its eight entries changed hue family outright — crimson to peach, gold
   * to green, olive to pink. Someone on the "Sistem" theme watched every
   * category in every chart change colour at sunset. This app already holds
   * that line for semantic colour (income stays green, spending stays red);
   * a categorical colour is an encoding too.
   */
  it("draws the same category in the same hue in both themes", () => {
    const light = chartSeriesColors("light");
    const dark = chartSeriesColors("dark");
    expect(dark).toHaveLength(light.length);
    for (let i = 0; i < light.length; i += 1) {
      const gap = Math.abs(lchHue(light[i]!) - lchHue(dark[i]!));
      expect(
        Math.min(gap, 360 - gap),
        `series ${i}: ${light[i]} (light) vs ${dark[i]} (dark)`,
      ).toBeLessThanOrEqual(6);
    }
  });

  it("keeps purple and magenta out of the ramp, as everywhere else", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const colour of chartSeriesColors(scheme)) {
        const hue = lchHue(colour);
        expect(hue > 288 && hue < 356, `${colour} sits in the purple/magenta band`).toBe(false);
      }
    }
  });

  it("never lets a category colour double as a status colour", () => {
    const statuses = new Set(
      shippedPalettes.flatMap((p) => [p.positive, p.negative, p.success, p.error, p.warning, p.destructive]
        .map((c) => c.toLowerCase())),
    );
    for (const scheme of ["light", "dark"] as const) {
      for (const colour of chartSeriesColors(scheme)) {
        expect(statuses.has(colour.toLowerCase()), `${colour} is also a status colour`).toBe(false);
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
