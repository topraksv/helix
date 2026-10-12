import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
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
      expect(markProvider(domain), domain).toBe(mark.provider);
      const host = { duckduckgo: "icons.duckduckgo.com", iconhorse: "icon.horse", google: "www.google.com" }[mark.provider];
      expect(new URL(remoteFaviconUrl(domain)!).hostname, domain).toBe(host);
    }
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

/** `brand.tsx` derives width from a constant ratio, which holds only while the canvas is the artwork: the ink must touch all four edges. */
describe("the app's own brand mark", () => {
  /** Bounding box of pixels the artwork actually paints. */
  function inkBounds(file: string): { width: number; height: number; left: number; top: number; right: number; bottom: number } {
    const buf = readFileSync(join(root, file));
    let at = 8;
    let width = 0;
    let height = 0;
    let depth = 0;
    let colorType = 0;
    const parts: Buffer[] = [];
    while (at < buf.length) {
      const length = buf.readUInt32BE(at);
      const type = buf.toString("latin1", at + 4, at + 8);
      const data = buf.subarray(at + 8, at + 8 + length);
      if (type === "IHDR") {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        depth = data[8]!;
        colorType = data[9]!;
      }
      if (type === "IDAT") parts.push(Buffer.from(data));
      at += 12 + length;
    }
    // 8-bit RGBA is what the un-filtering below assumes; anything else would be
    // measured wrongly rather than reported as unmeasurable.
    expect({ depth, colorType }, `${file} must be 8-bit RGBA`).toEqual({ depth: 8, colorType: 6 });
    const raw = inflateSync(Buffer.concat(parts));
    const stride = width * 4;
    const pixels = Buffer.alloc(height * stride);
    let read = 0;
    for (let y = 0; y < height; y += 1) {
      const filter = raw[read];
      read += 1;
      for (let x = 0; x < stride; x += 1) {
        const left = x >= 4 ? pixels[y * stride + x - 4]! : 0;
        const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
        const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4]! : 0;
        let value = raw[read + x]!;
        if (filter === 1) value += left;
        else if (filter === 2) value += up;
        else if (filter === 3) value += (left + up) >> 1;
        else if (filter === 4) {
          const estimate = left + up - upLeft;
          const dl = Math.abs(estimate - left);
          const du = Math.abs(estimate - up);
          const dul = Math.abs(estimate - upLeft);
          value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
        }
        pixels[y * stride + x] = value & 0xff;
      }
      read += stride;
    }
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[y * stride + x * 4 + 3]! > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { width, height, left: minX, top: minY, right: width - 1 - maxX, bottom: height - 1 - maxY };
  }

  for (const file of ["assets/brand/symbol-light-t.png", "assets/brand/symbol-dark-t.png"]) {
    it(`leaves no transparent margin around ${file.split("/").pop()}`, () => {
      const bounds = inkBounds(file);
      expect(
        { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
        "the canvas must BE the mark, or `size` stops meaning the height it draws",
      ).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    });
  }

  it("renders the splash symbol, and sizes the drawn mark, at the drawing's own ratio", async () => {
    const bounds = inkBounds("assets/brand/symbol-light-t.png");
    const { VIEW_BOX } = await import("../../src/ui/brand-art");
    const [, , width, height] = VIEW_BOX.split(" ").map(Number);
    expect(readFileSync(join(root, "src/ui/brand.tsx"), "utf8")).toContain(`const MARK_ASPECT = ${width} / ${height};`);
    expect(bounds.width / bounds.height).toBeCloseTo(width! / height!, 2);
  });
});
