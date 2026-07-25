import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  borderWidth,
  controlSize,
  elevation,
  font,
  iconSize,
  layer,
  radius,
  stateOpacity,
  toggleSize,
  type,
} from "../src/ui/theme";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("design-system metric contracts", () => {
  it("keeps compact controls, touch targets and regular fields distinct", () => {
    expect(controlSize).toEqual({
      compact: 36,
      minimumTarget: 44,
      regular: 48,
      inputAccessoryWidth: 42,
      inputAccessoryInset: 44,
    });
    expect(controlSize.compact).toBeLessThan(controlSize.minimumTarget);
    expect(controlSize.minimumTarget).toBeLessThan(controlSize.regular);
    expect(iconSize).toEqual({ compact: 15, control: 17, accessory: 18, headerBack: 24 });
    expect(borderWidth).toEqual({ control: 1.5, toggle: 1 });
  });

  it("preserves exact geometry while replacing historical arithmetic aliases", () => {
    expect(radius.md).toBe(radius.sm + 2);
    expect(toggleSize).toEqual({ width: 46, height: 28, padding: 3 });
    expect(layer.dragActive).toBe(10);
    expect(elevation.dragActive).toBe(6);
  });

  it("keeps distinct disabled and transient-state weights intentional", () => {
    expect(stateOpacity).toEqual({
      buttonDisabled: 0.45,
      iconDisabled: 0.4,
      controlDisabled: 0.5,
      fieldDisabled: 0.6,
      pressed: 0.85,
      calendarDisabled: 0.3,
      dragActive: 0.96,
    });
  });
});

describe("design-system typography contracts", () => {
  it("maps semantic control text to the loaded font faces without changing metrics", () => {
    expect(type.button).toEqual({ fontSize: 15, fontFamily: font.medium });
    expect(type.buttonCompact).toEqual({ fontSize: 13, fontFamily: font.medium });
    expect(type.field).toEqual({ fontSize: 15, fontFamily: font.regular });
    expect(type.moneyInput).toEqual({
      fontSize: 17,
      fontFamily: font.semibold,
      fontVariant: ["tabular-nums"],
    });
  });

  it("keeps raw Inter face names inside the theme and font loader only", () => {
    const offenders = sourceFiles("src").filter((path) => {
      if (path === "src/ui/theme.ts" || path === "src/app/_layout.tsx") return false;
      return /Inter_[4567]00/.test(readFileSync(join(root, path), "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});

/**
 * A centred icon must land on a whole device pixel.
 *
 * The header back chevron was 25pt inside a 44pt target, so each side got
 * (44 - 25) / 2 = 9.5pt. A browser paints that as-is, which is why the web
 * header looked right; React Native rounds layout to the device pixel grid, so
 * on a @3x screen 28.5 physical px became 29 on one side and 28 on the other
 * and the glyph sat visibly off-centre inside its own circular target.
 */
describe("centred icons resolve to whole pixels on every supported density", () => {
  const DENSITIES = [1, 2, 3];
  const inset = (controlSize.minimumTarget - iconSize.headerBack) / 2;

  it("insets the back chevron by a whole point inside its touch target", () => {
    expect(iconSize.headerBack).toBeLessThan(controlSize.minimumTarget);
    expect(Number.isInteger(inset)).toBe(true);
  });

  it("leaves no rounding remainder to bias one side", () => {
    for (const density of DENSITIES) {
      expect(inset * density).toBe(Math.round(inset * density));
      // Both sides get the identical physical inset, so neither can absorb a
      // half-pixel the other does not.
      expect(controlSize.minimumTarget * density - iconSize.headerBack * density).toBe(inset * density * 2);
    }
  });

  it("keeps the chevron large enough to stay legible in the header", () => {
    expect(iconSize.headerBack).toBeGreaterThan(iconSize.accessory);
  });

  it("draws the back control from the token, not a literal that can drift again", () => {
    const source = readFileSync(join(root, "src/ui/header-back.tsx"), "utf8");
    expect(source).toContain("size={iconSize.headerBack}");
    expect(source).not.toMatch(/size=\{\d/);
  });
});
