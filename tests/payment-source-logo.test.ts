/**
 * A payment source is marked the same way a subscription is.
 *
 * The owner's rule is that every logo in this product resolves and is drawn by
 * one mechanism. Payment sources used to get a generic type glyph — a card
 * outline for Yapı Kredi, Garanti and İş Bankası alike — while subscriptions
 * next to them showed the real mark. Both now go through `ui/logo.tsx`.
 *
 * The catalogue itself is read from source rather than imported: `logo.tsx`
 * pulls in react-native and expo-image, which this suite cannot load. What
 * matters is that the names the owner listed actually resolve, and that the
 * domains they resolve to are ones `normalizeLogoDomain` will accept — both of
 * which the text answers exactly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_PREFIX_MATCH,
  foldForMatch,
  nameMentions,
  nameStartsWord,
  normalizeLogoDomain,
  remoteFaviconUrl,
} from "../src/domain/logo-domain";

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

/** The same four steps `catalogueKey` takes, so the test resolves as the app does. */
function resolve(name: string, table: Map<string, string> = catalogue): string | null {
  const key = foldForMatch(name);
  if (table.has(key)) return table.get(key)!;
  const firstWord = key.split(/\s+/)[0];
  if (firstWord && table.has(firstWord)) return table.get(firstWord)!;
  const keys = [...table.keys()];
  const longestFirst = (a: string, b: string) => b.length - a.length;
  const mentioned = keys
    .filter((entry) => entry.length >= 3 && nameMentions(name, entry))
    .sort(longestFirst)[0];
  if (mentioned) return table.get(mentioned)!;
  const prefixed = keys
    .filter((entry) => entry.length >= MIN_PREFIX_MATCH && nameStartsWord(name, entry))
    .sort(longestFirst)[0];
  return prefixed ? table.get(prefixed)! : null;
}

describe("the bank and card catalogue", () => {
  it("parses two real tables, so a passing run means something", () => {
    // Both tables shrank when every mark in them was measured: sixty names
    // pointed at a 16-44px favicon that the app was blowing up into a tile of
    // up to 144 device pixels. See `tests/brand-domains.test.ts` for the rule
    // and `src/ui/brand-marks.ts` for what each domain actually returns.
    expect(banks.size).toBeGreaterThanOrEqual(35);
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

  /**
   * Nays is İş Bankası's app, and `naysapp.com.tr` answers the favicon service
   * with İş Bankası's own file — the same 921 bytes, byte for byte. Drawing it
   * meant a person who picked Nays saw the bank's logo, which is a different
   * institution's mark on their card. No Nays mark is published anywhere the
   * service has indexed (`nays.com.tr` returns the not-indexed grey globe), so
   * the honest answer is its own initials rather than someone else's logo.
   */
  it("never lends one institution's mark to another", () => {
    expect(resolve("Nays")).toBeNull();
    expect(resolve("Nays kart")).not.toBe("isbank.com.tr");
    // Advantage is HSBC's programme and its favicon is HSBC's file exactly.
    expect(resolve("Advantage")).toBeNull();
    expect(resolve("Advantage")).not.toBe("hsbc.com.tr");
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
    const unmarked = source.slice(source.indexOf("export const UNMARKED_INSTITUTIONS"));
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

describe("word-prefix matching", () => {
  it("matches a word's own beginning and never mid-word", () => {
    expect(nameStartsWord("Worldeko", "world")).toBe(true);
    expect(nameStartsWord("eko world", "world")).toBe(true);
    expect(nameStartsWord("Yapıkredi", "kredi")).toBe(false);
    expect(nameStartsWord("", "world")).toBe(false);
    expect(nameStartsWord("Worldeko", "")).toBe(false);
  });

  it("keeps looking past a mid-word hit rather than giving up on it", () => {
    // "kredi" appears inside "yapikredi" first and as its own word second.
    expect(nameStartsWord("Yapıkredi kredi kartı", "kredi")).toBe(true);
  });

  it("folds Turkish letters on both sides, as every other match here does", () => {
    expect(nameStartsWord("İŞBANKASI kartım", "isbank")).toBe(true);
    expect(nameStartsWord("Bonusflaş", "BONUS")).toBe(true);
  });
});
