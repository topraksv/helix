/**
 * Ask both favicon services for every domain `src/ui/logo.tsx` names, keep the
 * larger mark, and rewrite `src/domain/brand-mark-audit.ts` with the answer.
 *
 * The runtime list in `src/domain/brand-marks.ts` is NOT rewritten here: which
 * handful of domains take the DuckDuckGo route is a conclusion someone draws
 * from this output, and the log below prints exactly that line so it can be
 * copied across deliberately.
 *
 * Run it by hand, not in CI: it makes two network requests per domain to third
 * parties, and the app is offline-first — the point of recording the result is
 * that nothing at build or run time has to ask again.
 *
 *   node scripts/audit-brand-marks.mjs
 *
 * A domain that has stopped publishing a mark shows up as a failing test in
 * `tests/brand-domains.test.ts` rather than as a grey globe in a payment list.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "src/ui/logo.tsx";
const TARGET = "src/domain/brand-mark-audit.ts";
/**
 * Kept in step with `UNINDEXED_MARK_SHA` in the target file.
 *
 * Both services answer "never heard of it" with a picture rather than an
 * error, and each has its own: Google a 16px grey globe, DuckDuckGo a 48px
 * grey letter tile. The DuckDuckGo one is the more dangerous of the two,
 * because it is LARGER than most real marks — scored on size alone it wins,
 * and `qnb.com.tr`, `bonus.com.tr`, `teb.com.tr`, `worldcard.com.tr` and
 * `nays.com.tr` all "gained" a 48px logo that was the same grey tile.
 */
const PLACEHOLDER = new Set(["59bfe9bc385a", "e5db88ea2322"]);

/** Real pixel width from the image header — PNG IHDR, ICO directory, or JPEG SOFn. */
function markWidth(buffer) {
  if (buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return buffer.readUInt32BE(16);
  }
  // ICO: a directory of entries, each declaring its own width, with 0 meaning
  // 256. DuckDuckGo serves .ico, so reading only PNG would score it as zero.
  if (buffer.length > 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1) {
    const count = buffer.readUInt16LE(4);
    let widest = 0;
    for (let i = 0; i < count && 6 + i * 16 + 16 <= buffer.length; i += 1) {
      const declared = buffer[6 + i * 16];
      widest = Math.max(widest, declared === 0 ? 256 : declared);
    }
    return widest;
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

function url(domain, provider) {
  return provider === "duckduckgo"
    ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
    : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}

/** The mark a provider serves, or width 0 when it only has a placeholder. */
async function measure(domain, provider) {
  try {
    const response = await fetch(url(domain, provider), { redirect: "follow" });
    const buffer = Buffer.from(await response.arrayBuffer());
    // The not-indexed globe is a valid image, so size alone would score it as
    // a real 16px mark and let it reach the screen.
    const sha = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    if (PLACEHOLDER.has(sha)) return { px: 0, sha: "" };
    return { px: markWidth(buffer), sha };
  } catch {
    return { px: 0, sha: "" };
  }
}

const source = readFileSync(SOURCE, "utf8");
const domains = [...new Set([...source.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)].map((m) => m[1]))]
  .filter((d) => /\.[a-z]{2,10}(\.[a-z]{2})?$/.test(d))
  .sort();

const measured = {};
for (const domain of domains) {
  const [google, duckduckgo] = await Promise.all([measure(domain, "google"), measure(domain, "duckduckgo")]);
  // Ties go to Google: it is already in the CSP for the redirect to gstatic,
  // and a tie buys nothing by adding a second host to the picture.
  const best = duckduckgo.px > google.px ? { ...duckduckgo, provider: "duckduckgo" } : { ...google, provider: "google" };
  measured[domain] = best;
  const mark = `${String(best.px).padStart(4)}px ${best.provider}`;
  console.log(`${domain.padEnd(26)} ${mark.padEnd(20)} (google ${google.px}, ddg ${duckduckgo.px})`);
}

const existing = readFileSync(TARGET, "utf8");
const head = existing.slice(0, existing.indexOf("/** The best available mark per domain"));
const tail = existing.slice(existing.indexOf("/** The URL that serves"));
const body = Object.entries(measured)
  .filter(([, m]) => m.px > 0)
  .map(([d, { px, provider, sha }]) => `  "${d}": { px: ${px}, provider: "${provider}", sha: "${sha}" },`)
  .join("\n");
writeFileSync(
  TARGET,
  `${head}/** The best available mark per domain, by measurement. */\nexport const BRAND_MARK_AUDIT: Record<string, BrandMark> = {\n${body}\n};\n\n${tail}`,
);
const missing = Object.entries(measured).filter(([, m]) => m.px === 0);
console.log(`\nrewrote ${TARGET}: ${domains.length - missing.length} marked, ${missing.length} unmarked`);
for (const [d] of missing) console.log(`  unmarked: ${d}`);
// Byte-identical marks mean one brand is wearing another's logo. That is what
// `naysapp.com.tr` did with İş Bankası, and it is invisible to a size check.
const byShaMarks = new Map();
for (const [d, m] of Object.entries(measured)) {
  if (m.px === 0) continue;
  byShaMarks.set(m.sha, [...(byShaMarks.get(m.sha) ?? []), d]);
}
for (const [sha, shared] of byShaMarks) {
  if (shared.length > 1) console.log(`  shared mark ${sha}: ${shared.join(", ")}`);
}
const viaDuck = Object.entries(measured).filter(([, m]) => m.provider === "duckduckgo").map(([d]) => d);
console.log(`\nDUCKDUCKGO_MARKS in src/domain/brand-marks.ts should be:\n${viaDuck.map((d) => `  "${d}",`).join("\n")}`);
