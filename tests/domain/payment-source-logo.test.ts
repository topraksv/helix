/** Payment sources resolve their mark through `ui/logo.tsx` like subscriptions; the catalogue is read as text because logo.tsx imports react-native. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  catalogueKey,
  foldForMatch,
  normalizeLogoDomain,
  remoteFaviconUrl,
} from "../../src/domain/logo-domain";

const root = process.cwd();
const source = readFileSync(join(root, "src/ui/logo.tsx"), "utf8");

function tableBetween(from: string, to: string): Map<string, string> {
  const text = source.slice(source.indexOf(from), source.indexOf(to));
  const entries = [...text.matchAll(/^\s*"?([a-z0-9 +-]+)"?:\s*"([^"]+)",$/gm)];
  return new Map(entries.map((match) => [match[1]!, match[2]!]));
}

const banks = tableBetween("const BANK_DOMAIN", "/**\n * Names that belong to a real institution");
const brands = tableBetween("const BRAND_DOMAIN", "/**\n * Turkish banks, card programmes and wallets.");
/** Both tables as one, exactly as `CATALOGUE_DOMAIN` composes them. */
const catalogue = new Map([...brands, ...banks]);

/** The domain a name resolves to through the merged catalogue, as the app resolves it. */
function resolve(name: string): string | null {
  return catalogueKey(name, Object.fromEntries(catalogue));
}

describe("the bank and card catalogue", () => {
  it("parses two real tables, so a passing run means something", () => {
    // `src/domain/brand-marks.ts` records what each domain returns.
    expect(banks.size).toBeGreaterThanOrEqual(75);
    expect(brands.size).toBeGreaterThanOrEqual(100);
  });

  it("resolves every name the owner named", () => {
    // Verbatim from the request, in the spellings a person actually types.
    const asked: [string, string][] = [
      ["Yapı Kredi", "yapikredi.com.tr"],
      ["Yapıkredi", "yapikredi.com.tr"],
      ["Garanti Bankası", "garantibbva.com.tr"],
      ["Garanti BBVA", "garantibbva.com.tr"],
      ["İş Bankası", "isbank.com.tr"],
      ["Tami", "tami.com.tr"],
    ];
    for (const [name, domain] of asked) {
      expect(resolve(name), name).toBe(domain);
    }
  });

  /** Nays serves İş Bankası's file byte for byte, so it gets initials; Advantage shares HSBC's because it is HSBC's programme. */
  it("never lends one institution's mark to another", () => {
    expect(resolve("Nays")).toBeNull();
    expect(resolve("Nays kart")).not.toBe("isbank.com.tr");
    expect(resolve("Advantage")).toBe("advantage.com.tr");
  });

  /**
   * The names on a real card are sub-brands the catalogue does not list, and
   * the owner types them as one word as often as two. Every one of these
   * failed the exact, first-word and whole-word-mention passes; the prefix
   * pass is what answers them, and this is the list it must keep answering.
   */
  it("resolves the sub-brand names printed on real cards", () => {
    const cards: [string, string][] = [
      ["World Gold", "worldcard.com.tr"],
      ["WorldGold", "worldcard.com.tr"],
      ["WorldEko", "worldcard.com.tr"],
      ["Worldcard Platinum", "worldcard.com.tr"],
      ["Akbank Platinum", "akbank.com.tr"],
      // The issuer wins over the programme when a name carries both: longest
      // key first makes "Akbank" beat "Axess", and an Akbank card showing
      // Akbank is right. "Axess" alone still resolves to the programme.
      ["Akbank Axess", "akbank.com.tr"],
      ["Axess", "axess.com.tr"],
      ["Bonus Platinium", "bonus.com.tr"],
      ["Maximum Genç", "maximum.com.tr"],
      ["Garanti Shop&Fly", "garantibbva.com.tr"],
    ];
    for (const [name, domain] of cards) {
      expect(resolve(name), name).toBe(domain);
    }
  });

  it("resolves a card programme to its own mark, never to its bank's", () => {
    // People name the source after whichever they think of, and the two are
    // different pictures. Where the programme publishes a mark worth drawing
    // it is used; where it publishes only a 16px one (World) or a 44px one
    // (Bonus), the app draws its own — but never the bank's, which is the
    // guarantee this test has always been about.
    expect(resolve("Maximum")).toBe("maximum.com.tr");
    expect(resolve("Axess")).toBe("axess.com.tr");
    expect(resolve("World")).not.toBe("yapikredi.com.tr");
    expect(resolve("Bonus")).not.toBe("garantibbva.com.tr");
  });

  it("resolves a bank named inside a longer source name", () => {
    expect(resolve("Garanti kredi kartım")).toBe("garantibbva.com.tr");
    expect(resolve("Ziraat maaş hesabı")).toBe("ziraatbank.com.tr");
  });

  /**
   * The reason this pass exists at all.
   *
   * Turkish card sub-brands are written as one word, and every one of these
   * fails a whole-word match. They are the names the owner reported typing.
   */
  it("resolves a sub-brand written as one word with its programme", () => {
    const concatenated: [string, string][] = [
      ["Axessplus", "axess.com.tr"],
      ["Parafpara", "paraf.com.tr"],
      ["Maximumgenç", "maximum.com.tr"],
      ["Bankkartcombo", "bankkart.com.tr"],
      ["Ziraatkatılım", "ziraatkatilim.com.tr"],
    ];
    for (const [name, domain] of concatenated) {
      expect(resolve(name), name).toBe(domain);
    }
  });

  it("prefers the longer key when a name begins two of them", () => {
    // "Maximiles" starts with neither "maximum" nor "max", but it is its own
    // programme and must not be swallowed by either.
    expect(resolve("Maximiles")).toBe("maximiles.com.tr");
    expect(resolve("Maximiles Black")).toBe("maximiles.com.tr");
    expect(resolve("Getir Finans")).toBe("getirfinans.com");
    expect(resolve("Getir")).toBe("getir.com");
  });

  it("keeps short keys on the strict whole-word rule", () => {
    // Three- and four-letter keys are ordinary words. `max` begins "maximum" —
    // the collision the catalogue always had to get right.
    expect(resolve("Maximum")).toBe("maximum.com.tr");
    expect(resolve("İngiltere hesabı")).toBeNull();
    expect(resolve("Tebrik kartı")).toBeNull();
    expect(resolve("Bimcell")).toBeNull();
  });

  it("leaves an ordinary source unresolved, so it falls back to its type glyph", () => {
    for (const name of ["Nakit", "Ana Kart", "Cüzdan", "Ortak hesap"]) {
      expect(resolve(name), name).toBeNull();
    }
  });

  it("only lists domains the URL guard will actually accept", () => {
    for (const [key, domain] of catalogue) {
      expect(normalizeLogoDomain(domain), `${key} → ${domain}`).toBe(domain);
    }
  });

  it("writes every bank key folded, since the lookup folds before it reads", () => {
    for (const key of banks.keys()) {
      expect(foldForMatch(key), `${key} is not written folded`).toBe(key);
    }
  });

  /**
   * The favicon service answers an unknown domain with a 404 and a grey globe
   * in the body, which a browser's `<img>` renders and `expo-image` does not —
   * one name, two pictures. These four were checked against the service and
   * have no mark, so they are recorded as unmarked rather than requested.
   */
  it("does not ask for a mark that was checked and found missing", () => {
    const recorded = source.indexOf("UNMARKED INSTITUTIONS (checked, no mark published)");
    expect(recorded, "the record these names live in must still exist").toBeGreaterThan(0);
    const unmarked = source.slice(recorded);
    for (const name of ["denizbank", "turkiye finans", "emlak katilim", "tosla"]) {
      expect(unmarked, name).toContain(`"${name}"`);
      expect(resolve(name), name).toBeNull();
    }
  });
});

describe("mark resolution", () => {
  it("asks the favicon service for a mark large enough for the tile it fills", () => {
    // The tile reaches 46pt, which is 138 physical pixels at @3x, so a 128px
    // source was upscaled on every phone.
    const url = remoteFaviconUrl("yapikredi.com.tr");
    expect(url).toContain("sz=256");
    expect(url).toContain("domain=yapikredi.com.tr");
  });

  it("keeps the payment-source mark on the one shared component", () => {
    expect(source).toContain("export function PaymentSourceLogo");
    // It reuses `Logo` rather than reimplementing the resolution beside it.
    const component = source.slice(source.indexOf("export function PaymentSourceLogo"));
    expect(component).toContain("<Logo");
    // An unresolved source shows what KIND of thing it is, not two letters.
    expect(component).toContain("fallback={paymentSourceIconComponent(type)}");
  });

  it("consults one merged catalogue rather than one table then the other", () => {
    expect(source).toContain("const CATALOGUE_DOMAIN");
    expect(source).toContain("catalogueKey(name, CATALOGUE_DOMAIN)");
  });
});

describe("catalogueKey", () => {
  const table = {
    "netflix": "N",
    "youtube": "Y",
    "youtube music": "YM",
    "max": "MAX",
    "abc": "ABC",
    "ab": "AB",
    "world": "W",
    "worldcard": "WC",
    "bonus": "B",
    "bonu": "BONU",
  };

  it("matches the whole folded name first, then its first word", () => {
    expect(catalogueKey("  YouTube Music ", table)).toBe("YM");
    expect(catalogueKey("Netflix aile", table)).toBe("N");
    expect(catalogueKey("Youtube premium", table)).toBe("Y");
  });

  it("then a key mentioned as a whole word, the longest one, at three characters or more", () => {
    expect(catalogueKey("Ailem için Netflix", table)).toBe("N");
    expect(catalogueKey("Aile youtube music", table)).toBe("YM");
    expect(catalogueKey("Kart abc", table)).toBe("ABC");
    expect(catalogueKey("Kart ab", table)).toBeNull();
    expect(catalogueKey("Maximum", table)).toBeNull();
  });

  it("then a key of at least MIN_PREFIX_MATCH characters that begins a word, the longest one", () => {
    expect(catalogueKey("Worldeko", table)).toBe("W");
    expect(catalogueKey("Kart worldcardplus", table)).toBe("WC");
    expect(catalogueKey("Bonusplatinium", table)).toBe("B");
    expect(catalogueKey("Bonuxyz", table)).toBeNull();
    expect(catalogueKey("Kart xworldeko", table)).toBeNull();
  });

  it("finds nothing in an empty catalogue or for an empty name", () => {
    expect(catalogueKey("Netflix", {})).toBeNull();
    expect(catalogueKey("", table)).toBeNull();
  });
});
