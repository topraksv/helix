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
import { modalAnimationType } from "../src/ui/modal-motion";

const root = process.cwd();

const canonicalPresentationFiles = [
  "src/ui/components.tsx",
  "src/ui/charts.tsx",
  "src/ui/header-bar.tsx",
  "src/ui/tab-bar.tsx",
] as const;

// Small measured micro-insets (for example a chart marker offset) are allowed;
// a new layout rhythm value still has to come from the shared scale.
const allowedSpacingValues = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 17, 24, 32, 36, 42, 44, 46, 48]);

function presentationViolations(source: string, path: string): string[] {
  const violations: string[] = [];
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;
  const rawColor = /\b(?:color|backgroundColor|borderColor|shadowColor|tintColor|fill|stroke):\s*["'](?:#|rgba?\()/g;
  for (const match of source.matchAll(rawColor)) {
    violations.push(`${path}:${lineAt(match.index!)} raw color`);
  }

  const spacing = /\b(?:padding(?:Top|Bottom|Left|Right|Horizontal|Vertical)?|margin(?:Top|Bottom|Left|Right|Horizontal|Vertical)?|gap|rowGap|columnGap):\s*(-?\d+(?:\.\d+)?)/g;
  for (const match of source.matchAll(spacing)) {
    if (!allowedSpacingValues.has(Number(match[1]))) {
      violations.push(`${path}:${lineAt(match.index!)} off-scale spacing ${match[1]}`);
    }
  }

  for (const obsolete of ["AnimatedPressable", "useSpringPress"]) {
    if (source.includes(obsolete)) violations.push(`${path} obsolete primitive ${obsolete}`);
  }
  return violations;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("design-system metric contracts", () => {
  it("removes modal transitions when the operating system requests reduced motion", () => {
    expect(modalAnimationType(true)).toBe("none");
    expect(modalAnimationType(false)).toBe("fade");
  });

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
      pressed: 0.85,
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

describe("interaction feedback contracts", () => {
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8");
  const calendar = readFileSync(join(root, "src/ui/calendar.tsx"), "utf8");
  const stickyTable = readFileSync(join(root, "src/ui/sticky-table.tsx"), "utf8");
  const tabBar = readFileSync(join(root, "src/ui/tab-bar.tsx"), "utf8");
  const cashFlow = readFileSync(join(root, "src/app/(tabs)/cash-flow/index.tsx"), "utf8");
  const button = components.slice(
    components.indexOf("export function Button("),
    components.indexOf("/** Circular icon-only button"),
  );
  const card = components.slice(
    components.indexOf("export function Card("),
    components.indexOf("/** Quiet tonal hero container"),
  );
  const iconButton = components.slice(
    components.indexOf("export function IconButton("),
    components.indexOf("/** Bounded month navigator"),
  );
  const select = components.slice(
    components.indexOf("export function Select<"),
    components.indexOf("/** Horizontal segmented selector"),
  );
  const toggle = components.slice(
    components.indexOf("export function Toggle("),
    components.indexOf("/** Initials avatar"),
  );

  it("keeps generic actions quiet and uses a tonal pressed state instead of universal scale motion", () => {
    expect(button).toContain('haptic: hapticKind = "none"');
    expect(iconButton).toContain('haptic: hapticKind = "none"');
    expect(components).not.toContain("useSpringPress");
    expect(components).not.toContain("AnimatedPressable");
    expect(button).toContain("pressed");
    expect(components).toContain("backgroundColor: pressed ? palette.surfaceHover");
  });

  it("keeps loading actions visually active while preventing a second press", () => {
    expect(button).toContain("const visuallyDisabled = Boolean(disabled && !loading)");
    expect(button).toContain("disabled={disabled || loading}");
    expect(button).toContain("busy: Boolean(loading)");
  });

  it("reserves selection haptics for controls that actually change a choice", () => {
    expect(select).toContain("selectionTapIfChanged(value, option.value)");
    expect(toggle).toContain("selectionTap()");
    expect(calendar).toContain("selectionTapIfChanged(value, iso)");
  });

  it("keeps disabled control content readable instead of fading the whole control", () => {
    expect(components).not.toMatch(/opacity: disabled \? stateOpacity\./);
    expect(calendar).not.toMatch(/opacity: disabled \? stateOpacity\./);
  });

  it("keeps table editing and navigation quiet while pin changes use selection feedback", () => {
    expect(stickyTable).not.toContain("lightTap");
    expect(cashFlow).not.toContain("lightTap");
    expect(stickyTable).toContain("selectionTap(); onTogglePin!");
    expect(stickyTable).toContain("selectionTap(); onUnpin()");
  });

  it("keeps the owner's drag-across footer navigation on every viewport", () => {
    expect(tabBar).toContain("PanResponder.create");
    expect(tabBar).toContain("onPanResponderMove");
    expect(tabBar).toContain("{...pan.panHandlers}");
    expect(tabBar).not.toContain("desktopRail");
  });

  it("renders semantic card states from the shared primitive instead of invisible border colours", () => {
    expect(card).toContain('tone?: "success" | "warning" | "error"');
    expect(card).toContain("borderWidth: StyleSheet.hairlineWidth");
    expect(card).toContain('borderColor: toneColor ? toneColor + "66" : palette.border + "70"');
    for (const path of sourceFiles("src/app")) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source, path).not.toMatch(/<Card[^>]*borderColor: palette\.(?:success|warning|error)/);
    }
  });

  it("keeps shared presentation code on tokens and rejects injected violations", () => {
    const current = canonicalPresentationFiles.flatMap((path) =>
      presentationViolations(readFileSync(join(root, path), "utf8"), path),
    );
    expect(current).toEqual([]);

    const injected = presentationViolations(
      'const bad = { backgroundColor: "#123456", padding: 13, component: AnimatedPressable };',
      "injected.tsx",
    );
    expect(injected).toEqual([
      "injected.tsx:1 raw color",
      "injected.tsx:1 off-scale spacing 13",
      "injected.tsx obsolete primitive AnimatedPressable",
    ]);
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
