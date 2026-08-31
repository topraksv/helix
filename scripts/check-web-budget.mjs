import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.argv[2] ?? "dist";
// Measured from a production `expo export -p web`, with headroom for ordinary
// growth. The font budgets were tightened after two faces that no `type.*`
// scale or fontFamily ever referenced (Inter_800ExtraBold, IBMPlexSerif_300Light)
// were removed: 8 files / 1_935_428 bytes -> 6 files / 1_518_000 bytes. Keep
// fontFiles exact so adding a weight has to be a deliberate decision. The
// Investments V1 route set was measured against main before recalibrating the
// JavaScript ceilings: entry 4_870_467 -> 4_964_522 bytes and total JavaScript
// 5_499_676 -> 5_593_704 bytes. The new limits cover that shipped feature with
// narrow headroom; total export, fonts and public source-map limits stay fixed.
//
// The adaptive-layout work measured 5_022_450 entry / 5_651_632 total: a
// measured chart frame, a container-measuring donut, the axis's real-value
// ticks, per-operation lifecycle waiting copy and the rail's second gesture
// axis. That is +58k entry and +58k total against the line above, which the
// entry ceiling still covered and the total ceiling missed by 1_632 bytes.
// Both move once, together, keeping the same narrow headroom.
//
// The reported-defects pass measured 5_068_245 entry / 5_697_427 total: a live
// plan-state panel on the instalment editor, the shared segmented progress bar,
// the month-end control, the ranked allocation bars, the web view-transition
// path and 49 more brands in the subscription catalogue. That left 2_573 bytes
// under the total ceiling — narrow is the point, but a ceiling the next
// one-line change trips is a ceiling that stops being read. Total moves to
// 5_760_000, which is the measured figure plus the same ~1% of slack the entry
// ceiling carries; entry stays where it is because it did not move much.
//
// Then the icon barrel came out. `lucide-react-native` ships ~1_757 icons and
// the app draws 106 of them, but Metro does not tree-shake, so importing from
// the package root put all of them in the entry bundle — measured directly in
// the shipped file, which contained Aperture, Rocket, Telescope and every
// other icon nothing renders. Moving to the package's own `lucide-react-native
// /icons/<name>` deep paths measured entry 5_085_159 -> 3_318_684 and total
// JavaScript 5_714_924 -> 3_948_449: 1_766_475 bytes, 34.7% of the entry
// bundle. The ceilings come down with it, or the barrel could come back in one
// convenient import and nothing would say so. `tests/architecture-contract`
// holds the import rule; these hold the weight.
//
// Then the fonts were subset. Five faces carried ~2_849 codepoints each —
// Cyrillic, Greek, Vietnamese, IPA, Latin Extended Additional — for a Turkish
// product: 1_534_728 bytes, 19.1% of the export. `scripts/subset-fonts.mjs`
// cuts them to the Latin scripts plus the punctuation, currency, arrow, math
// and symbol blocks the UI draws, measured 791_272 and total export 8_037_750
// -> 7_269_039. Advance widths, OpenType features and the measured digit
// spreads are unchanged; `tests/font-coverage.test.ts` holds all three.
//
// Then variable-amount subscriptions shipped: a per-occurrence invoice entry
// sheet shared by the dashboard, upcoming list and reconciliation screens, a
// subscription-rule toggle that forecasts instead of auto-paying, and a
// category-delete flow that reassigns every live subscription/income/note/
// installment reference (or merges cell notes) instead of only counting
// transactions. Measured 3_364_521 entry / 3_994_286 total, both past the
// line below. Ceilings move once, together, to the measured figures plus the
// same ~1% of slack every prior line here carries.
//
// Then this pass shipped five surfaces and a document reader: the attention
// inbox, the card-statement import and its review, transaction attachments,
// the contextual-colour sheet and the allocation-target panel, plus the
// provenance/duplicate/matching model behind them. Measured 3_468_079 entry /
// 4_097_844 total / 7_505_655 export.
//
// Then this pass removed three features and rebuilt four surfaces. Out went
// the allocation-target panel, the duplicate review and the expected-to-ledger
// matching model; in came the statement review with per-row edit and delete,
// the four-slot colour sheet with renameable labels, the shared card-cycle and
// import-journey components, and drag-to-dismiss on the undo bar. Net +9_013
// bytes on every figure: measured 3_477_092 entry / 4_106_857 total /
// 7_514_668 export. The removals landed — knip reports no orphaned module —
// so this is the new UI paying for itself and a little more. Entry and total
// move back to measured plus the same ~1% every line above them carries; they
// had been left at 0.74%, which is a ceiling the next one-line change trips.
// Total export keeps its existing ceiling: it still clears by 65_332 bytes.
//
// SheetJS is NOT part of that growth and must not become part of it. The PDF
// reader borrows its inflate, and importing it statically measured 3_958_250
// entry — 490_171 bytes for a module the overwhelming majority of sessions
// never need. `src/services/pdf-text.ts` loads it with `await import` exactly
// as `spreadsheet-import.ts` does, and these ceilings are set below what a
// static import would cost, so putting it back trips this check rather than
// shipping quietly.
//
// Then feedback and payment-source marks shipped. The in-app report form (its
// category grid, screenshot picker and the domain rules all three of its
// parties re-check), and every payment source resolving a real mark through
// the same `Logo` the subscriptions use — which is a ~70-entry Turkish bank,
// card-programme and wallet catalogue. Measured 3_519_901 entry / 4_149_666
// total / 7_602_477 export: +7_901 entry for two features, which is the
// catalogue and one route rather than anything structural.
//
// The edge function that actually sends the mail is NOT in any of these
// figures and must not become so: it is Deno, it lives in
// `supabase/functions/`, and `tsconfig.json` and `eslint.config.js` both
// exclude it. Nothing in `src/` may import it.
//
// Entry and total move to measured plus the same ~1% every line above them
// carries. Total export moves to measured plus ~1.5% rather than the ~3% the
// note below it describes: fonts are the coarse part of that figure and they
// did not change, so the looser step is not earned here.
//
// Then the data reset shipped: one route under Hesap Güvenliği that empties a
// chosen part of the workspace by scope and date range, the repository module
// that plans and performs it, and the Turkish copy in which each scope says
// what it takes and what it leaves.
//
// Measured HEAD first, because the ceiling above had drifted to within 1_908
// bytes of the tree it was guarding and an unattributed rise would have been
// billed to this feature: HEAD 3_553_092 entry / 4_182_857 total / 7_660_024
// export. With the reset, 3_572_068 / 4_201_833 / 7_700_044 — so the feature
// itself is +18_976 on both JavaScript figures and +40_020 on the export,
// which is that one route's HTML on top of its share of the JavaScript.
//
// Total export moves as well this time. It still cleared by 16_956 bytes, but
// that is 0.22% — the next route would trip a ceiling nobody had reason to
// re-read, which is the failure the note above already warned about once.
//
// Then the market feed stopped being a socket. The dealer stream it read is
// gone, and with it `socket.io-client`: prices are now polled from a public
// exchange's market-data host and derived by arithmetic. The ceilings come DOWN
// with the dependency, or it could come back in one convenient import and
// nothing would say so — the same rule the icon-barrel note above set.
//
// That removal outweighed a whole new route: an instrument-history screen with
// its own chart, its four ranges and the candle model behind them. Measured
// 3_527_386 entry / 4_157_151 total / 7_676_406 export — 44_682 bytes BELOW the
// line above it on both JavaScript figures, feature included.
const limits = {
  entryJavaScript: 3_562_000,
  totalJavaScript: 4_198_000,
  // Fonts are 1_534_728 of this and the rest is one HTML file per route, so it
  // grows in coarser steps than the JavaScript above it — measured 8_037_112
  // with ~3% of slack rather than the ~1% the JS ceilings carry.
  totalExport: 7_791_000,
  fontFiles: 6,
  fontBytes: 800_000,
  // Pages is public. Symbolication maps belong only in a private crash service,
  // if one is approved later; neither map files nor bundle references ship.
  sourceMapFiles: 0,
  sourceMapReferences: 0,
};

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) return [];
    return [{ path, size: (await stat(path)).size }];
  }));
  return nested.flat();
}

const files = await walk(root);
const javaScript = files.filter((file) => extname(file.path) === ".js");
const entry = javaScript.find((file) => /[/\\]entry-[^/\\]+\.js$/.test(file.path));
const fonts = files.filter((file) => [".ttf", ".otf", ".woff", ".woff2"].includes(extname(file.path)));
const sourceMaps = files.filter((file) => extname(file.path) === ".map");
const sourceMapCandidates = files.filter((file) => [".js", ".css"].includes(extname(file.path)));
const sourceMapReferences = (
  await Promise.all(sourceMapCandidates.map(async (file) => (
    (await readFile(file.path, "utf8")).includes("sourceMappingURL=") ? file : null
  )))
).filter(Boolean);
const sum = (items) => items.reduce((total, item) => total + item.size, 0);
const metrics = {
  entryJavaScript: entry?.size ?? 0,
  totalJavaScript: sum(javaScript),
  totalExport: sum(files),
  fontFiles: fonts.length,
  fontBytes: sum(fonts),
  sourceMapFiles: sourceMaps.length,
  sourceMapReferences: sourceMapReferences.length,
};

for (const [name, value] of Object.entries(metrics)) {
  const limit = limits[name];
  const unit = name.endsWith("Files") || name.endsWith("References") ? "" : " bytes";
  console.log(`${name}: ${value}${unit} (budget ${limit}${unit})`);
  if (value > limit) process.exitCode = 1;
}
if (!entry) {
  console.error(`No Expo entry bundle found under ${relative(process.cwd(), root) || root}`);
  process.exitCode = 1;
}
// Metro's transform cache is shared by `expo export` and `eas update`, and its
// key does not include EXPO_PUBLIC_* values. A cache left behind by the
// local-only E2E export therefore yields a bundle where isSupabaseConfigured is
// false — sign-in and sync silently gone, with nothing in the export, the
// budget or the OTA evidence to show it. `--clear` prevents that; this proves
// it, because remembering a flag is not a control.
// Opt-in, because only a real production export makes this claim. CI puts the
// values in the job environment; locally only Expo reads `.env`, so the check
// reads it too — one that quietly skips itself is the failure mode it exists to
// catch, which is why the skip is printed rather than assumed.
if (entry && process.argv.includes("--require-supabase-config")) {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Neither environment nor .env: a local-only build, which is a legitimate
      // configuration with nothing to inline.
    }
  }
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.log("supabaseConfigInlined: skipped (no EXPO_PUBLIC_SUPABASE_URL configured)");
  } else {
    let trustedOrigin = null;
    try {
      const parsed = new URL(supabaseUrl);
      if (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash &&
        /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
      ) trustedOrigin = parsed.origin;
    } catch {
      // The explicit failure below is the release result.
    }
    console.log(`supabaseOriginTrusted: ${trustedOrigin != null} (expected true)`);
    if (!trustedOrigin) {
      console.error("EXPO_PUBLIC_SUPABASE_URL must be a bare HTTPS Supabase project origin.");
      process.exitCode = 1;
    }
    const inlined = (await readFile(entry.path, "utf8")).includes(supabaseUrl);
    console.log(`supabaseConfigInlined: ${inlined} (expected true)`);
    if (!inlined) {
      console.error("Entry bundle carries no Supabase configuration. Re-export with --clear.");
      process.exitCode = 1;
    }
  }
}
if (sourceMaps.length > 0) {
  console.error(`Public source maps found: ${sourceMaps.map((file) => relative(root, file.path)).join(", ")}`);
}
if (sourceMapReferences.length > 0) {
  console.error(`Public source-map references found: ${sourceMapReferences.map((file) => relative(root, file.path)).join(", ")}`);
}
if (process.exitCode) {
  console.error("Web export exceeds its measured release budget.");
} else {
  console.log("Web export is within its release budget.");
}
