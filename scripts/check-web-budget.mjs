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
const limits = {
  entryJavaScript: 5_090_000,
  totalJavaScript: 5_760_000,
  totalExport: 10_000_000,
  fontFiles: 6,
  fontBytes: 1_600_000,
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
