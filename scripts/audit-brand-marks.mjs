/**
 * Ask every favicon service for every domain `src/ui/logo.tsx` names, keep the
 * best REAL mark, and rewrite `src/domain/brand-mark-audit.ts` with the answer.
 *
 * Run it by hand, not in CI: it makes several network requests per domain to
 * third parties, and the app is offline-first — the point of recording the
 * result is that nothing at build or run time has to ask again.
 *
 *   node scripts/audit-brand-marks.mjs
 *
 * The rule this script exists to enforce is that A BIGGER PICTURE IS NOT A
 * BETTER LOGO. Every one of these services answers "never heard of it" with an
 * image rather than an error, and their invented images are LARGER than most
 * real marks:
 *
 *   - Google returns a 16x16 grey globe.
 *   - DuckDuckGo returns a 48x48 grey letter tile — bigger than the genuine
 *     favicons of `qnb.com.tr`, `teb.com.tr`, `worldcard.com.tr` and
 *     `nays.com.tr`, all of which it briefly "improved".
 *   - icon.horse generates a 256x256 letter avatar, and a different one per
 *     first letter, so a single known hash cannot catch it. Scored on pixels
 *     it beats every real mark in the catalogue.
 *
 * So placeholders are not matched against a hard-coded list. Before measuring
 * anything, each service is asked for domains that cannot exist — one per
 * letter of the alphabet, because the invented images are letter-based — and
 * whatever comes back is that service's set of lies. A real domain whose bytes
 * match one of them scores nothing, however many pixels it has.
 *
 * The runtime file `src/domain/brand-marks.ts` is NOT rewritten here. Which
 * service to ask, and which marks are too small to enlarge, are conclusions a
 * person draws from this output; the log prints both lists ready to paste.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "src/ui/logo.tsx";
const TARGET = "src/domain/brand-mark-audit.ts";
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

const PROVIDERS = ["google", "duckduckgo", "iconhorse"];

function url(domain, provider) {
  if (provider === "duckduckgo") return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  if (provider === "iconhorse") return `https://icon.horse/icon/${encodeURIComponent(domain)}`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}

async function fetchBytes(domain, provider) {
  try {
    const response = await fetch(url(domain, provider), { redirect: "follow" });
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return Buffer.alloc(0);
  }
}

const sha12 = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 12);

/**
 * What each service invents for a domain that does not exist.
 *
 * One control per letter: the letter avatars differ by initial, so a single
 * control would only ever catch the brands starting with that letter. The
 * suffix is nonsense no registrar would sell, and it is asked once per run.
 */
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
/** The mark a provider serves, or width 0 when it only has a placeholder. */
async function measure(domain, provider) {
  const buffer = await fetchBytes(domain, provider);
  if (buffer.length === 0) return { px: 0, sha: "" };
  const sha = sha12(buffer);
  if (PLACEHOLDER.has(sha)) return { px: 0, sha: "" };
  return { px: markWidth(buffer), sha };
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

/**
 * A second pass over the answers, because one control probe is not enough.
 *
 * icon.horse generates its letter avatar lazily: the first request for a
 * domain it has not crawled returns a generic image, and a later request for
 * the same letter can return a DIFFERENT generic image. So a control fetched
 * at the start of the run does not necessarily match the lie told in the
 * middle of it — measured, `carrefoursa.com` and `crunchyroll.com` both came
 * back as a real 256px mark and were byte-identical to a control fetched
 * afterwards.
 *
 * What no placeholder can hide from is being served for two unrelated brands.
 * Any image that appears for more than one domain is treated as invented and
 * scored nothing, except where the two names are genuinely one owner.
 */
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
const byProvider = {};
for (const [d, m] of Object.entries(measured)) {
  if (m.px === 0 || m.provider === "google") continue;
  (byProvider[m.provider] ??= []).push(d);
}
for (const [provider, list] of Object.entries(byProvider)) {
  console.log(`\n${provider.toUpperCase()}_MARKS in src/domain/brand-marks.ts:\n${list.map((d) => `  "${d}",`).join("\n")}`);
}
// A mark this small cannot be enlarged into a tile without smearing. The app
// draws it at its own scale instead, so it stays a small sharp logo rather
// than a large soft one.
const small = Object.entries(measured).filter(([, m]) => m.px > 0 && m.px < 48);
console.log(`\nSMALL_MARK_PX in src/domain/brand-marks.ts (${small.length} of ${domains.length}):\n${small.map(([d, m]) => `  "${d}": ${m.px},`).join("\n")}`);
