/**
 * When the navigation bar stops drawing its labels.
 *
 * Five equal columns in a bounded bar give each label roughly 60pt. React
 * Native scales every label by the OS text setting, and capping the multiplier
 * at 200% — exactly what WCAG 1.4.4 asks for — stops the glyphs clipping while
 * doing nothing at all about the words. Measured on an iOS simulator at
 * `content_size accessibility-large`, which is that same 200%: the bar drew
 * "Durum | Mali Ta | Abone | Yatırım | Ayarlar" with the five labels running
 * into each other. Five names, none of them readable, is worse than none.
 *
 * The trigger is the MEASURED label rather than a font scale, because
 * `useWindowDimensions().fontScale` is 1 on iOS whatever the text-size setting
 * says — it follows Display Zoom, not Dynamic Type — so a threshold on it is
 * dead code on the one platform that has the problem.
 */

import { describe, expect, it } from "vitest";
import { tabLabelsFit, tooWide } from "../src/ui/responsive";

describe("tab bar labels", () => {
  it("draws them before anything has been measured", () => {
    // They have to render once or they can never be measured, and a bar that
    // started icon-only would have no way back.
    expect(tabLabelsFit(0, 0)).toBe(true);
    expect(tabLabelsFit(0, 60)).toBe(true);
    expect(tabLabelsFit(48, 0)).toBe(true);
  });

  it("keeps them while the widest one clears its column", () => {
    expect(tabLabelsFit(40, 60)).toBe(true);
    // Exactly the breathing room, and no more.
    expect(tabLabelsFit(52, 60)).toBe(true);
  });

  it("drops them the moment the widest one stops clearing it", () => {
    expect(tabLabelsFit(53, 60)).toBe(false);
    // The measured 200% case: "Ayarlar" at twice its size in a 60pt column.
    expect(tabLabelsFit(84, 60)).toBe(false);
  });

  it("brings them back when the column grows", () => {
    // A rotation or a wider window, with the same text size.
    expect(tabLabelsFit(84, 60)).toBe(false);
    expect(tabLabelsFit(84, 120)).toBe(true);
  });
});

describe("a label that wrapped", () => {
  it("reports a width its column provably cannot hold", () => {
    // Wrapping is the only evidence available without clamping the label to one
    // line, which this app does not do to its own copy
    // (`tests/accessibility-contract.test.ts`). Every measured LINE of a
    // wrapped label is narrower than the column it wrapped inside, so the line
    // width alone would read as a comfortable fit.
    expect(tabLabelsFit(tooWide(60), 60)).toBe(false);
    expect(tabLabelsFit(tooWide(120), 120)).toBe(false);
  });
});
