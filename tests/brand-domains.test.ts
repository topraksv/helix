import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND_MARK_AUDIT, PLACEHOLDER_MARK_SHA } from "../src/domain/brand-mark-audit";
import { markProvider } from "../src/domain/brand-marks";
import { remoteFaviconUrl } from "../src/domain/logo-domain";

const root = process.cwd();
const logoSource = readFileSync(join(root, "src/ui/logo.tsx"), "utf8");

/** Every domain the logo catalogue asks a favicon service for. */
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
 * The rule this suite protects is not "marks must be large". It is "every
 * domain the app fetches has been measured, the app asks the service that
 * measured better, and nothing in the catalogue is a placeholder or another
 * brand's logo". Size is then whatever the brand actually publishes: a real
 * 16px World mark beats a grey tile at 48.
 */
describe("brand marks", () => {
  it("has a measurement on record for every domain it fetches", () => {
    const unmeasured = fetchedDomains().filter((domain) => BRAND_MARK_AUDIT[domain] == null);
    expect(unmeasured, "run scripts/audit-brand-marks.mjs").toEqual([]);
  });

  it("never keeps a domain whose only answer is a placeholder", () => {
    // Both services answer an unknown domain with a picture. Google's grey
    // globe is 16px and DuckDuckGo's grey letter tile is 48px — LARGER than
    // most genuine marks, so a size check alone would have promoted five of
    // them. The audit scores a placeholder as nothing; nothing may be stored.
    const placeholders = Object.entries(BRAND_MARK_AUDIT)
      .filter(([, mark]) => mark.px === 0 || PLACEHOLDER_MARK_SHA.includes(mark.sha as (typeof PLACEHOLDER_MARK_SHA)[number]))
      .map(([domain]) => domain);
    expect(placeholders).toEqual([]);
  });

  it("never draws one institution's logo for another", () => {
    // Two names resolving to one domain is fine when it is one institution
    // under two spellings ("yapi kredi" / "yapikredi"). Two DIFFERENT
    // institutions sharing a picture is not: `naysapp.com.tr` returned İş
    // Bankası's file byte for byte, so choosing Nays drew the bank.
    expect(fetchedDomains(), "naysapp.com.tr is İş Bankası's mark").not.toContain("naysapp.com.tr");

    // Byte-identical marks that ARE the same institution under two names.
    // Advantage is HSBC's card programme, BluTV became Max in Turkey, and
    // Microsoft 365 is Office. Anything else sharing bytes is a new borrow.
    const sameOwner = [
      ["advantage.com.tr", "hsbc.com.tr"],
      ["blutv.com", "max.com"],
      ["microsoft365.com", "office.com"],
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
    // Google returns 16px for TEB where DuckDuckGo has 48px of the real mark;
    // DuckDuckGo has nothing for Akbank where Google has 32px. No single
    // default is right, so the recorded winner is what gets asked.
    //
    // This is also what keeps the split honest. The app ships only the short
    // DuckDuckGo list, not the 180-row record it was drawn from, and the two
    // files can drift without either one looking wrong on its own — a refresh
    // of the record that nobody copies across would leave five brands quietly
    // fetching the smaller mark again.
    for (const [domain, mark] of Object.entries(BRAND_MARK_AUDIT)) {
      expect(markProvider(domain), domain).toBe(mark.provider);
      const host = mark.provider === "duckduckgo" ? "icons.duckduckgo.com" : "www.google.com";
      expect(new URL(remoteFaviconUrl(domain)!).hostname, domain).toBe(host);
    }
  });

  it("keeps the names it has no mark for on the record", () => {
    const listed = logoSource.slice(logoSource.indexOf("export const UNMARKED_INSTITUTIONS"));
    for (const name of ["denizbank", "turkiye finans", "tosla", "nays", "bip", "bisu", "millenicom"]) {
      expect(listed, `${name} must say why it has no mark`).toContain(`"${name}"`);
    }
  });
});
