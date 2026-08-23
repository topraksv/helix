/**
 * STATIC accessibility invariants — absence checks only.
 *
 * This file used to also assert that `src/ui/components.tsx` CONTAINED prop
 * names (`toContain("accessibilityLabelledBy")`, …). That was false confidence:
 * the string passes when it sits in a comment, fails when a prop is renamed, and
 * never proves the attribute reached an element. Those assertions moved to
 * `e2e/a11y-semantics.spec.ts`, which drives the DOM React Native Web actually
 * renders. See that file for the aria-labelledby / aria-live / aria-modal /
 * decorative-art / autocomplete contracts.
 *
 * What remains here is the class of invariant a rendered test CANNOT prove: that
 * a prop appears NOWHERE in the source. An absence check over text is sound in
 * the direction that matters — any occurrence, even in a comment, fails the test
 * and a human looks. The opposite error (a prop smuggled in via a computed key)
 * is not reachable in this codebase and would be caught by the axe and layout
 * sweeps anyway.
 */

import { readFileSync } from "node:fs";
import { sourceFiles } from "./source-corpus";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxFontScale, proseLeading, type } from "../src/ui/theme";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");



describe("text wraps before it is ever shortened", () => {
  /**
   * Ordinary data must never be shortened: the ledger used to clamp an item
   * label to two lines, so the owner's own "Kredi Kartı Tek Çekim tek çekim"
   * rendered as "Kredi Kartı Tek Çekim tek çe…" on both phones — the shortened
   * part being exactly what separates it from the next item. Screen and header
   * titles clamped to one line for the same reason and no longer do.
   *
   * The ledger keeps one bound, and only the ledger: a name is user-authored,
   * and unbounded wrapping hands the table's geometry to whatever someone
   * types. Three lines is past every real item name, `softWrapLabel` breaks a
   * long single token so it wraps at all, and the full text stays in the
   * accessible label.
   */
  it("only user-authored names may shorten, and only where the row cannot grow", () => {
    // Two places, both carrying a name the user typed: the ledger's own label
    // and the screen title a drill-down inherits from it. Everything else
    // wraps.
    const offenders = sourceFiles("src", { atLeast: 150 }).filter((file) =>
      /(numberOfLines|ellipsizeMode)\s*=/.test(source(file)),
    );
    expect(offenders).toEqual(["src/ui/header-bar.tsx", "src/ui/sticky-table.tsx"]);
    const table = source("src/ui/sticky-table.tsx");
    expect(table).toContain("const LABEL_MAX_LINES = 3;");
    // Every clamp reads the shared bound, so one file cannot drift to two.
    expect(table.match(/numberOfLines=\{/g)).toHaveLength(3);
    expect(table.match(/numberOfLines=\{LABEL_MAX_LINES\}/g)).toHaveLength(3);
    // The header has one row, so it stops at two lines rather than three.
    expect(source("src/ui/header-bar.tsx")).toContain("numberOfLines={2}");
  });

  it("the ledger still speaks the full label when the visible one is shortened", () => {
    const table = source("src/ui/sticky-table.tsx");
    expect(table).toContain("accessibilityLabel={accessibilityLabel ?? label}");
    expect(table).toContain("accessibilityLabel={r.accessibilityLabel ?? r.label}");
    expect(table).toContain("softWrapLabel(");
  });
});

describe("Dynamic Type is never opted out of", () => {
  /**
   * React Native's default is `allowFontScaling={true}`, so every Text and
   * TextInput already follows the OS font-size setting. Opting OUT is the
   * tradeoff WCAG 1.4.4 forbids and stays banned outright.
   *
   * A CEILING is a different thing, and this test used to ban it too. That was
   * wrong in one direction and unenforced in the other: iOS accessibility sizes
   * reach roughly 3.1x, and three of this app's surfaces have geometry measured
   * in points — the ledger's 116pt label column and its fitted cell widths, the
   * 56pt floating tab bar. At 3.1x those labels do not become large, they
   * become an ellipsis, which this repository's own rule forbids as well.
   *
   * So the rule is exact rather than absolute: a ceiling may only ever be
   * `maxFontScale.measuredBox`, which is 2 — precisely the 200% WCAG 1.4.4
   * asks for. A literal, or a token worth less than 2, is what would actually
   * cost a user something, and that is what fails here.
   */
  it("no component disables font scaling", () => {
    const offenders = sourceFiles("src", { atLeast: 150 }).filter((file) =>
      /allowFontScaling\s*=\s*\{?\s*false/.test(source(file)),
    );
    expect(offenders).toEqual([]);
  });

  it("caps the font multiplier only at the shared 200% token", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src", { atLeast: 150 })) {
      for (const [index, line] of source(file).split("\n").entries()) {
        if (!line.includes("maxFontSizeMultiplier")) continue;
        if (line.includes("maxFontSizeMultiplier={maxFontScale.measuredBox}")) continue;
        offenders.push(`${file}:${index + 1}`);
      }
    }
    expect(offenders, "a text ceiling that is not the shared 200% token").toEqual([]);
  });

  it("keeps the shared ceiling at the 200% WCAG 1.4.4 asks for", () => {
    expect(maxFontScale.measuredBox).toBe(2);
  });

  /**
   * A hard-coded `lineHeight` beside a scaling `fontSize` is the classic Dynamic
   * Type clipping bug: the glyphs grow, the line box does not, and descenders are
   * cut. The shared type scale therefore sets `fontSize` only and lets the
   * platform derive the line box.
   *
   * The rule is now stated against the SCALE ITSELF rather than against the
   * text of the file after it. The old form sliced the source from
   * `export const type` to the end and rejected the word anywhere in it, which
   * also rejected the paragraph EXPLAINING why the scale has no leading — a
   * test that fails when you document it is a test that discourages the
   * documentation.
   *
   * The one place a line box is allowed is `proseLeading`, and it is allowed
   * because it is none of the things this rule is about: it is a RATIO, applied
   * on web only, to prose only, derived from the role's own fontSize. Native —
   * the only platform where Dynamic Type can outgrow a fixed box — never
   * receives it. See the note on `proseLeading` in `theme.ts`.
   */
  it("the shared type scale pins no lineHeight against a scaling fontSize", () => {
    for (const [name, role] of Object.entries(type)) {
      expect(role, `${name} must declare a size`).toHaveProperty("fontSize");
      expect(role, `${name} must not pin a line box`).not.toHaveProperty("lineHeight");
    }
  });

  it("keeps prose leading a web-only ratio, never a native constant", () => {
    expect(proseLeading).toBeGreaterThan(1.4);
    expect(proseLeading).toBeLessThan(1.7);
    const primitives = source("src/ui/primitives.tsx");
    // The single call site, and it is guarded and derived rather than written.
    const leadingLines = primitives
      .split("\n")
      // The STYLE property, not a local of the same name (`useLedeAlignment`
      // measures one and calls it that).
      .filter((line) => /lineHeight:/.test(line));
    expect(leadingLines).toHaveLength(1);
    expect(leadingLines[0]).toContain('Platform.OS === "web"');
    expect(leadingLines[0]).toContain("type.body.fontSize * proseLeading");
  });
});

describe("password-manager metadata on the sign-in form", () => {
  /**
   * The ONE assertion that could not be moved to a rendered test.
   *
   * `/(auth)/sign-in` is unreachable from the E2E fixture: the suite bootstraps a
   * LOCAL-ONLY workspace, which carries a `userId`, so `resolveRootGuard` treats
   * the session as signed in and redirects every auth route to `/(tabs)`
   * (`tests/app-guard.test.ts` pins that redirect). Reaching the screen would
   * mean signing out first, which wipes the workspace the rest of the run needs.
   *
   * So this stays a source check, and it is recorded as such rather than
   * presented as render proof. The behaviour it guards — a password manager
   * offering the right credential — is a browser/OS integration that is
   * verified on a real device, not in a headless run.
   */
  it("declares email and mode-correct password autofill hints", () => {
    const signIn = source("src/app/(auth)/sign-in.tsx");
    expect(signIn).toContain('autoComplete="email"');
    expect(signIn).toContain('autoComplete={mode === "signIn" ? "current-password" : "new-password"}');
  });
});

describe("auth mode switch layout", () => {
  it("keeps the sign-in/sign-up link aligned without an overlapping hit box", () => {
    const signIn = source("src/app/(auth)/sign-in.tsx");
    const modeSwitch = signIn.slice(signIn.indexOf("<View style={{ flexDirection: \"row\", alignItems: \"center\""));

    // The row's text and link are peers. A negative margin previously pulled
    // the link's 44pt hit box over the question text, so native hit testing
    // disagreed with the web layout even though the glyphs looked adjacent.
    expect(modeSwitch).toContain("paddingHorizontal: 0");
    expect(modeSwitch).not.toContain("marginHorizontal: -spacing.sm");
  });
});
