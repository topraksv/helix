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

describe("truncation is never used to hide text", () => {
  // AGENTS.md non-negotiable: wrap, shorten or change the layout — never clip.
  // `e2e/visual-a11y.spec.ts` measures RENDERED overflow across 26 routes at two
  // widths; this catches the prop at author time, before a baseline is rendered.
  it("no component sets numberOfLines or ellipsizeMode", () => {
    const offenders = sourceFiles("src", [".tsx"]).filter((file) =>
      /numberOfLines|ellipsizeMode/.test(source(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("Dynamic Type is never opted out of", () => {
  /**
   * React Native's default is `allowFontScaling={true}`, so every Text and
   * TextInput already follows the OS font-size setting. The failure mode is a
   * component that opts OUT to protect a layout — which is exactly the tradeoff
   * WCAG 1.4.4 forbids. Physical iOS/Android acceptance at XL/AX sizes stays a
   * device check (see docs/TESTING.md); this guards the code-level regression.
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
