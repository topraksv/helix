/**
 * The shipped fonts are subsets, so this is what stands between a smaller
 * download and a screen full of tofu.
 *
 * `scripts/subset-fonts.mjs` cuts ~2_849 codepoints per face down to the Latin
 * scripts and the symbol blocks the UI draws from. Two things can go wrong and
 * neither is visible in a diff: a character the app renders gets dropped, or a
 * glyph that survives comes back a different width — which would silently
 * invalidate every measured width in the design system (`ledgerCellWidth`,
 * `compactMonthHeadWidth`, `amount-layout`).
 *
 * The character set is not a hand-written list. It is read out of the source
 * and the Turkish copy, so a new symbol in the UI is covered here the moment
 * it is written.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./source-corpus";

const FONT_DIR = "assets/fonts";

/**
 * Minimal TrueType reader: the `cmap` character map and the `hmtx` advance
 * widths. Enough to answer "can this font draw that character, and how wide is
 * it", without a font library in the test dependencies.
 */
function readFont(path: string) {
  const buffer = readFileSync(path);
  const tables = new Map<string, { offset: number; length: number }>();
  const numTables = buffer.readUInt16BE(4);
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    tables.set(buffer.toString("ascii", record, record + 4), {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    });
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !cmap) throw new Error(`${path}: missing a required table`);

  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const numberOfHMetrics = buffer.readUInt16BE(hhea.offset + 34);

  // Prefer a Unicode BMP subtable (platform 3, encoding 1 or 10).
  let subtable = -1;
  const numSubtables = buffer.readUInt16BE(cmap.offset + 2);
  for (let index = 0; index < numSubtables; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    const offset = cmap.offset + buffer.readUInt32BE(record + 4);
    if (platform === 3 && (encoding === 1 || encoding === 10)) subtable = offset;
    else if (subtable === -1 && platform === 0) subtable = offset;
  }
  if (subtable === -1) throw new Error(`${path}: no Unicode cmap`);
  const format = buffer.readUInt16BE(subtable);

  // Format 4 is the BMP layout a subset collapses to; format 12 is the 32-bit
  // one the full upstream faces need. Both appear here, so both are read.
  let glyphFor: (codePoint: number) => number;
  if (format === 4) {
    const segCount = buffer.readUInt16BE(subtable + 6) / 2;
    const endAt = subtable + 14;
    const startAt = endAt + segCount * 2 + 2;
    const deltaAt = startAt + segCount * 2;
    const rangeAt = deltaAt + segCount * 2;
    glyphFor = (codePoint) => {
      for (let segment = 0; segment < segCount; segment += 1) {
        const end = buffer.readUInt16BE(endAt + segment * 2);
        if (codePoint > end) continue;
        const start = buffer.readUInt16BE(startAt + segment * 2);
        if (codePoint < start) return 0;
        const rangeOffset = buffer.readUInt16BE(rangeAt + segment * 2);
        const delta = buffer.readInt16BE(deltaAt + segment * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = buffer.readUInt16BE(rangeAt + segment * 2 + rangeOffset + (codePoint - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  } else if (format === 12) {
    const groups = buffer.readUInt32BE(subtable + 12);
    const groupsAt = subtable + 16;
    glyphFor = (codePoint) => {
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const at = groupsAt + middle * 12;
        const start = buffer.readUInt32BE(at);
        const end = buffer.readUInt32BE(at + 4);
        if (codePoint < start) high = middle - 1;
        else if (codePoint > end) low = middle + 1;
        else return buffer.readUInt32BE(at + 8) + (codePoint - start);
      }
      return 0;
    };
  } else {
    throw new Error(`${path}: unsupported cmap format ${format}`);
  }

  const advanceOf = (glyph: number): number =>
    buffer.readUInt16BE(hmtx.offset + Math.min(glyph, numberOfHMetrics - 1) * 4);

  return { unitsPerEm, glyphFor, advanceOf };
}

/** Every character the app can render from its own source and copy. */
function charactersTheAppRenders(): Set<string> {
  const found = new Set<string>();
  for (const file of [...sourceFiles("src", { atLeast: 150 }), ...sourceFiles("e2e", { extensions: [".ts"], atLeast: 5 })]) {
    for (const character of readFileSync(file, "utf8")) {
      const codePoint = character.codePointAt(0) ?? 0;
      // Above the BMP is emoji, which no text font carries — the platform
      // emoji font draws those and always has.
      if (codePoint > 0x20 && codePoint <= 0xffff) found.add(character);
    }
  }
  return found;
}

const fonts = readdirSync(FONT_DIR).filter((name) => name.endsWith(".ttf"));

describe("shipped fonts", () => {
  it("ships the five faces the theme names, and their licences", () => {
    expect(fonts.sort()).toEqual([
      "IBMPlexSerif_600SemiBold.ttf",
      "Inter_400Regular.ttf",
      "Inter_500Medium.ttf",
      "Inter_600SemiBold.ttf",
      "Inter_700Bold.ttf",
    ]);
    // The OFL requires the licence to travel with the font.
    expect(readFileSync(join(FONT_DIR, "Inter-OFL.txt"), "utf8")).toContain("SIL Open Font License");
    expect(readFileSync(join(FONT_DIR, "IBMPlexSerif-OFL.txt"), "utf8")).toContain("SIL Open Font License");
  });

  it("draws every character the app itself renders", () => {
    // Inter is the body face: it must cover everything. The serif is used for
    // headings and figures only, and legitimately lacks some symbols — the
    // platform already fell back for those before the subset existed.
    const required = charactersTheAppRenders();
    expect(required.size).toBeGreaterThan(100);
    const inter = readFont(join(FONT_DIR, "Inter_400Regular.ttf"));
    const upstream = readFont("node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf");

    const dropped = [...required].filter(
      (character) => upstream.glyphFor(character.codePointAt(0) ?? 0) !== 0
        && inter.glyphFor(character.codePointAt(0) ?? 0) === 0,
    );
    expect(dropped).toEqual([]);
  });

  it("keeps every retained glyph exactly as wide as upstream", () => {
    // Subsetting removes glyphs. If it ever reshapes one, every measured width
    // in the design system is quietly wrong.
    for (const [file, source] of [
      ["Inter_400Regular.ttf", "node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"],
      ["Inter_700Bold.ttf", "node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"],
      ["IBMPlexSerif_600SemiBold.ttf", "node_modules/@expo-google-fonts/ibm-plex-serif/600SemiBold/IBMPlexSerif_600SemiBold.ttf"],
    ]) {
      const shipped = readFont(join(FONT_DIR, file as string));
      const upstream = readFont(source as string);
      expect(shipped.unitsPerEm, file).toBe(upstream.unitsPerEm);
      for (const character of "0123456789.,₺%ABCÇĞİÖŞÜabcçğıöşü") {
        const codePoint = character.codePointAt(0) ?? 0;
        const shippedGlyph = shipped.glyphFor(codePoint);
        const upstreamGlyph = upstream.glyphFor(codePoint);
        if (upstreamGlyph === 0) continue;
        expect(shippedGlyph, `${file} ${character}`).not.toBe(0);
        expect(shipped.advanceOf(shippedGlyph), `${file} advance of ${character}`)
          .toBe(upstream.advanceOf(upstreamGlyph));
      }
    }
  });

  it("keeps the digit spread `.ai/INVARIANTS.md` measured", () => {
    // The serif is tabular by construction (0%), which is why figures may use
    // it; Inter is proportional (37%) and every ledger width in the app is
    // calibrated against exactly that. Either number moving invalidates a
    // measurement somewhere.
    const spread = (file: string): number => {
      const font = readFont(join(FONT_DIR, file));
      const widths = [..."0123456789"].map((digit) => font.advanceOf(font.glyphFor(digit.codePointAt(0) ?? 0)));
      return ((Math.max(...widths) - Math.min(...widths)) / Math.max(...widths)) * 100;
    };
    expect(Math.round(spread("IBMPlexSerif_600SemiBold.ttf"))).toBe(0);
    expect(Math.round(spread("Inter_400Regular.ttf"))).toBe(37);
  });

  it("is meaningfully smaller than shipping the faces whole", () => {
    const shipped = fonts.reduce((total, name) => total + statSync(join(FONT_DIR, name)).size, 0);
    // Measured 1_534_728 -> 791_272. A subset that stops saving anything is a
    // subset whose ranges have grown back to the whole font.
    expect(shipped).toBeLessThan(1_000_000);
  });
});
