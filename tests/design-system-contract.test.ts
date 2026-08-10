import { readFileSync, readdirSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  borderWidth,
  contentWidth,
  controlSize,
  elevation,
  font,
  actionTile,
  actionTileMetrics,
  iconSize,
  layer,
  motion,
  radius,
  spacing,
  stateOpacity,
  staggerDelay,
  toggleSize,
  type,
} from "../src/ui/theme";
import { modalAnimationType } from "../src/ui/modal-motion";
import { BRAND } from "../src/ui/brand-colors";
import { foldForMatch, nameMentions } from "../src/domain/logo-domain";
import { fittedQuickDays, shouldPairDashboardPanels, shouldPairFilterCards } from "../src/ui/responsive";

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



describe("design-system metric contracts", () => {
  it("keeps displayed money on the shared compact formatter", () => {
    const displaySources = [
      ...sourceFiles("src/app", { atLeast: 40 }),
      ...sourceFiles("src/ui", { atLeast: 50 }),
      ...sourceFiles("src/services", { atLeast: 8 }),
    ];
    const offenders = displaySources.filter((path) => /\bformatMinor\s*\(/.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
    const localInputFormatters = displaySources
      .filter((path) => path !== "src/services/export-import.ts")
      .filter((path) => /\.toFixed\(\s*2\s*\)/.test(readFileSync(join(root, path), "utf8")));
    expect(localInputFormatters).toEqual([]);
  });

  it("removes modal transitions when the operating system requests reduced motion", () => {
    expect(modalAnimationType(true)).toBe("none");
    expect(modalAnimationType(false)).toBe("fade");
  });

  it("keeps compact controls, touch targets and regular fields distinct", () => {
    expect(controlSize).toEqual({
      compact: 36,
      minimumTarget: 44,
      regular: 48,
      segmented: 52,
      inputAccessoryWidth: 42,
      inputAccessoryInset: 44,
    });
    expect(controlSize.compact).toBeLessThan(controlSize.minimumTarget);
    expect(controlSize.minimumTarget).toBeLessThan(controlSize.regular);
    expect(controlSize.segmented).toBeGreaterThan(controlSize.regular);
    // `emoji` is a glyph standing in for an icon, so it is sized with the
    // marks and not with the copy beside it.
    expect(iconSize).toEqual({ compact: 15, control: 17, accessory: 18, headerBack: 24, emoji: 14 });
    // `selected` replaces the `selected ? 2 : 1` written into five screens and
    // the `selected ? 1.5 : hairline` written into two more.
    expect(borderWidth).toEqual({ control: 1.5, toggle: 1, selected: 2 });
  });

  it("derives dense action rails from the shared type and spacing scale", () => {
    const wide = actionTileMetrics(false);
    const narrow = actionTileMetrics(true);
    expect(actionTile.padding).toBe(spacing.sm);
    expect(actionTile.gap).toBe(spacing.xs);
    expect(wide.height).toBeGreaterThan(0);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(wide.height).toBe(
      actionTile.padding * 2
        + actionTile.iconSize
        + actionTile.gap * 2
        + wide.labelHeight
        + wide.captionHeight,
    );
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
      disabled: 0.45,
      dragActive: 0.96,
    });
  });

  it("routes animation tuning through named motion families", () => {
    expect(motion.spring.entrance).toEqual({ damping: 18, stiffness: 170, mass: 1 });
    expect(motion.spring.toggle).toEqual({ speed: 20, bounciness: 6 });
    expect(motion.loading).toBe(1200);
    expect(motion.loadingReveal).toBe(350);
  });
});

describe("design-system typography contracts", () => {
  it("maps semantic control text to the loaded font faces without changing metrics", () => {
    expect(type.button).toEqual({ fontSize: 15, fontFamily: font.medium });
    expect(type.buttonCompact).toEqual({ fontSize: 13, fontFamily: font.medium });
    expect(type.moneyInput).toEqual({
      fontSize: 17,
      fontFamily: font.semibold,
      fontVariant: ["tabular-nums"],
    });
  });

  /**
   * Mobile Safari zooms the viewport when a focused input renders below 16px
   * and does not zoom back out on blur, so at 15 every text field in the app
   * left the user on a magnified page they had to pinch out of. WebKit chose 16
   * as the point where an input is legible without the enlarged viewport
   * (https://webkit.org/blog/5610/more-responsive-tapping-on-ios/). Every role
   * a `TextInput` can carry has to clear it.
   */
  it("never renders an input below the size that stops iOS zooming the page", () => {
    for (const role of [type.field, type.moneyInput, type.sectionTitle]) {
      expect(role.fontSize).toBeGreaterThanOrEqual(16);
    }
    expect(readFileSync(join(root, "src/ui/fields.tsx"), "utf8")).toContain("...type.field");
  });

  /**
   * One scale, and nothing under it.
   *
   * 107 inline `fontSize:` literals used to sit against a 13-role scale, six of
   * them at 9px — 25% below the smallest role the system declared. A size is a
   * decision about hierarchy, so it is made once, in `theme.ts`, and every
   * screen refers to it. Chart geometry is exempt: an SVG label's size is a
   * drawing input, not a typographic role.
   */
  it("declares every text size in the scale, never at a call site", () => {
    const offenders = sourceFiles("src", { atLeast: 150 })
      .filter((path) => path !== "src/ui/theme.ts" && path !== "src/ui/charts.tsx")
      .filter((path) => /fontSize:\s*\d/.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
    const sizes = Object.values(type).map((role) => role.fontSize);
    expect(Math.min(...sizes)).toBe(type.micro.fontSize);
    expect(type.micro.fontSize).toBe(10);
  });

  /**
   * A radius that reaches control size belongs to the scale. Below it the
   * numbers are illustration and chart geometry — a 4px bar cap is a drawing,
   * not a surface — and `circle()` says what a round box is instead of leaving
   * half its own width written out beside it.
   */
  it("gives every surface-sized corner a name", () => {
    const offenders = sourceFiles("src", { atLeast: 150 })
      .filter((path) => path !== "src/ui/theme.ts")
      .filter((path) => /borderRadius:\s*(?:[89]|[1-9]\d)\b/.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps raw Inter face names inside the theme and font loader only", () => {
    const offenders = sourceFiles("src", { atLeast: 150 }).filter((path) => {
      if (path === "src/ui/theme.ts" || path === "src/app/_layout.tsx") return false;
      return /Inter_[4567]00/.test(readFileSync(join(root, path), "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  /**
   * Measured from the shipped TTFs, not assumed.
   *
   * The old display face (Fraunces_700Bold) advanced its digits 978–1404 units
   * at 2000 upem — a 43.6% spread with no `tnum` to correct it — so a serif
   * figure would jump as a balance updated and would never align down a column.
   * IBM Plex Serif advances every digit exactly 600 at 1000 upem: tabular by
   * construction. The ban is nonetheless kept, because the reason a table stays
   * on one face is legibility at 11–13px and not only alignment, and because
   * Inter is the face every measured width in this app is calibrated against
   * (`ledgerCellWidth`, `compactMonthHeadWidth`, `amount-layout`).
   */
  it("keeps every figure role on the tabular Inter faces, never the brand serif", () => {
    for (const [name, role] of Object.entries(type)) {
      const carriesFigures = "fontVariant" in role || /^amount|^money/.test(name);
      if (!carriesFigures) continue;
      expect(role.fontFamily, `${name} must not use the serif`).not.toBe(font.serif);
      expect(
        (role as { fontVariant?: readonly string[] }).fontVariant,
        `${name} must request tabular figures`,
      ).toEqual(["tabular-nums"]);
    }
    expect(type.title.fontFamily, "screen titles carry the brand voice").toBe(font.serif);
    expect(type.display.fontFamily).toBe(font.serif);
  });
});

/**
 * Content width used to be a number each route picked for itself, and they
 * drifted: settings stopped at 920 while the dashboard beside it ran to 1120
 * and the ledger to 1200, so moving between two tabs on one desktop shifted the
 * whole page. A route now declares the STRUCTURE of its information and the
 * scale decides the pixels.
 */
describe("content width is a shared scale, not a per-route number", () => {
  it("orders the scale from a single decision up to dense financial data", () => {
    expect(contentWidth.focus).toBeLessThan(contentWidth.form);
    expect(contentWidth.form).toBeLessThan(contentWidth.workspace);
    expect(contentWidth.workspace).toBeLessThan(contentWidth.wide);
  });

  it("leaves no route setting its own pixel width", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/maxWidth=\{/g)) {
        offenders.push(`${path}:${source.slice(0, match.index!).split("\n").length}`);
      }
    }
    expect(offenders, "use <Screen width=…> from the contentWidth scale").toEqual([]);
  });

  /**
   * A desktop rail once broke the equality every responsive rule silently
   * relied on — that the window width and the content width are the same
   * number. The rail is gone, but the discipline stays: a layout rule asks its
   * column, not the window, so nothing that ever stands beside the content can
   * make every page wrong at once again.
   */
  it("measures layout rules against the content column, not the window", () => {
    // Two kinds of question, and only one of them may read the window. "What
    // kind of window is this?" decides how far the page holds off its own edges
    // — a property of the window itself. "How wide is my column?" is everything
    // else.
    const windowScoped = new Set(["shouldUseWideGutter"]);
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/(should[A-Z]\w*)\(\s*width\s*\)/g)) {
        if (windowScoped.has(match[1]!)) continue;
        offenders.push(`${path}:${source.slice(0, match.index!).split("\n").length} ${match[0]}`);
      }
    }
    expect(offenders, "pass useContentWidth() to layout predicates").toEqual([]);
  });

  it("gives every screen a width its structure earns", () => {
    const names = new Set(Object.keys(contentWidth));
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/<Screen\b[^>]*\bwidth="([a-z]+)"/g)) {
        if (!names.has(match[1]!)) offenders.push(`${path} unknown width "${match[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A chart is the one thing that cannot be laid out in percentages: `Bars` and
   * `Lines` need a pixel number. Every caller used to derive that number from
   * the window minus a guess at the chrome in between — `width - spacing.lg * 4`
   * — and the guess broke twice over once a 220px rail and a second column
   * appeared: at a 1024px window it asked for 928px inside a card that had 740.
   * `ChartFrame` measures the box instead, so the arithmetic has no way back in.
   */
  it("sizes pixel-width charts from their own container, never from the window", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      if (path === "src/ui/charts.tsx") continue;
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/width=\{[^}]*\bwidth\s*[-*]/g)) {
        offenders.push(`${path}:${source.slice(0, match.index!).split("\n").length} ${match[0]}`);
      }
    }
    expect(offenders, "wrap the chart in <ChartFrame> and use the measured width").toEqual([]);
  });
});

/**
 * The composition thresholds, ordered by how much content each one needs. They
 * are separate numbers because they answer different questions, and a single
 * shared `width >= 960` is what made the dashboard pair panels it had no room
 * for while a tablet spent its whole first screen on filter cards.
 */
describe("composition thresholds are ordered by the content they need", () => {
  it("pairs two filter cards long before it pairs two panels", () => {
    // Two filter cards need about 350px each; a dashboard panel pair needs a
    // ring, a legend and a payment list beside them.
    expect(shouldPairFilterCards(639)).toBe(false);
    expect(shouldPairFilterCards(640)).toBe(true);
    expect(shouldPairFilterCards(880)).toBe(true);
    // The panels are a pair of short rows, so they need less than the filter
    // cards, not more — each side holds a name and an amount.
    expect(shouldPairDashboardPanels(619)).toBe(false);
    expect(shouldPairDashboardPanels(620)).toBe(true);
  });

  it("keeps the tablet-portrait content column on the paired side of both rules", () => {
    // Navigation floats over the bottom at every width, so a tablet in portrait
    // gives its content the whole 768 minus the page gutter.
    const tabletContent = 768 - 24 * 2;
    expect(shouldPairFilterCards(tabletContent)).toBe(true);
    expect(shouldPairDashboardPanels(tabletContent)).toBe(true);
  });
});

describe("interaction feedback contracts", () => {
  // The leaf layer — text roles, `Button`, `IconButton`, `FadeIn`, `Amount`,
  // the status marks — was split out of `components.tsx` so that nothing in it
  // renders another Helix component and the calculator can take `Button`
  // without closing an import cycle. Both halves are read here.
  const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
  const fields = readFileSync(join(root, "src/ui/fields.tsx"), "utf8");
  const selectionControls = readFileSync(join(root, "src/ui/selection-controls.tsx"), "utf8");
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8")
    + primitives + fields + selectionControls;
  const calendar = readFileSync(join(root, "src/ui/calendar.tsx"), "utf8");
  const stickyTable = readFileSync(join(root, "src/ui/sticky-table.tsx"), "utf8");
  const tabBar = readFileSync(join(root, "src/ui/tab-bar.tsx"), "utf8");
  const cashFlow = readFileSync(join(root, "src/app/(tabs)/cash-flow/index.tsx"), "utf8");
  const button = primitives.slice(
    primitives.indexOf("export function Button("),
    primitives.indexOf("/** Circular icon-only button"),
  );
  const card = components.slice(
    components.indexOf("export function Card("),
    components.indexOf("/** Quiet tonal hero container"),
  );
  const iconButton = primitives.slice(primitives.indexOf("export function IconButton("));
  const select = selectionControls.slice(
    selectionControls.indexOf("export function Select<"),
    selectionControls.indexOf("/** Horizontal segmented selector"),
  );
  const toggle = fields.slice(fields.indexOf("export function Toggle("));

  it("keeps generic actions quiet and uses a tonal pressed state instead of universal scale motion", () => {
    expect(button).toContain('haptic: hapticKind = "none"');
    expect(iconButton).toContain('haptic: hapticKind = "none"');
    expect(components).not.toContain("useSpringPress");
    expect(components).not.toContain("AnimatedPressable");
    expect(button).toContain("pressed");
    expect(components).toContain("interactionSurface(palette, state)");
  });

  /**
   * One fill answers the pointer, everywhere.
   *
   * Before `interactionSurface` there were twenty-eight hand-written hover and
   * press fills across eighteen files, most of them reacting to `pressed` only
   * — so on a desktop pointer the majority of this app's controls said nothing
   * at all until they were clicked. The ones that did answer moved by different
   * amounts: 1.253:1 in Petrol Dark against 1.556:1 in Amber Light for the same
   * gesture, when a hover should be the quietest state a control has.
   *
   * The rule is not "use the helper" for its own sake: it is that a control's
   * response has to be the same size as every other control's, which cannot be
   * true while each call site picks its own colour.
   */
  it("routes every interaction fill through the one shared surface", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      if (path.endsWith("ui/interaction.ts")) continue;
      const source = readFileSync(path, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // A background chosen by the pressed or hovered flag is, by definition,
        // an interaction fill.
        if (!/backgroundColor.*\b(pressed|hovered)\b|\b(pressed|hovered)\b.*\?\s*(palette|p)\./.test(line)) continue;
        offenders.push(`${path}:${index + 1}`);
      }
    }
    expect(offenders, "an interaction fill that no other control shares").toEqual([]);
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
    for (const path of sourceFiles("src/app", { atLeast: 40 })) {
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

/**
 * `hitSlop` is implemented only by react-native-web's legacy `Touchable`, so on
 * the web it does nothing at all. Every compact control in this app leaned on
 * it: measured in a browser, a 32x32 row button's real hit area was 32x32, and
 * points 4px above, 6px left and 8px below it hit nothing. The box carries the
 * minimum now, and `hitSlop` is left only as the native courtesy it always was.
 */
describe("compact controls own a real minimum target", () => {
  const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8")
    + primitives
    + readFileSync(join(root, "src/ui/fields.tsx"), "utf8")
    + readFileSync(join(root, "src/ui/selection-controls.tsx"), "utf8");

  it("gives the icon button a minimum-target pressable and a compact visual chip", () => {
    const iconButton = primitives.slice(primitives.indexOf("export function IconButton("));
    expect(iconButton).toContain("minWidth: controlSize.minimumTarget");
    expect(iconButton).toContain("minHeight: controlSize.minimumTarget");
    // The painted chip is still the compact one, inside that box.
    expect(iconButton).toContain("size = controlSize.compact");
  });

  it("sizes a small button by the minimum target, not by the compact visual", () => {
    expect(components).toContain("minHeight: small ? controlSize.minimumTarget : controlSize.regular");
  });

  it("gives the switch the minimum height without moving its track", () => {
    const toggle = readFileSync(join(root, "src/ui/fields.tsx"), "utf8");
    expect(toggle).toContain("minHeight: controlSize.minimumTarget");
    expect(toggleSize.height).toBeLessThan(controlSize.minimumTarget);
  });

  it("keeps one icon-button size across the app", () => {
    const callers = readdirSync(join(root, "src"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
      .filter((text) => text.includes("<IconButton"));
    expect(callers.length).toBeGreaterThan(4);
    for (const text of callers) {
      expect(text).not.toMatch(/<IconButton[^>]*\ssize=\{/);
    }
  });
});

describe("primary, secondary and disabled are three different weights", () => {
  const components = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");

  it("outlines the secondary button and leaves the disabled one flat", () => {
    // Both used to paint `surfaceAlt` with only the label colour between them,
    // so a disabled "Kaydet" and an enabled "Kaydet ve Yeni Ekle" were the same
    // beige block and the form's primary action could not be found.
    expect(components).toContain(
      'borderWidth: visuallyDisabled ? 0 : variant === "secondary" ? borderWidth.control : 0',
    );
  });
});

/**
 * A press has to light the control, not a patch inside it.
 *
 * The ledger's tool row painted its pressed fill on a 30x28 box behind the
 * icon while the pressable was the whole column, so holding a tool lit a small
 * rectangle sitting above its own caption — the owner read that, correctly, as
 * uneven padding. The fill belongs to the pressable's own style callback, which
 * is the only box guaranteed to be the thing being pressed.
 */
describe("a press lights the control it is on", () => {
  it("paints every pressed fill on the pressable's own box", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      // Two deliberate exceptions, both for the same reason: the painted chip
      // is centred inside a larger minimum-size target, so the fill IS the
      // control that was pressed. `IconButton` in components.tsx, and the
      // calendar's day, whose 34pt circle sits inside a 44pt cell.
      if (path === "src/ui/components.tsx" || path === "src/ui/primitives.tsx" || path === "src/ui/calendar.tsx") continue;
      const source = readFileSync(join(root, path), "utf8");
      // The children-render form only — `style={({ pressed }) => ({` is the
      // correct one and looks almost identical, so it is excluded explicitly.
      // Each block is bounded by the Pressable it belongs to.
      for (const match of source.matchAll(/(?<!style=)\{\(\{ pressed \}\) => \(/g)) {
        const start = match.index!;
        const end = source.indexOf("</Pressable>", start);
        const block = source.slice(start, end < 0 ? source.length : end);
        if (/backgroundColor:[^\n]*\bpressed\b/.test(block)) {
          offenders.push(`${path}:${source.slice(0, start).split("\n").length}`);
        }
      }
    }
    expect(offenders, "style the pressable itself, not a child of it").toEqual([]);
  });

  /**
   * Every control answers a touch.
   *
   * 21 of the app's 50 interactive `Pressable`s used to give no visual response
   * at all — including every control in the ledger (column header, pin, row
   * label), every day in the calendar, the password eye and the segmented
   * control. On a phone, where there is no hover to fall back on, a control
   * that does not light is indistinguishable from a control that did not
   * register, and the user taps it again.
   */
  it("gives every interactive pressable a pressed state", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      const source = readFileSync(join(root, path), "utf8");
      let index = 0;
      while ((index = source.indexOf("<Pressable", index)) !== -1) {
        let cursor = index + "<Pressable".length;
        // `<PressableRow` is a component of this file's own, not the primitive.
        if (/[A-Za-z0-9_]/.test(source[cursor] ?? "")) {
          index = cursor;
          continue;
        }
        let depth = 0;
        for (; cursor < source.length; cursor += 1) {
          const character = source[cursor];
          if (character === "{") depth += 1;
          else if (character === "}") depth -= 1;
          else if (character === ">" && depth === 0) break;
        }
        const tag = source.slice(index, cursor + 1);
        const opening = source.slice(cursor, cursor + 200);
        index = cursor + 1;
        // A dismiss backdrop and a modal's own body are not controls; they
        // carry `accessible={false}` and are not reachable by any user who is
        // not already pointing at them.
        if (!/onPress=/.test(tag) || /accessible=\{false\}/.test(tag)) continue;
        // Either the style callback reads `pressed`, or the children do. The
        // whole-state form — `(state) => … state.pressed` — is the one a
        // control that also answers a hovering pointer has to use, because
        // `hovered` is not in React Native's own callback type.
        if (/interactionSurface\(/.test(tag)) continue;
        if (/\(\{ pressed \}\)/.test(tag) || /pressed \?/.test(tag) || /state\.pressed/.test(tag)) continue;
        if (/^\s*>?\s*\{\(\{ pressed \}\)/.test(opening) || /^\s*>?\s*\{\(state\) =>/.test(opening)) continue;
        // Shared helpers that return the pressed style for their caller.
        if (/style=\{\w*[Pp]ressStyle\(/.test(tag)) continue;
        offenders.push(`${path}:${source.slice(0, index).split("\n").length}`);
      }
    }
    expect(offenders, "a control that cannot be seen to respond gets tapped twice").toEqual([]);
  });

  /**
   * `hitSlop` is implemented by the legacy `Touchable` only, so on
   * react-native-web it does nothing at all: measured, 4px above / 6px left /
   * 8px below a 32x32 button hit empty page. Fifteen call sites relied on it,
   * which means fifteen targets that were one size on a phone and another in a
   * browser. Every box now carries its own minimum.
   */
  it("never buys a touch target with a prop the web ignores", () => {
    const offenders = sourceFiles("src", { atLeast: 150 }).filter((path) =>
      /hitSlop=/.test(readFileSync(join(root, path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Turkish product copy has one casing rule per role, and it used to have two
 * per role: "Varsayılan Tutar" sat beside "Aktarılacak tutar" and "İşlem Ekle"
 * beside "Yeni kalem ekle", in the same forms.
 *
 * A button is a thing you do, so it is Title Case. A field label is a thing you
 * fill in, so it is sentence case. Turkish keeps conjunctions lowercase inside
 * a title, which is why the joiners are allowed through.
 */
describe("product copy keeps one casing rule per role", () => {
  const JOINERS = new Set(["ve", "veya", "ile", "için", "·"]);
  const isTitleCase = (value: string) =>
    value.split(" ").every((word) => JOINERS.has(word) || /^[A-ZÇĞİÖŞÜ0-9(₺"“]/.test(word));

  const FIELD_COMPONENTS = new Set([
    "Field", "Select", "MoneyField", "MonthDayField", "DateField",
    "MonthStepper", "Toggle", "ChipPicker", "SelectionGrid", "CurrencyPicker",
  ]);

  /**
   * Each `label={tr.…}` is attributed to the component whose opening tag it is
   * inside. Scanning backwards from the prop to the nearest unclosed `<Name`
   * keeps this linear; matching forwards from the tag with a lazy group does
   * not, and cost four seconds a call before it was rewritten.
   */
  const labels = (() => {
    const strings = new Map<string, string>();
    const translations = readFileSync(join(root, "src/i18n/tr.ts"), "utf8");
    for (const match of translations.matchAll(/^\s*(\w+): "([^"\\]+)",?$/gm)) {
      if (!strings.has(match[1]!)) strings.set(match[1]!, match[2]!);
    }
    const buttons: [string, string][] = [];
    const fields: [string, string][] = [];
    for (const path of sourceFiles("src", { atLeast: 150 }).filter((file) => file.endsWith(".tsx"))) {
      const file = readFileSync(join(root, path), "utf8");
      for (const match of file.matchAll(/label=\{tr\.([a-zA-Z0-9_.]+)\}/g)) {
        const before = file.slice(Math.max(0, match.index! - 1200), match.index!);
        const open = before.lastIndexOf("<");
        if (open < 0 || before.slice(open).includes(">")) continue;
        const component = /^<([A-Z]\w+)/.exec(before.slice(open))?.[1];
        if (!component) continue;
        const key = match[1]!;
        const value = strings.get(key.split(".").pop()!);
        if (!value || value.split(" ").length < 2) continue;
        if (component === "Button" || component === "IconButton") buttons.push([key, value]);
        else if (FIELD_COMPONENTS.has(component)) fields.push([key, value]);
      }
    }
    return { buttons, fields };
  })();

  it("puts every multi-word button label in Title Case", () => {
    const offenders = labels.buttons.filter(([, value]) => !isTitleCase(value));
    expect(offenders).toEqual([]);
  });

  it("puts every multi-word field label in sentence case", () => {
    const offenders = labels.fields.filter(([, value]) => isTitleCase(value));
    expect(offenders).toEqual([]);
  });

  /**
   * A field error is read while the user is stuck in the field. It says what is
   * wrong; the rule behind it belongs to the hint under the control, which is
   * read before anything goes wrong.
   */
  it("keeps validation errors to one short sentence", () => {
    const strings = new Map<string, string>();
    const source = readFileSync(join(root, "src/i18n/tr.ts"), "utf8");
    for (const match of source.matchAll(/^\s*(\w+): "([^"\\]+)",?$/gm)) {
      if (!strings.has(match[1]!)) strings.set(match[1]!, match[2]!);
    }
    // Only what really reaches a field's `error` prop. A dialog body explains
    // itself somewhere calmer and is allowed the length.
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 }).filter((file) => file.endsWith(".tsx"))) {
      const file = readFileSync(join(root, path), "utf8");
      for (const match of file.matchAll(/\berror=\{[^}]*?tr\.[a-zA-Z0-9_.]*?(\w+)[^}]*?\}/g)) {
        const message = strings.get(match[1]!);
        if (message && message.length > 90) offenders.push(`${match[1]} (${message.length})`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

/**
 * Motion is a system, not a set of screen-local tastes.
 *
 * Helix had five animated behaviours across forty-five screens; the durations
 * were already right and almost nothing used them. What guards the new ones is
 * not that they exist but that they obey the same three rules everywhere.
 */
describe("every animation obeys the same three rules", () => {
  const animatedFiles = sourceFiles("src", { atLeast: 150 }).filter((path) => {
    if (!path.endsWith(".tsx") && !path.endsWith(".ts")) return false;
    const source = readFileSync(join(root, path), "utf8");
    return /Animated\.(timing|spring|loop|sequence)\(/.test(source);
  });

  it("short-circuits every family on Reduce Motion", () => {
    const offenders = animatedFiles.filter((path) => {
      const source = readFileSync(join(root, path), "utf8");
      return !source.includes("useReducedMotion");
    });
    expect(offenders, "an animation that ignores Reduce Motion is an accessibility defect").toEqual([]);
  });

  it("never claims the native driver for a property it cannot drive", () => {
    // Only `transform` and `opacity` can be driven off the JS thread. A height,
    // a width, a colour, a dash offset and a percentage offset cannot, and
    // asking for the native driver on those throws at runtime on native.
    //
    // Matched per animated VALUE, not per file. The file-level version of this
    // check could not tell a natively driven dot apart from the JS-driven
    // progress bar beside it, so one module was allowed only one kind of
    // animation — which is not the rule, and the rule is what is worth
    // enforcing.
    const layoutConsumers = ["height", "width", "backgroundColor", "borderColor", "left", "top"];
    const consumerPattern = new RegExp(`(?:\\b(?:${layoutConsumers.join("|")})\\s*:|strokeDashoffset=\\{)`, "g");

    /** The one declaration that starts here, to its own end — not 200 bytes of
     *  whatever follows, which caught a dot's `width: size` sitting beside the
     *  transform it actually drives. */
    const declaredExpression = (source: string, from: number): string => {
      let depth = 0;
      let cursor = from;
      for (; cursor < source.length; cursor += 1) {
        const character = source[cursor]!;
        if ("([{".includes(character)) depth += 1;
        else if (")]}".includes(character)) {
          if (depth === 0) break;
          depth -= 1;
        } else if (character === "," && depth === 0) break;
      }
      return source.slice(from, cursor);
    };

    const offenders: string[] = [];
    for (const path of animatedFiles) {
      const source = readFileSync(join(root, path), "utf8");
      // Per component, because an animated value called `progress` in one is a
      // different value from `progress` in the next — and this file holds both
      // the natively driven entrances and the height that cannot be one.
      const starts = [...source.matchAll(/^(?:export )?function /gm)].map((match) => match.index!);
      const blocks = starts.map((start, index) => ({ start, body: source.slice(start, starts[index + 1] ?? source.length) }));
      for (const { start, body } of blocks) {
        for (const match of body.matchAll(/Animated\.(?:timing|spring)\(\s*([A-Za-z_$][\w$.]*)\s*,(?:.|\n)*?\}\)/g)) {
          if (!/useNativeDriver:\s*(true|Platform\.OS !== "web")/.test(match[0]!)) continue;
          const value = match[1]!;
          const line = source.slice(0, start + match.index!).split("\n").length;
          for (const consumer of body.matchAll(consumerPattern)) {
            const expression = declaredExpression(body, consumer.index! + consumer[0]!.length);
            if (!expression.includes(`${value}.interpolate`) && expression.trim() !== value) continue;
            offenders.push(`${path}:${line} (${value})`);
            break;
          }
        }
      }
    }
    expect(offenders, "layout and colour cannot use the native driver").toEqual([]);
  });

  it("keeps the native forecast collapse on the compositor path", () => {
    const motionPrimitives = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
    const nativeCollapse = motionPrimitives.slice(
      motionPrimitives.indexOf("function NativeCollapse("),
      motionPrimitives.indexOf("/**\n * A confirmation that lands", motionPrimitives.indexOf("function NativeCollapse(")),
    );
    expect(nativeCollapse).toContain("useNativeDriver: true");
    expect(nativeCollapse).not.toMatch(/\bheight\s*:/);
    expect(nativeCollapse).toContain("spacing.xs");
  });

  it("takes every duration from the shared families", () => {
    const offenders: string[] = [];
    for (const path of animatedFiles) {
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/duration:\s*(\d+)/g)) {
        offenders.push(`${path}: duration ${match[1]}`);
      }
    }
    // `operation-flow.tsx` breathes at its own 1100ms because the medallion is
    // a continuous ambient loop rather than a response to anything the user
    // did — everything else names a family.
    expect(offenders.filter((entry) => !entry.startsWith("src/ui/operation-flow.tsx"))).toEqual([]);
  });

  it("keeps the stagger inside its own budget however long the list is", () => {
    expect(staggerDelay(0, 40)).toBe(0);
    for (const count of [2, 5, 12, 40, 500]) {
      const last = staggerDelay(count - 1, count);
      expect(last, `${count} items`).toBeLessThanOrEqual(motion.stagger.budget);
      expect(staggerDelay(1, count)).toBeLessThanOrEqual(motion.stagger.step);
    }
  });
});

/**
 * A mark that leads a block of text centres against it — and stops.
 *
 * Pinned to the top of the block it sat level with the first line's cap height
 * and read as dropped in from above; centred against the whole block, a long
 * description dragged it into the middle of a paragraph it does not belong to.
 * Three lines is the compromise: honest centring while the text is short, and a
 * fixed resting place past that.
 */
describe("a leading mark centres against its own text", () => {
  const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8");

  it("caps the centring at three lines", () => {
    expect(primitives).toContain("const LEDE_CENTRE_LINES = 3;");
    expect(primitives).toContain("Math.min(blockHeight, cap)");
    // Measured, not assumed: the type scale sets `fontSize` only and each
    // platform derives its own line box.
    expect(primitives).toContain("onLineLayout");
    expect(primitives).toContain("onBlockLayout");
  });

  it("is the rule both marked surfaces use, rather than a per-screen guess", () => {
    for (const owner of ["PanelHeader", "ListRow"]) {
      const start = components.indexOf(`export function ${owner}(`);
      expect(start, `${owner} exists`).toBeGreaterThan(-1);
      const body = components.slice(start, start + 3_000);
      expect(body, `${owner} uses the shared alignment`).toContain("lede.markStyle");
      expect(body, `${owner} measures its text block`).toContain("lede.onBlockLayout");
    }
    // Nothing may pin a mark to the top of a text block by hand any more.
    expect(components).not.toContain('alignItems: description ? "flex-start" : "center"');
  });
});

/**
 * Navigation is movement, so it moves.
 *
 * A tab change and a pushed page were both hard cuts — on the web by default,
 * because neither navigator animates there unless told to. The same page
 * furniture with different words in it reads as a repaint rather than as
 * arriving somewhere.
 */
describe("navigation says that it moved", () => {
  it("crossfades between tabs rather than cutting", () => {
    const tabs = readFileSync(join(root, "src/app/(tabs)/_layout.tsx"), "utf8");
    // `fade`, not `shift`: five peers, so nothing should imply a direction.
    expect(tabs).toContain('animation: "fade" as const');
  });

  it("slides a pushed page in the direction its back gesture already implies", () => {
    const header = readFileSync(join(root, "src/ui/header-bar.tsx"), "utf8");
    expect(header).toContain('const STACK_ANIMATION = "slide_from_right" as const;');
    expect(header).toContain("animation: STACK_ANIMATION");
  });
});

/**
 * The ledger does not animate its numbers.
 *
 * `Amount` is rendered hundreds of times on the financial table, so the
 * counting animation is opt-in and the opt-in is enforced here: without the
 * guard every cell would run a per-frame `setState` whenever its value
 * changed, which is both the wrong behaviour — twelve numbers moving at once
 * is noise on a surface whose whole job is to be read — and the wrong cost.
 */
describe("only a hero figure counts", () => {
  it("keeps the counting hook off every cell that never counts", () => {
    const motionPrimitives = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
    const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
    expect(motionPrimitives).toContain("export function useCountUp(value: number");
    // A separate component owns the hook AND the navigation subscription that
    // feeds it, so a ledger of six hundred figures runs neither.
    expect(primitives).toContain("props.count ? <CountingAmount {...props} /> : <Figure {...props} />");
    expect(primitives).toContain("useCountUp(props.minor)");
    const figure = primitives.slice(primitives.indexOf("function Figure("));
    expect(figure).not.toContain("useCountUp");
  });

  it("is asked for on exactly the two hero figures and nowhere else", () => {
    const askers = sourceFiles("src", { atLeast: 150 })
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) => /<Amount[^>]*\scount(\s|\n|\/|>)/.test(readFileSync(join(root, path), "utf8")));
    expect(askers.sort()).toEqual([
      "src/app/(tabs)/index.tsx",
      "src/app/(tabs)/investments/index.tsx",
    ]);
  });
});

describe("investment hero keeps one motion path at every width", () => {
  const investments = readFileSync(join(root, "src/app/(tabs)/investments/index.tsx"), "utf8");

  it("animates the compact balance instead of replacing the counted figure with text", () => {
    const cashSummary = investments.slice(
      investments.indexOf("const cashSummary ="),
      investments.indexOf("const distributionChart ="),
    );
    const compactStart = cashSummary.indexOf("{compact ? (");
    const compactBranch = cashSummary.slice(compactStart, cashSummary.indexOf(") : (", compactStart));
    expect(compactBranch).toContain("<Amount");
    expect(compactBranch).toContain("count");
  });

  it("redraws the compact allocation bars on arrival and data changes", () => {
    const allocation = investments.slice(
      investments.indexOf("function AllocationStrip("),
      investments.indexOf("function InvestmentQuickAction("),
    );
    expect(allocation).toContain("useDrawIn(true, motion.draw");
    expect(allocation).toContain("<Animated.View");
  });
});

describe("theme transition fallback stays active on partial browser APIs", () => {
  it("only suppresses the veil when View Transitions is actually callable", () => {
    const transition = readFileSync(join(root, "src/ui/theme-transition.ts"), "utf8");
    expect(transition).toContain('typeof doc.startViewTransition === "function"');
  });

  it("keeps the previous palette available to the native and mobile-web veil", () => {
    const motionPrimitives = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
    expect(motionPrimitives).toContain("previousPalette");
    expect(motionPrimitives).toContain("transitionFrom");
  });
});

describe("screen motion replays consistently", () => {
  const motionPrimitives = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8");

  it("re-runs both screen scaffold variants without remounting their children", () => {
    const screen = components.slice(components.indexOf("export function Screen("), components.indexOf("export function Card("));
    expect([...screen.matchAll(/<ScreenEntrance/g)]).toHaveLength(2);
    expect([...screen.matchAll(/<ScreenVisitContext.Provider/g)]).toHaveLength(2);
    expect([...screen.matchAll(/value=\{visitStore\}/g)]).toHaveLength(2);
    expect(screen).toContain("const visitStore = useScreenVisitController();");
    expect(components).toContain("function ScreenEntrance");
    expect(motionPrimitives).toContain("createScreenVisitStore");

    const entrance = components.slice(
      components.indexOf("function ScreenEntrance("),
      components.indexOf("const SCREEN_ARRIVAL_RISE"),
    );
    // The arrival replays per visit and never remounts what it wraps.
    expect(entrance).toContain("screenVisit]");
    expect(entrance).not.toContain("key={");
    /**
     * The page must never animate its own opacity.
     *
     * A whole screen fading up from zero is the shape of a reload — blank
     * window, then everything paints at once — and it was reported as "the
     * page refreshes" three times running. Softening it to 0.92 instead made
     * the replay invisible. Movement is the only axis that can be both seen
     * and not mistaken for a refresh, so the entrance is a transform and this
     * keeps it one.
     */
    expect(entrance).not.toContain("opacity");
    expect(entrance).toContain("translateY");
  });

  /**
   * A counter, not a boolean.
   *
   * `react-native-screens` freezes an inactive screen, so a blurred tab never
   * renders the `focused: false` in between — it wakes up already true, a "did
   * it change?" comparison sees no change, and nothing replays. Measured: the
   * chart and the figure animated on every return in a browser and never on a
   * phone. A count cannot be coalesced away.
   */
  it("counts every return to a screen's own navigator, not only tab switches, and shares one listener with hero children", () => {
    const visit = motionPrimitives.slice(
      motionPrimitives.indexOf("export function useScreenVisitController()"),
      motionPrimitives.indexOf("export function useScreenFocus()"),
    );
    expect(visit).toContain("store.increment()");
    expect(visit).toContain('navigation.addListener("blur", blur)');
    expect(visit).toContain('navigation.addListener("focus", arrive)');
    expect(visit).toContain("const scopedVisit = useContext(ScreenVisitContext);");
    expect(visit).toContain("createScreenVisitStore");
    expect(visit).toContain("useSyncExternalStore(store.subscribe");
    expect(visit).not.toContain("unsubscribes.push");
    for (const hook of ["useDrawIn", "useCountUp"]) {
      const body = motionPrimitives.slice(motionPrimitives.indexOf(`export function ${hook}(`));
      expect(body.slice(0, 1_400), `${hook} replays per visit`).toContain("const visit = useScreenVisit();");
    }
    // The focus right after mount is the first entrance, not a return; only a
    // focus that follows a real blur increments the counter.
    expect(visit).toContain("if (blurredSinceMount) store.increment()");
  });

  it("measures a collapsible's height fresh on every open instead of reusing a stale one", () => {
    // MeasuredCollapse never unmounts its own component instance — only its
    // rendered output — so `contentHeight` state survives a close/reopen
    // cycle unless cleared. Reusing a measurement taken before a close (a
    // device still settling web fonts or a wrapped hint line reflowing) let
    // the animated height and the real content height briefly disagree,
    // which reads as extra space under the panel.
    const collapse = motionPrimitives.slice(
      motionPrimitives.indexOf("function MeasuredCollapse("),
      motionPrimitives.indexOf("function NativeCollapse("),
    );
    expect(collapse).toContain("if (finished && !open)");
    expect(collapse).toContain("setMounted(false);");
    expect(collapse).toContain("setContentHeight(null);");
  });

  it("tolerates the surfaces that render above the navigator", () => {
    // The lock gate, the frozen gate and the first-pull wait all render before
    // the router's `Stack`, so there is no navigation object at all. `useIsFocused`
    // throws there; this reads the context directly and treats absent as focused.
    expect(motionPrimitives).toContain("useContext(NavigationContext)");
    expect(motionPrimitives).toContain("navigation?.isFocused() ?? true");
    expect(motionPrimitives).not.toMatch(/\buseIsFocused\(/);
  });
});

describe("native forms can uncover actions below the keyboard", () => {
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8");
  const keyboardSafe = readFileSync(join(root, "src/ui/keyboard-safe.tsx"), "utf8");
  const keyboardSafeNative = readFileSync(join(root, "src/ui/keyboard-safe.native.tsx"), "utf8");
  const dialog = readFileSync(join(root, "src/ui/dialog.tsx"), "utf8");
  const rootLayout = readFileSync(join(root, "src/app/_layout.tsx"), "utf8");
  const screen = components.slice(components.indexOf("export function Screen("), components.indexOf("export function Card("));
  const scrollViewStart = screen.lastIndexOf("<KeyboardSafeScrollView");
  const scrollView = screen.slice(scrollViewStart, screen.indexOf(">", scrollViewStart));

  it("uses one animated native scroller without delegating persistent insets to UIKit", () => {
    expect(scrollView).toContain("bottomOffset={Math.min(160, Math.round(height * 0.24))}");
    expect(scrollView).toContain("extraKeyboardSpace={bottomPad}");
    expect(scrollView).toContain('keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}');
    expect(scrollView).toContain("automaticallyAdjustContentInsets={false}");
    expect(scrollView).not.toContain("automaticallyAdjustKeyboardInsets");
    expect(keyboardSafeNative).toContain("<KeyboardAwareScrollView");
    expect(keyboardSafeNative).toContain("disableScrollOnKeyboardHide");
    expect(keyboardSafeNative).toContain('keyboardShouldPersistTaps="handled"');
    expect(keyboardSafe).not.toContain("react-native-keyboard-controller");
    expect(keyboardSafeNative).toContain("renderKeyboardSafeListScroll");
    expect(keyboardSafeNative).not.toContain("function KeyboardSafeListScroll");
  });

  it("covers mobile web focus, prompts, and virtualized form lists at their shared owners", () => {
    expect(rootLayout).toContain("<KeyboardSafeRoot>");
    expect(keyboardSafe).toContain('block: "center"');
    expect(keyboardSafe).toContain('document.addEventListener("focusin", scheduleReveal, true)');
    expect(keyboardSafe).toContain("const focusedTarget = editableElement(event?.target ?? null) ?? activeEditableElement();");
    expect(keyboardSafe).toContain("window.visualViewport?.addEventListener");
    expect(keyboardSafe).toContain("renderKeyboardSafeListScroll");
    expect(keyboardSafe).not.toContain("function KeyboardSafeListScroll");
    expect(dialog).toContain("<KeyboardSafeScrollView");
    for (const file of ["src/app/cell-editor.tsx", "src/app/(tabs)/cash-flow/[month].tsx", "src/app/(tabs)/cash-flow/analytics.tsx"]) {
      expect(readFileSync(join(root, file), "utf8"), file).toContain("renderScrollComponent={renderKeyboardSafeListScroll}");
    }
  });
});

/**
 * The remaining hard cuts, closed at their shared owner.
 *
 * Each of these was one component swapping one finished state for another in a
 * single frame, in a place where the whole point was that something moved.
 */
describe("nothing changes state by cutting to it", () => {
  const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
  const motionPrimitives = readFileSync(join(root, "src/ui/motion-primitives.tsx"), "utf8");
  const tabBar = readFileSync(join(root, "src/ui/tab-bar.tsx"), "utf8");
  const charts = readFileSync(join(root, "src/ui/charts.tsx"), "utf8");
  const selectionControls = readFileSync(join(root, "src/ui/selection-controls.tsx"), "utf8");

  it("moves one selection across the tab bar instead of lighting five in turn", () => {
    expect(tabBar).toContain("Animated.multiply(selection, slotWidth)");
    // The fill and outline belong to the travelling shape; a tab keeps only its
    // ink, its weight and its answer to a press.
    const destination = tabBar.slice(tabBar.indexOf("const destinations ="), tabBar.indexOf("return ("));
    expect(destination).not.toMatch(/backgroundColor: focused \?/);
    expect(destination).not.toMatch(/borderWidth: focused \?/);
  });

  it("rotates one chevron rather than swapping two glyphs", () => {
    expect(primitives).toContain("export function DisclosureChevron(");
    expect(primitives).toContain('outputRange: ["0deg", "180deg"]');
    const swappers = sourceFiles("src", { atLeast: 150 })
      .filter((path) => path.endsWith(".tsx"))
      .filter((path) => {
        const source = readFileSync(join(root, path), "utf8");
        return source.includes("<ChevronUp") && source.includes("<ChevronDown");
      });
    expect(swappers, "a disclosure that owns both glyphs is a cut").toEqual([]);
  });

  /**
   * An animated modal EXIT is deliberately absent, and this is what keeps it
   * absent.
   *
   * Driving `visible` instead of unmounting is the only way either platform can
   * animate a modal out — and measured in the browser, react-native-web keeps
   * `ModalFocusTrap` armed for the whole exit: focusing a field on the screen
   * underneath during those ~300ms lands back on a button inside the dialog
   * that is leaving. A confirmation is usually followed immediately by the next
   * action, so the cost is the app ignoring the user, and the gain is a fade.
   */
  it("does not buy a modal exit with the focus of the screen underneath", () => {
    for (const path of ["src/ui/selection-controls.tsx", "src/ui/calendar.tsx", "src/ui/calculator.tsx", "src/ui/dialog.tsx"]) {
      const source = readFileSync(join(root, path), "utf8");
      expect(source, `${path} unmounts its modal rather than animating it out`).not.toMatch(/<Modal[^>]*visible=\{/);
    }
  });

  it("redraws a chart when its own data changes, not only on first render", () => {
    // A token, not a mount: switching period or filter used to replace one
    // finished picture with another in a single frame.
    expect(motionPrimitives).toContain("token?: string | number");
    expect([...charts.matchAll(/useDrawIn\(true, motion\.draw, /g)]).toHaveLength(3);
    expect(charts).not.toMatch(/useDrawIn\(\)/);
  });

  it("measures the segmented indicator against the track its options share", () => {
    // The guide toggle beside the options is a fixed 44pt while the indicator
    // is a percentage, so measuring it against the whole strip made it too
    // narrow and progressively too far left — visible on the third segment of
    // the only view that has a toggle.
    const segmented = selectionControls.slice(selectionControls.indexOf("export function Segmented<"));
    expect(segmented).toContain("width: `${100 / options.length}%`");
    expect(segmented).not.toContain("optionCount");
  });
});

/**
 * Progress that can be counted is drawn as steps.
 *
 * The budget card and an instalment plan were two different pictures of the
 * same idea — one a ten-segment strip, one a smooth bar — so the plan's bar
 * could not say which instalment you were on. One primitive, and the caller
 * says how many steps there are.
 */
describe("progress is one shape", () => {
  it("is drawn by one primitive, with a countable number of steps", () => {
    const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
    expect(primitives).toContain("export function SegmentBar(");
    expect(primitives).toContain("const MAX_SEGMENTS = 12;");
    for (const path of ["src/app/(tabs)/settings/budgets.tsx", "src/app/(tabs)/cash-flow/installments.tsx"]) {
      expect(readFileSync(join(root, path), "utf8"), path).toContain("<SegmentBar");
    }
    // No screen paints its own proportional fill any more.
    const offenders = sourceFiles("src/app", { atLeast: 40 }).filter((path) =>
      /width: `\$\{(?:Math\.round\()?\(?[\w.]+ \/ /.test(readFileSync(join(root, path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * A row of shortcuts stays a row.
 *
 * Six quick days plus "Ayın sonu" need about 315px and a paired month-day field
 * inside a card on a phone gets roughly 120, so the row wrapped and left "Ayın
 * sonu" alone on a second line — which reads as a different question from the
 * numbers above it. Every day is still typeable in the field below.
 */
describe("month-day shortcuts fit the box they are in", () => {
  it("thins the middle and keeps the ends", () => {
    const days = [1, 5, 10, 15, 25, 28];
    expect(fittedQuickDays(400, days)).toEqual(days);
    const narrow = fittedQuickDays(160, days);
    expect(narrow.length).toBeLessThan(days.length);
    expect(narrow[0]).toBe(1);
    expect(narrow.at(-1)).toBe(28);
    // Never empty, however little room there is.
    expect(fittedQuickDays(1, days).length).toBeGreaterThan(0);
    expect(fittedQuickDays(0, days)).toEqual(days);
  });

  it("is what the field uses, rather than a per-screen guess", () => {
    const field = readFileSync(join(root, "src/ui/month-day-field.tsx"), "utf8");
    expect(field).toContain("fittedQuickDays(boxWidth");
    // Measured on its own box: these are used as a pair inside a card, so each
    // gets about half a column and only the layout knows how much.
    expect(field).toContain("useMeasuredWidth");
  });
});

/**
 * A subscription's name is Turkish, and Turkish breaks the obvious matcher.
 *
 * `/internet/i.test("İnternet aboneliği")` is FALSE: without the `u` flag a
 * regex canonicalises by `toUpperCase`, dotted capital İ upper-cases to itself
 * and `i` upper-cases to `I`. Every utility a user typed with a capital was
 * left without its icon.
 */
describe("brand and utility matching reads Turkish", () => {
  it("folds the dotted capital and the accents before matching", () => {
    expect(foldForMatch("İnternet Aboneliği")).toBe("internet aboneligi");
    expect(foldForMatch("İGDAŞ Doğalgaz")).toBe("igdas dogalgaz");
    expect(/internet/.test(foldForMatch("İNTERNET"))).toBe(true);
  });

  it("matches a mention as a whole word, not a fragment", () => {
    expect(nameMentions("Ailem için Netflix", "netflix")).toBe(true);
    expect(nameMentions("Ev interneti", "internet")).toBe(false);
    expect(nameMentions("İnternet aboneliği", "internet")).toBe(true);
    // "maximum" is not Max.
    expect(nameMentions("Maximum kart", "max")).toBe(false);
  });

  it("keeps every catalogue key foldable to itself", () => {
    for (const key of Object.keys(BRAND)) {
      expect(foldForMatch(key), `${key} is already in matching form`).toBe(key);
    }
  });
});
