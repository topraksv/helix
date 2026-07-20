import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.argv[2] ?? "dist";
// Measured from a production `expo export -p web`, with headroom for ordinary
// growth. The font budgets were tightened after two faces that no `type.*`
// scale or fontFamily ever referenced (Inter_800ExtraBold, Fraunces_500Medium)
// were removed: 8 files / 1_935_428 bytes -> 6 files / 1_518_000 bytes. Keep
// fontFiles exact so adding a weight has to be a deliberate decision.
const limits = {
  entryJavaScript: 4_900_000,
  totalJavaScript: 5_500_000,
  totalExport: 10_000_000,
  fontFiles: 6,
  fontBytes: 1_600_000,
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
const sum = (items) => items.reduce((total, item) => total + item.size, 0);
const metrics = {
  entryJavaScript: entry?.size ?? 0,
  totalJavaScript: sum(javaScript),
  totalExport: sum(files),
  fontFiles: fonts.length,
  fontBytes: sum(fonts),
};

for (const [name, value] of Object.entries(metrics)) {
  const limit = limits[name];
  const unit = name === "fontFiles" ? "" : " bytes";
  console.log(`${name}: ${value}${unit} (budget ${limit}${unit})`);
  if (value > limit) process.exitCode = 1;
}
if (!entry) {
  console.error(`No Expo entry bundle found under ${relative(process.cwd(), root) || root}`);
  process.exitCode = 1;
}
if (process.exitCode) {
  console.error("Web export exceeds its measured release budget.");
} else {
  console.log("Web export is within its release budget.");
}
