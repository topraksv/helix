#!/usr/bin/env node
/**
 * Regenerate `assets/fonts/` from the upstream Google Fonts packages.
 *
 *   pip install fonttools brotli    # once
 *   node scripts/subset-fonts.mjs
 *
 * Why the fonts are vendored at all: the upstream faces carry 2_849 codepoints
 * each — Cyrillic, Greek, Vietnamese, IPA, Latin Extended Additional — and this
 * is a Turkish product. Shipping them whole cost 1_534_728 bytes, 19% of the
 * web export, for coverage nothing renders. Subset to the Latin scripts plus
 * the punctuation, currency, arrow, math and symbol blocks the UI actually
 * draws from, that is 791_272.
 *
 * Why TTF for every platform rather than WOFF2 on the web: react-native cannot
 * load WOFF2, so a web-only format means two files per weight and two things
 * that can disagree. One file, one set of metrics, identical rendering on
 * mobile web, desktop web, desktop-mode mobile web and the installed app.
 *
 * What must not change, and is asserted by `tests/font-coverage.test.ts`:
 * every character the app renders survives, advance widths are untouched, and
 * the digit spread stays exactly what was measured — Inter at
 * 37% (proportional, and every ledger width is calibrated against it), IBM
 * Plex Serif at 0% (tabular by construction). Subsetting removes glyphs; it
 * must never reshape the ones it keeps.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "assets/fonts";

/**
 * Whole blocks, not a hand-picked character list. The app renders text the
 * USER typed — a category called "Café", a note with a Polish name — and a
 * per-character subset turns any of that into tofu. Blocks are cheap: the
 * whole Latin range plus every symbol block below is under half the original.
 */
const UNICODES = [
  "U+0000-024F", // Basic Latin, Latin-1, Latin Extended-A and -B
  "U+0259", // schwa, used by some Turkish loanword spellings
  "U+0370-03FF", // Greek — the app draws Σ
  "U+2000-206F", // General Punctuation: dashes, quotes, ellipsis, bullet, word joiner
  "U+2070-209F", // Super/subscripts
  "U+20A0-20BF", // Currency: ₺ and €
  "U+2100-214F", // Letterlike symbols
  "U+2190-21FF", // Arrows
  "U+2200-22FF", // Mathematical operators: − ≈ ≤
  "U+2300-23FF", // Misc technical: ⌫
  "U+25A0-25FF", // Geometric shapes
  "U+2600-27BF", // Misc symbols and dingbats: ⚠ ✓
].join(",");

const FACES = [
  ["@expo-google-fonts/inter", "400Regular", "Inter_400Regular.ttf"],
  ["@expo-google-fonts/inter", "500Medium", "Inter_500Medium.ttf"],
  ["@expo-google-fonts/inter", "600SemiBold", "Inter_600SemiBold.ttf"],
  ["@expo-google-fonts/inter", "700Bold", "Inter_700Bold.ttf"],
  ["@expo-google-fonts/ibm-plex-serif", "600SemiBold", "IBMPlexSerif_600SemiBold.ttf"],
];

mkdirSync(OUT, { recursive: true });

let before = 0;
let after = 0;
for (const [pkg, weight, file] of FACES) {
  const source = join("node_modules", pkg, weight, file);
  const target = join(OUT, file);
  execFileSync("pyftsubset", [
    source,
    `--output-file=${target}`,
    `--unicodes=${UNICODES}`,
    // Kerning and the numeric features the measured widths depend on.
    "--layout-features=*",
    "--glyph-names",
    "--notdef-outline",
    "--recommended-glyphs",
  ], { stdio: ["ignore", "inherit", "inherit"] });
  const from = statSync(source).size;
  const to = statSync(target).size;
  before += from;
  after += to;
  console.log(`${file.padEnd(30)} ${String(from).padStart(7)} -> ${String(to).padStart(7)}`);
}

// The OFL requires the licence to travel with the font.
for (const [pkg, name] of [["@expo-google-fonts/inter", "Inter-OFL.txt"], ["@expo-google-fonts/ibm-plex-serif", "IBMPlexSerif-OFL.txt"]]) {
  writeFileSync(join(OUT, name), readFileSync(join("node_modules", pkg, "LICENSE_FONT")));
}

console.log(`\ntotal ${before} -> ${after} (${(100 - (after / before) * 100).toFixed(1)}% smaller)`);
console.log("Run `npx vitest run tests/font-coverage.test.ts` to check nothing the app renders was dropped.");
