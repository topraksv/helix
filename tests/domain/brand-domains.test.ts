import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_MARK_AUDIT, PLACEHOLDER_MARK_SHA } from "../fixtures/brand-mark-audit";
import { markProvider } from "../../src/domain/brand-marks";
import { remoteFaviconUrl } from "../../src/domain/logo-domain";

const root = process.cwd();
const logoSource = readFileSync(join(root, "src/ui/logo.tsx"), "utf8");

/** Every domain the logo catalogue asks a favicon service for. */
function fetchedDomains(): string[] {
  const table = logoSource.slice(
    logoSource.indexOf("const BRAND_DOMAIN"),
    logoSource.indexOf("UNMARKED INSTITUTIONS (checked, no mark published)"),
  );
  return [...new Set([...table.matchAll(/:\s*"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)].map((m) => m[1]!))].sort();
}

/** `bundled-marks.ts` requires its files, which only Metro resolves, so it too is read as text. */
const bundledSource = readFileSync(join(root, "src/ui/bundled-marks.ts"), "utf8");
const bundled = new Map(
  [...bundledSource.matchAll(/^ {2}"([^"]+)": \{ source: require\("\.\.\/\.\.\/(assets\/marks\/[^"]+\.webp)"\)/gm)].map((m) => [m[1]!, m[2]!]),
);

/** A WebP's canvas width, from whichever of its three headers it carries. */
function webpWidth(file: string): number {
  const buf = readFileSync(join(root, file));
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8X") return buf.readUIntLE(24, 3) + 1;
  if (chunk === "VP8L") return (buf.readUInt16LE(21) & 0x3fff) + 1;
  return buf.readUInt16LE(26) & 0x3fff;
}

/**
 * `logo.tsx` imports react-native and cannot be loaded here, so the catalogue
 * is read as text — the same route `design-system-contract.test.ts` takes.
 *
 * The rule this suite protects is not "marks must be large". It is "every
 * domain the app fetches has been measured, the app asks the service that
 * measured better, and nothing in the catalogue is a placeholder or another
 * brand's logo". Size is then whatever the brand actually publishes: a real
 * 16px World mark beats a grey tile at 48.
 */
describe("brand marks", () => {
  it("has a measurement on record for every domain it fetches", () => {
    // A floor first, because every assertion in this file reads the catalogue
    // out of a TEXT SLICE between two markers: shorten the slice and the
    // checks below inspect fewer domains and all still pass. The count is what
    // notices that the slice stopped covering the tables.
    expect(fetchedDomains().length, "the catalogue slice no longer reaches both tables").toBeGreaterThan(150);
    const unmeasured = fetchedDomains().filter((domain) => BRAND_MARK_AUDIT[domain] == null);
    expect(unmeasured, "run scripts/audit-brand-marks.mjs").toEqual([]);
  });

  it("never keeps a domain whose only answer is a placeholder", () => {
    // Placeholders are larger than many real marks, so a size check is the wrong test; a placeholder scores as nothing.
    const placeholders = Object.entries(BRAND_MARK_AUDIT)
      .filter(([, mark]) => mark.px === 0 || PLACEHOLDER_MARK_SHA.includes(mark.sha as (typeof PLACEHOLDER_MARK_SHA)[number]))
      .map(([domain]) => domain);
    expect(placeholders).toEqual([]);
  });

  it("never draws one institution's logo for another", () => {
    // Two institutions sharing one picture is a borrowed mark; checked here because a lazily generated avatar can slip past the generator.
    expect(fetchedDomains(), "naysapp.com.tr is İş Bankası's mark").not.toContain("naysapp.com.tr");

    // Byte-identical marks that ARE the same institution under two names.
    // Advantage is HSBC's card programme, BluTV became Max in Turkey, and
    // Microsoft 365 is Office. Anything else sharing bytes is a new borrow.
    const sameOwner = [
      ["advantage.com.tr", "hsbc.com.tr"],
      ["blutv.com", "max.com"],
      ["microsoft365.com", "office.com"],
      ["drive.google.com", "google.com"],
      ["gemini.google.com", "google.com"],
      ["one.google.com", "google.com"],
    ].map((pair) => pair.join(" "));
    const bySha = new Map<string, string[]>();
    for (const domain of fetchedDomains()) {
      const mark = BRAND_MARK_AUDIT[domain];
      if (!mark) continue;
      bySha.set(mark.sha, [...(bySha.get(mark.sha) ?? []), domain]);
    }
    const shared = [...bySha.values()]
      .filter((domains) => domains.length > 1)
      .map((domains) => domains.join(" "))
      .filter((pair) => !sameOwner.includes(pair));
    expect(shared, "these brands wear each other's logo").toEqual([]);
  });

  it("asks the service that measured better for that domain", () => {
    // The app ships only the short DuckDuckGo list; this keeps it in step with the full record.
    for (const [domain, mark] of Object.entries(BRAND_MARK_AUDIT)) {
      if (bundled.has(domain)) continue;
      expect(markProvider(domain), domain).toBe(mark.provider);
      const host = { duckduckgo: "icons.duckduckgo.com", iconhorse: "icon.horse", google: "www.google.com" }[mark.provider];
      expect(new URL(remoteFaviconUrl(domain)!).hostname, domain).toBe(host);
    }
  });

  it("ships its own mark wherever the published one would draw pixelated", () => {
    // The largest tile is the forms' 46pt; a favicon fills 82% of it, so a 3x
    // screen needs 114px from a service and 138px from a bundled edge-to-edge mark.
    expect(bundled.size, "the table's line shape changed and the reader matched nothing").toBeGreaterThan(60);
    const soft = fetchedDomains().filter((domain) => (BRAND_MARK_AUDIT[domain]?.px ?? 0) < Math.ceil(46 * 0.82 * 3));
    expect(soft.filter((domain) => !bundled.has(domain)), "add a mark to src/ui/bundled-marks.ts").toEqual([]);
    for (const [domain, file] of bundled) expect(webpWidth(file), domain).toBeGreaterThanOrEqual(46 * 3);
  });

  it("keeps the names it has no mark for on the record", () => {
    const recorded = logoSource.indexOf("UNMARKED INSTITUTIONS (checked, no mark published)");
    expect(recorded, "the record these names live in must still exist").toBeGreaterThan(0);
    const listed = logoSource.slice(recorded);
    for (const name of ["denizbank", "turkiye finans", "tosla", "nays", "bip", "bisu", "millenicom"]) {
      expect(listed, `${name} must say why it has no mark`).toContain(`"${name}"`);
    }
  });
});
