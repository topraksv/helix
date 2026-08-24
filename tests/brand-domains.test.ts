import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_MARK_AUDIT, MIN_MARK_PX } from "../src/ui/brand-marks";

const root = process.cwd();
const logoSource = readFileSync(join(root, "src/ui/logo.tsx"), "utf8");

/** Every domain the logo catalogue asks the favicon service for. */
function fetchedDomains(): string[] {
  const table = logoSource.slice(
    logoSource.indexOf("const BRAND_DOMAIN"),
    logoSource.indexOf("export const UNMARKED_INSTITUTIONS"),
  );
  return [...new Set([...table.matchAll(/:\s*"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)].map((m) => m[1]!))].sort();
}

/**
 * `logo.tsx` imports react-native and cannot be loaded here, so the catalogue
 * is read as text — the same route `design-system-contract.test.ts` takes.
 *
 * These two rules are what a measured audit buys. Before it, twenty-seven
 * payment methods pointed at a 16-44px mark that the app then blew up into a
 * tile up to 144 device pixels wide, and two of them drew a different
 * institution's logo byte for byte.
 */
describe("brand marks", () => {
  it("asks only for marks big enough to draw", () => {
    const tooSmall = fetchedDomains()
      .map((domain) => ({ domain, px: BRAND_MARK_AUDIT[domain] }))
      .filter((entry) => entry.px == null || entry.px < MIN_MARK_PX);
    expect(tooSmall, "a mark under 48px is a smear in a 36-48pt tile").toEqual([]);
  });

  it("has a measurement on record for every domain it fetches", () => {
    const unmeasured = fetchedDomains().filter((domain) => BRAND_MARK_AUDIT[domain] == null);
    expect(unmeasured, "run scripts/audit-brand-marks.mjs").toEqual([]);
  });

  it("never draws one institution's logo for another", () => {
    // Two names resolving to one domain is fine when it is one institution
    // under two spellings ("yapi kredi" / "yapikredi"). Two DIFFERENT
    // institutions sharing a picture is not, and it happened twice: Nays drew
    // İş Bankası's favicon and Advantage drew HSBC's, byte for byte.
    for (const borrowed of ["naysapp.com.tr", "advantage.com.tr"]) {
      expect(fetchedDomains(), `${borrowed} is another brand's mark`).not.toContain(borrowed);
    }
  });

  it("keeps the names it stopped fetching on the record", () => {
    const listed = logoSource.slice(logoSource.indexOf("export const UNMARKED_INSTITUTIONS"));
    for (const name of ["akbank", "vakifbank", "world", "bonus", "nays", "advantage"]) {
      expect(listed, `${name} must say why it has no mark`).toContain(`"${name}"`);
    }
  });
});
