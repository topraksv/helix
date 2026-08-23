/**
 * Every mark the app can store has a drawn icon, and no screen draws an emoji.
 *
 * Categories and payment sources were marked with emoji while every other mark
 * in the app was a single-colour lucide glyph. That mixed two drawing engines
 * in one column — the ledger's card view managed three in a single 30px box —
 * and an emoji ignores the palette, ignores the theme, and is drawn differently
 * by every operating system.
 *
 * The stored value did not change: `domain/category-icons` still suggests the
 * same glyph from a Turkish name, and nothing in the database or in a backup
 * had to move. `ui/category-icon` decides how that value is DRAWN. This file
 * guards the two halves of that arrangement — the mapping is total, and no
 * screen has quietly gone back to rendering the raw glyph.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-corpus";
import { suggestCategoryIcon } from "../src/domain/category-icons";
import { PAYMENT_SOURCE_TYPES } from "../src/domain/types";

const root = process.cwd();

/**
 * The mapping is read from source rather than imported.
 *
 * `ui/category-icon.tsx` pulls in `react-native` and forty lucide modules, and
 * this suite runs in plain node — the same reason `design-system-contract`
 * reads `useSeriesColors`'s neighbours as text. What matters here is TOTALITY
 * of the table, which the source answers exactly.
 */
const mappingSource = readFileSync(join(root, "src/ui/category-icon.tsx"), "utf8");

function mappedGlyphs(): Set<string> {
  const table = mappingSource.slice(
    mappingSource.indexOf("const CATEGORY_GLYPHS"),
    mappingSource.indexOf("const UNKNOWN_GLYPH"),
  );
  return new Set([...table.matchAll(/"([^"]+)":\s*[A-Z]/g)].map((match) => match[1]!));
}

function mappedSourceTypes(): Set<string> {
  const table = mappingSource.slice(
    mappingSource.indexOf("const SOURCE_GLYPHS"),
    mappingSource.indexOf("export function paymentSourceIconComponent"),
  );
  return new Set([...table.matchAll(/(\w+):\s*[A-Z]/g)].map((match) => match[1]!));
}

/**
 * Names chosen to hit every keyword rule in `domain/category-icons`, plus
 * enough unmatched names to reach both deterministic fallback pools.
 */
const KEYWORD_NAMES = [
  "Kira", "Market", "Araç & Yakıt", "Ulaşım", "Fatura", "Yatırım", "Maaş",
  "Sağlık", "Eğitim", "Giyim", "Eğlence", "Kredi", "Kart", "Spor", "Tatil",
  "Hediye", "Sigorta", "Vergi", "Bakım", "Elektrik", "Su", "Doğalgaz",
  "İnternet", "Çocuk", "Evcil", "Restoran", "Prim",
];

describe("every storable mark has a drawn icon", () => {
  it("covers every keyword rule in the domain suggester", () => {
    const mapped = mappedGlyphs();
    const missing: string[] = [];
    for (const name of KEYWORD_NAMES) {
      for (const kind of ["expense", "income"] as const) {
        const glyph = suggestCategoryIcon(name, kind);
        if (!mapped.has(glyph)) missing.push(`${name} (${kind}) → ${glyph}`);
      }
    }
    expect(missing, "a keyword rule with no drawn icon").toEqual([]);
  });

  /**
   * The fallback pools are reached by hashing the name, so this walks a wide
   * spread of names to land on every slot in both pools rather than trusting
   * that a handful happens to.
   */
  it("covers both deterministic fallback pools", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      for (const kind of ["expense", "income"] as const) {
        seen.add(suggestCategoryIcon(`zzz-${index}`, kind));
      }
    }
    expect(seen.size, "the walk must actually reach several fallback slots").toBeGreaterThan(8);
    const mapped = mappedGlyphs();
    expect([...seen].filter((glyph) => !mapped.has(glyph)), "a fallback with no drawn icon").toEqual([]);
  });

  it("draws every payment source type", () => {
    const mapped = mappedSourceTypes();
    expect([...PAYMENT_SOURCE_TYPES].filter((type) => !mapped.has(type))).toEqual([]);
  });

  it("still answers for a value written by an older build", () => {
    // A restored backup can carry a glyph this build has never heard of, so
    // the lookup falls back rather than asserting.
    expect(mappingSource).toContain("?? UNKNOWN_GLYPH");
    expect(mappingSource).toContain("const UNKNOWN_GLYPH");
  });
});

describe("no screen renders a raw category or source glyph", () => {
  it("keeps the emoji inside the mapping table and nowhere else", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles("src", { atLeast: 150 })) {
      if (path === "src/ui/category-icon.tsx") continue;
      if (path === "src/domain/category-icons.ts") continue;
      const source = readFileSync(join(root, path), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        // The two domain helpers return a glyph string; calling either from a
        // screen means that string is on its way to a `<Text>`.
        if (/\b(?:categoryIcon|paymentSourceIcon)\s*\(/.test(line)) {
          offenders.push(`${path}:${index + 1}`);
        }
      }
    }
    expect(offenders, "a screen rendering a stored glyph instead of a drawn icon").toEqual([]);
  });

  it("leaves no emoji-sized text role in the UI", () => {
    const offenders = sourceFiles("src", { atLeast: 150 }).filter((path) =>
      /iconSize\.emoji/.test(readFileSync(join(root, path), "utf8")),
    );
    expect(offenders, "an emoji drawn as text").toEqual([]);
  });
});
