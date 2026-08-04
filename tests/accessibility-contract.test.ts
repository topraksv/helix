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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(directory: string, extensions: string[]): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

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
    const offenders = sourceFiles("src", [".tsx", ".ts"]).filter((file) =>
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
   * TextInput already follows the OS font-size setting. The failure mode is a
   * component that opts OUT to protect a layout — which is exactly the tradeoff
   * WCAG 1.4.4 forbids. Physical iOS/Android acceptance at XL/AX sizes stays a
   * manual device check; this guards the code-level regression.
   */
  it("no component disables font scaling or caps the multiplier", () => {
    const offenders = sourceFiles("src", [".tsx", ".ts"]).filter((file) =>
      /allowFontScaling\s*=\s*\{?\s*false|maxFontSizeMultiplier/.test(source(file)),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * A hard-coded `lineHeight` beside a scaling `fontSize` is the classic Dynamic
   * Type clipping bug: the glyphs grow, the line box does not, and descenders are
   * cut. The shared type scale therefore sets `fontSize` only and lets the
   * platform derive the line box.
   */
  it("the shared type scale pins no lineHeight against a scaling fontSize", () => {
    const theme = source("src/ui/theme.ts");
    const scale = theme.slice(theme.indexOf("export const type"));
    expect(scale).toContain("fontSize");
    expect(scale).not.toMatch(/lineHeight/);
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
