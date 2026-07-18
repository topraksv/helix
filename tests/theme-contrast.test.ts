import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/domain/color-contrast";
import { darkPalette, lightPalette, type Palette } from "../src/ui/theme";

function expectBodyTextContrast(palette: Palette): void {
  const surfacePairs = [
    [palette.text, palette.background],
    [palette.text, palette.surface],
    [palette.textMuted, palette.background],
    [palette.textMuted, palette.surface],
    [palette.textMuted, palette.surfaceAlt],
    [palette.primaryText, palette.surface],
    [palette.primaryText, palette.primarySoft],
    [palette.positiveText, palette.surface],
    [palette.negativeText, palette.surface],
    [palette.warningText, palette.surface],
    [palette.primaryText, palette.surfaceAlt],
    [palette.positiveText, palette.surfaceAlt],
    [palette.negativeText, palette.surfaceAlt],
    [palette.warningText, palette.surfaceAlt],
  ] as const;
  for (const [foreground, background] of surfacePairs) {
    expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.onPrimary, palette.gradientFrom)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.onPrimary, palette.gradientTo)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.onNegative, palette.negative)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(palette.controlBorder, palette.surface)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(palette.controlBorder, palette.background)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(palette.controlBorder, palette.surfaceAlt)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(palette.focus, palette.surfaceAlt)).toBeGreaterThanOrEqual(3);
  for (const accent of [palette.primary, palette.positive, palette.negative, palette.warning]) {
    expect(contrastRatio(accent, palette.surface)).toBeGreaterThanOrEqual(3);
  }
}

describe("semantic theme contrast", () => {
  it("keeps every light-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(lightPalette);
  });

  it("keeps every dark-theme body foreground at WCAG AA", () => {
    expectBodyTextContrast(darkPalette);
  });
});
