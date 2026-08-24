/**
 * Measure the mark behind every domain `src/ui/logo.tsx` asks the favicon
 * service for, and rewrite `src/ui/brand-marks.ts` with what came back.
 *
 * Run it by hand, not in CI: it makes one network request per domain to a
 * third party, and the app is offline-first — the point of recording the
 * result is that nothing at build or run time has to ask again.
 *
 *   node scripts/audit-brand-marks.mjs
 *
 * A domain whose mark has shrunk below `MIN_MARK_PX`, or that has started
 * returning the not-indexed grey globe, shows up as a failing test in
 * `tests/brand-domains.test.ts` rather than as a smear in a payment list.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "src/ui/logo.tsx";
const TARGET = "src/ui/brand-marks.ts";

/** Real pixel width from the image header — PNG IHDR or JPEG SOFn. */
function markWidth(buffer) {
  if (buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return buffer.readUInt32BE(16);
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let i = 2;
    while (i < buffer.length - 9) {
      if (buffer[i] !== 0xff) { i += 1; continue; }
      const marker = buffer[i + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return buffer.readUInt16BE(i + 7);
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buffer.readUInt16BE(i + 2);
    }
  }
  return 0;
}

const source = readFileSync(SOURCE, "utf8");
const domains = [...new Set([...source.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)].map((m) => m[1]))]
  .filter((d) => /\.[a-z]{2,3}(\.[a-z]{2})?$/.test(d))
  .sort();

const measured = {};
for (const domain of domains) {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
  try {
    const response = await fetch(url, { redirect: "follow" });
    const buffer = Buffer.from(await response.arrayBuffer());
    measured[domain] = markWidth(buffer);
    console.log(`${domain.padEnd(26)} ${String(measured[domain]).padStart(4)}px`);
  } catch (error) {
    measured[domain] = 0;
    console.log(`${domain.padEnd(26)}  failed: ${error.message}`);
  }
}

const existing = readFileSync(TARGET, "utf8");
const head = existing.slice(0, existing.indexOf("export const BRAND_MARK_AUDIT"));
const body = Object.entries(measured).map(([d, w]) => `  "${d}": ${w},`).join("\n");
writeFileSync(TARGET, `${head}export const BRAND_MARK_AUDIT: Record<string, number> = {\n${body}\n};\n`);
console.log(`\nrewrote ${TARGET} with ${domains.length} domains`);
