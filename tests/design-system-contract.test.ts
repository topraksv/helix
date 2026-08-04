import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  borderWidth,
  contentWidth,
  controlSize,
  elevation,
  font,
  iconSize,
  layer,
  motion,
  radius,
  stateOpacity,
  staggerDelay,
  toggleSize,
  type,
} from "../src/ui/theme";
import { modalAnimationType } from "../src/ui/modal-motion";
import { shouldPairDashboardPanels, shouldPairFilterCards } from "../src/ui/responsive";

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
    const source = readFileSync(join(root, "src/ui/components.tsx"), "utf8");
    expect(source).toContain("...type.field");
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
    const offenders = sourceFiles("src")
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
    const offenders = sourceFiles("src")
      .filter((path) => path !== "src/ui/theme.ts")
      .filter((path) => /borderRadius:\s*(?:[89]|[1-9]\d)\b/.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps raw Inter face names inside the theme and font loader only", () => {
    const offenders = sourceFiles("src").filter((path) => {
      if (path === "src/ui/theme.ts" || path === "src/app/_layout.tsx") return false;
      return /Inter_[4567]00/.test(readFileSync(join(root, path), "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  /**
   * The shipped `Fraunces_700Bold` exposes no `tnum` feature and its digit
   * advances span 978–1404 units at 2000 upem. A serif figure would jump as a
   * balance updated and would never align down a column, so the brand face is
   * allowed on voice — the sign-in hero and screen titles — and nowhere near a
   * number.
   */
  it("keeps every figure role on the tabular Inter faces, never the brand serif", () => {
    for (const [name, role] of Object.entries(type)) {
      const carriesFigures = "fontVariant" in role || /^amount|^money/.test(name);
      if (!carriesFigures) continue;
      expect(role.fontFamily, `${name} must not use the serif`).not.toBe(font.serifBold);
      expect(
        (role as { fontVariant?: readonly string[] }).fontVariant,
        `${name} must request tabular figures`,
      ).toEqual(["tabular-nums"]);
    }
    expect(type.title.fontFamily, "screen titles carry the brand voice").toBe(font.serifBold);
    expect(type.display.fontFamily).toBe(font.serifBold);
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
    for (const path of sourceFiles("src")) {
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
    for (const path of sourceFiles("src")) {
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
    for (const path of sourceFiles("src")) {
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
    for (const path of sourceFiles("src")) {
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
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8") + primitives;
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

/**
 * `hitSlop` is implemented only by react-native-web's legacy `Touchable`, so on
 * the web it does nothing at all. Every compact control in this app leaned on
 * it: measured in a browser, a 32x32 row button's real hit area was 32x32, and
 * points 4px above, 6px left and 8px below it hit nothing. The box carries the
 * minimum now, and `hitSlop` is left only as the native courtesy it always was.
 */
describe("compact controls own a real minimum target", () => {
  const primitives = readFileSync(join(root, "src/ui/primitives.tsx"), "utf8");
  const components = readFileSync(join(root, "src/ui/components.tsx"), "utf8") + primitives;

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
    const toggle = components.slice(components.indexOf("export function Toggle("));
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
    for (const path of sourceFiles("src")) {
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
    for (const path of sourceFiles("src")) {
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
        // Either the style callback reads `pressed`, or the children do.
        if (/\(\{ pressed \}\)/.test(tag) || /pressed \?/.test(tag)) continue;
        if (/^\s*>?\s*\{\(\{ pressed \}\)/.test(opening)) continue;
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
    const offenders = sourceFiles("src").filter((path) =>
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
    for (const path of sourceFiles("src").filter((file) => file.endsWith(".tsx"))) {
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
    for (const path of sourceFiles("src").filter((file) => file.endsWith(".tsx"))) {
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
  const animatedFiles = sourceFiles("src").filter((path) => {
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
    const offenders: string[] = [];
    for (const path of animatedFiles) {
      const source = readFileSync(join(root, path), "utf8");
      for (const match of source.matchAll(/Animated\.(?:timing|spring)\((?:.|\n)*?\}\)/g)) {
        const call = match[0]!;
        if (!/useNativeDriver:\s*(true|Platform\.OS !== "web")/.test(call)) continue;
        // The value is driven natively; the interpolations that consume it must
        // land on transform or opacity only. Checked at the file level, since a
        // driver and its consumer are rarely adjacent.
        const line = source.slice(0, match.index!).split("\n").length;
        if (/height:\s*\w+\.interpolate|width:\s*\w+\.interpolate|backgroundColor:\s*\w+\.interpolate|left:\s*\w+\.interpolate|strokeDashoffset=\{\w+\.interpolate/.test(source)) {
          offenders.push(`${path}:${line}`);
        }
      }
    }
    expect(offenders, "layout and colour cannot use the native driver").toEqual([]);
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
