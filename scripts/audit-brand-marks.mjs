/**
 * Ask every favicon service for every domain `src/ui/logo.tsx` names, keep the best REAL mark, and rewrite
 * `tests/fixtures/brand-mark-audit.ts`. By hand, never CI: it hits third-party networks. `node scripts/audit-brand-marks.mjs`
 *
 * A BIGGER PICTURE IS NOT A BETTER LOGO: these services answer "never heard of it" with an image, often larger than a
 * real mark, so each service is first asked for domains that cannot exist and whatever comes back is its set of lies.
 * `src/domain/brand-marks.ts` is not rewritten; the log prints its provider lists ready to paste.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "src/ui/logo.tsx";
const TARGET = "tests/fixtures/brand-mark-audit.ts";
/** Filled by `learnPlaceholders()` before any real domain is measured. */
const PLACEHOLDER = new Set();

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

const URLS = {
  google: (domain) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
  duckduckgo: (domain) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  iconhorse: (domain) => `https://icon.horse/icon/${encodeURIComponent(domain)}`,
};
const PROVIDERS = Object.keys(URLS);

async function fetchBytes(domain, provider) {
  try {
    const response = await fetch(URLS[provider](domain), { redirect: "follow" });
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return Buffer.alloc(0);
  }
}

const sha12 = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 12);

// One control per letter, because the letter avatars differ by initial.
async function learnPlaceholders() {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  const controls = letters.map((letter) => `${letter}zqx-no-such-brand-9317.com`);
  for (const provider of PROVIDERS) {
    const bodies = await Promise.all(controls.map((domain) => fetchBytes(domain, provider)));
    for (const body of bodies) {
      if (body.length > 0) PLACEHOLDER.add(sha12(body));
    }
  }
  console.log(`learned ${PLACEHOLDER.size} placeholder image(s) across ${PROVIDERS.length} services\n`);
}

/** The mark a provider serves, or width 0 when it only has a placeholder. */
async function measure(domain, provider) {
  const buffer = await fetchBytes(domain, provider);
  const sha = sha12(buffer);
  return buffer.length === 0 || PLACEHOLDER.has(sha) ? { px: 0, sha: "" } : { px: markWidth(buffer), sha };
}

const source = readFileSync(SOURCE, "utf8");
const domains = [...new Set([...source.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)].map((m) => m[1]))]
  .filter((d) => /\.[a-z]{2,10}(\.[a-z]{2})?$/.test(d))
  .sort();

await learnPlaceholders();

/** Every service's answer for every domain, before anything is chosen. */
const answers = {};
for (const domain of domains) {
  answers[domain] = await Promise.all(PROVIDERS.map((p) => measure(domain, p)));
  const detail = PROVIDERS.map((p, i) => `${p} ${answers[domain][i].px}`).join(", ");
  console.log(`${domain.padEnd(26)} (${detail})`);
}

// icon.horse tells different lies over a run, so a control fetched first can miss one: an image served for two
// unrelated brands is invented and scores nothing, unless they are one owner.
const SAME_OWNER = [
  ["advantage.com.tr", "hsbc.com.tr"],
  ["blutv.com", "max.com"],
  ["microsoft365.com", "office.com"],
  ["drive.google.com", "google.com"],
  ["gemini.google.com", "google.com"],
  ["one.google.com", "google.com"],
].map((pair) => pair.sort().join(" "));

const seen = new Map();
for (const [domain, results] of Object.entries(answers)) {
  for (const r of results) {
    if (r.px === 0) continue;
    seen.set(r.sha, [...(seen.get(r.sha) ?? []), domain]);
  }
}
const invented = new Set();
for (const [sha, sharers] of seen) {
  const unique = [...new Set(sharers)];
  if (unique.length > 1 && !SAME_OWNER.includes(unique.sort().join(" "))) {
    invented.add(sha);
    console.log(`  shared by ${unique.length} brands, treating as invented: ${sha} (${unique.join(", ")})`);
  }
}

const measured = {};
for (const [domain, results] of Object.entries(answers)) {
  // Ties go to the earliest provider: Google is already in the page's
  // `img-src` for its gstatic redirect, and a tie buys nothing by adding
  // another host to the picture.
  let best = { px: 0, sha: "", provider: "google" };
  for (let i = 0; i < PROVIDERS.length; i += 1) {
    const r = results[i];
    if (r.px > best.px && !invented.has(r.sha)) best = { ...r, provider: PROVIDERS[i] };
  }
  measured[domain] = best;
}

const head = readFileSync(TARGET, "utf8");
const body = Object.entries(measured)
  .filter(([, m]) => m.px > 0)
  .map(([d, { px, provider, sha }]) => `  "${d}": { px: ${px}, provider: "${provider}", sha: "${sha}" },`)
  .join("\n");
writeFileSync(
  TARGET,
  `${head.slice(0, head.indexOf("export const BRAND_MARK_AUDIT"))}export const BRAND_MARK_AUDIT: Record<string, BrandMark> = {\n${body}\n};\n`,
);
const missing = Object.entries(measured).filter(([, m]) => m.px === 0);
console.log(`\nrewrote ${TARGET}: ${domains.length - missing.length} marked, ${missing.length} unmarked`);
for (const [d] of missing) console.log(`  unmarked: ${d}`);
const byProvider = {};
for (const [d, m] of Object.entries(measured)) {
  if (m.px === 0 || m.provider === "google") continue;
  (byProvider[m.provider] ??= []).push(d);
}
for (const [provider, list] of Object.entries(byProvider)) {
  console.log(`\n${provider.toUpperCase()}_MARKS in src/domain/brand-marks.ts:\n${list.map((d) => `  "${d}",`).join("\n")}`);
}
