/**
 * Brand mark for a subscription, derived from its NAME alone and rendered
 * locally when no known public domain resolves. Known or previously stored
 * public domains may load a cached favicon automatically; failures remain local:
 *   utility keyword  → themed lucide icon chip (electricity, water, internet…)
 *   known brand      → a chip in the brand's accent colour with its monogram
 *   otherwise        → deterministic-hue initials badge
 * Brand accent colours are facts, not logo artwork, so nothing is bundled and
 * no trademarked bitmap is reproduced.
 */

import React, { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import Building2 from "lucide-react-native/icons/building-2";
import Car from "lucide-react-native/icons/car";
import Droplets from "lucide-react-native/icons/droplets";
import Dumbbell from "lucide-react-native/icons/dumbbell";
import Flame from "lucide-react-native/icons/flame";
import GraduationCap from "lucide-react-native/icons/graduation-cap";
import Phone from "lucide-react-native/icons/phone";
import Shield from "lucide-react-native/icons/shield";
import Trash2 from "lucide-react-native/icons/trash-2";
import Wifi from "lucide-react-native/icons/wifi";
import Zap from "lucide-react-native/icons/zap";
import type { LucideIcon } from "lucide-react-native";
import { InitialsBadge } from "./components";
import { paymentSourceIconComponent } from "./category-icon";
import type { PaymentSourceType } from "../domain/types";
import { font, useTheme } from "./theme";
import { BRAND, brandPlate } from "./brand-colors";
import { MIN_PREFIX_MATCH, foldForMatch, nameMentions, nameStartsWord, normalizeLogoDomain, remoteFaviconUrl } from "../domain/logo-domain";

/** One shared frameless tile: near-square, rounded, no border — every variant
 *  (favicon, utility icon, brand chip, initials) renders in this exact shape
 *  so mixed lists stay visually uniform on web and iOS alike. */
function tileStyle(size: number) {
  return {
    width: size,
    height: size,
    borderRadius: size / 3,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  };
}

/**
 * How much of the tile a remote favicon fills.
 *
 * Favicons are not a uniform set: some are full-bleed app icons that reach
 * every edge (iCloud), others a centred mark on transparency (YouTube). The
 * mismatch people actually see is the FILL RATIO, not the colour behind it —
 * so every mark is inset to the same fraction and the tile itself paints
 * nothing. A plate cannot win here: the theme surface turned a transparent
 * margin into a dark band, and a constant white one put a hard white square
 * behind every logo in dark mode. Painting nothing removes the box that was
 * being unevenly filled in the first place.
 */
const FAVICON_FILL = 0.82;

/** Utility/service keywords → icon + accent (checked before brand lookup). */
/**
 * The things people subscribe to that are not brands.
 *
 * Patterns are matched against the FOLDED name (`foldForMatch`), so they are
 * written in plain lowercase ASCII and still match "İnternet", "Doğalgaz" and
 * "İSKİ". Any mention is enough: "internet aboneliği", "Ev interneti" and
 * "İNTERNET" all resolve to the same icon, which is what the owner asked for.
 */
const UTILITY_ICONS: { match: RegExp; icon: LucideIcon; color: string }[] = [
  { match: /elektrik|enerji|bedas|ayedas|enerjisa|ck enerji|aydem|uedas/, icon: Zap, color: "#eda100" },
  { match: /\bsu\b|sular|iski|aski|baski|izsu|buski|mueski|musku/, icon: Droplets, color: "#2a78d6" },
  { match: /dogalgaz|\bgaz\b|igdas|izmirgaz|baskentgaz|bursagaz|aksa gaz|palgaz/, icon: Flame, color: "#eb6834" },
  { match: /internet|fiber|adsl|wifi|superonline|turknet|millenicom|vodafone net|d-smart net/, icon: Wifi, color: "#4a3aa7" },
  { match: /telefon|gsm|\bhat\b|mobil hat|faturali hat/, icon: Phone, color: "#1baf7a" },
  { match: /aidat|\bsite\b|apartman|yonetim/, icon: Building2, color: "#5d6579" },
  { match: /sigorta|kasko|dask|bes\b|emeklilik/, icon: Shield, color: "#008300" },
  { match: /okul|kurs|egitim|universite|yurt\b/, icon: GraduationCap, color: "#d55181" },
  { match: /spor|fitness|gym|salon|pilates|yoga/, icon: Dumbbell, color: "#e34948" },
  { match: /arac|otopark|hgs|ogs|kiralama|servis ucreti/, icon: Car, color: "#2a78d6" },
  { match: /cop|belediye|temizlik/, icon: Trash2, color: "#5d6579" },
];

/**
 * Known brand → website domain, so we can fetch the real favicon. Only generic
 * brand domains are ever requested (never the user's own data), and a failed
 * fetch falls back to the local chip — so nothing breaks offline.
 */
const BRAND_DOMAIN: Record<string, string> = {
  netflix: "netflix.com",
  spotify: "spotify.com",
  youtube: "youtube.com",
  disney: "disneyplus.com",
  "disney+": "disneyplus.com",
  amazon: "amazon.com",
  prime: "primevideo.com",
  "prime video": "primevideo.com",
  "amazon prime": "primevideo.com",
  hbo: "max.com",
  "hbo max": "max.com",
  max: "max.com",
  "apple music": "music.apple.com",
  "apple tv": "tv.apple.com",
  "apple tv+": "tv.apple.com",
  icloud: "icloud.com",
  chatgpt: "openai.com",
  openai: "openai.com",
  steam: "steampowered.com",
  playstation: "playstation.com",
  "playstation plus": "playstation.com",
  xbox: "xbox.com",
  "xbox game pass": "xbox.com",
  nintendo: "nintendo.com",
  notion: "notion.so",
  adobe: "adobe.com",
  canva: "canva.com",
  linkedin: "linkedin.com",
  "linkedin premium": "linkedin.com",
  patreon: "patreon.com",
  audible: "audible.com",
  duolingo: "duolingo.com",
  deezer: "deezer.com",
  tidal: "tidal.com",
  blutv: "blutv.com",
  exxen: "exxen.com",
  tabii: "tabii.com",
  gain: "gain.tv",
  storytel: "storytel.com",
  todtv: "todtv.com.tr",
  tod: "todtv.com.tr",
  claude: "claude.ai",
  anthropic: "anthropic.com",
  gemini: "gemini.google.com",
  perplexity: "perplexity.ai",
  midjourney: "midjourney.com",
  cursor: "cursor.com",
  microsoft: "microsoft.com",
  "microsoft 365": "microsoft365.com",
  office: "office.com",
  onedrive: "microsoft365.com",
  google: "google.com",
  apple: "apple.com",
  discord: "discord.com",
  "discord nitro": "discord.com",
  telegram: "telegram.org",
  figma: "figma.com",
  todoist: "todoist.com",
  "1password": "1password.com",
  bitwarden: "bitwarden.com",
  nordvpn: "nordvpn.com",
  expressvpn: "expressvpn.com",
  surfshark: "surfshark.com",
  crunchyroll: "crunchyroll.com",
  mubi: "mubi.com",
  paramount: "paramountplus.com",
  "paramount+": "paramountplus.com",
  bein: "beinconnect.com.tr",
  "bein connect": "beinconnect.com.tr",
  "s sport": "ssportplus.com",
  "s sport plus": "ssportplus.com",
  "tv+": "tvplus.com.tr",
  "tv plus": "tvplus.com.tr",
  fizy: "fizy.com",
  muud: "muud.com.tr",
  soundcloud: "soundcloud.com",
  strava: "strava.com",
  macfit: "macfit.com.tr",
  nike: "nike.com",
  medium: "medium.com",
  scribd: "scribd.com",
  roblox: "roblox.com",
  "epic games": "epicgames.com",
  epic: "epicgames.com",
  ubisoft: "ubisoft.com",
  tinder: "tinder.com",
  bumble: "bumble.com",
  trendyol: "trendyol.com",
  getir: "getir.com",
  yemeksepeti: "yemeksepeti.com",
  "puhutv": "puhutv.com",
  "tivibu": "tivibu.com.tr",
  "turknet": "turk.net",
  "migros": "migros.com.tr",
  "a101": "a101.com.tr",
  "carrefoursa": "carrefoursa.com",
  "bim": "bim.com.tr",
  "papara": "papara.com",
  "spotify premium": "spotify.com",
  "apple one": "apple.com",
  "apple arcade": "apple.com",
  "coursera": "coursera.org",
  "udemy": "udemy.com",
  "skillshare": "skillshare.com",
  "grammarly": "grammarly.com",
  "trello": "trello.com",
  "atlassian": "atlassian.com",
  "vercel": "vercel.com",
  "cloudflare": "cloudflare.com",
  "substack": "substack.com",
  "calm": "calm.com",
  "proton": "proton.me",
  "protonmail": "proton.me",
  "mega": "mega.nz",
  "lastpass": "lastpass.com",
  "norton": "norton.com",
  "malwarebytes": "malwarebytes.com",
  "wetransfer": "wetransfer.com",
  "kindle": "amazon.com",
  "shazam": "shazam.com",
  "pinterest": "pinterest.com",
  "meta": "meta.com",
  "instagram": "instagram.com",
  "uber": "uber.com",
  "bolt": "bolt.eu",
  "booking": "booking.com",
};


/**
 * Turkish banks, card programmes and wallets that publish a mark worth drawing.
 *
 * Same table and same resolution as the subscription brands above, because a
 * mark is a mark: a payment source called "Garanti" and a subscription called
 * "Garanti" should not be drawn by two different mechanisms.
 *
 * Keys are written FOLDED (plain lowercase ASCII, no Turkish diacritics),
 * because `catalogueKey` folds the name before it looks anything up. "Yapı
 * Kredi" arrives here as "yapi kredi".
 *
 * MEASURED, not assumed. Every domain below was fetched and its mark's real
 * pixel size read from the image header; `BRAND_MARK_AUDIT` records what came
 * back and `tests/brand-domains.test.ts` holds the two rules that follow from
 * it. Two things were wrong and are the reason the audit exists:
 *
 *   - Twenty-seven names pointed at a mark of 16-44px. The app draws these in
 *     a 36-48pt tile, which is up to 144 device pixels at 3x, so a 16px source
 *     was being blown up nine times: a smear of colour where a logo should be.
 *     A crisp local mark is a better picture than a ruined bitmap, so anything
 *     under `MIN_MARK_PX` is not fetched at all.
 *   - Two names drew ANOTHER brand's logo, byte for byte. "Nays" resolved to
 *     `naysapp.com.tr`, whose favicon is the same 921 bytes as
 *     `isbank.com.tr`; "Advantage" resolved to a file identical to HSBC's. A
 *     payment method has to be recognisable as itself, so a borrowed mark is
 *     no mark.
 */
const BANK_DOMAIN: Record<string, string> = {
  // Deposit banks
  "yapi kredi": "yapikredi.com.tr",
  yapikredi: "yapikredi.com.tr",
  garanti: "garantibbva.com.tr",
  "garanti bbva": "garantibbva.com.tr",
  "is bankasi": "isbank.com.tr",
  isbank: "isbank.com.tr",
  isbankasi: "isbank.com.tr",
  ziraat: "ziraatbank.com.tr",
  "ziraat bankasi": "ziraatbank.com.tr",
  halkbank: "halkbank.com.tr",
  hsbc: "hsbc.com.tr",
  fibabanka: "fibabanka.com.tr",
  "alternatif bank": "alternatifbank.com.tr",
  alternatifbank: "alternatifbank.com.tr",
  burgan: "burgan.com.tr",
  aktifbank: "aktifbank.com.tr",
  "aktif bank": "aktifbank.com.tr",
  // Participation banks
  albaraka: "albaraka.com.tr",
  "ziraat katilim": "ziraatkatilim.com.tr",
  ziraatkatilim: "ziraatkatilim.com.tr",
  "vakif katilim": "vakifkatilim.com.tr",
  vakifkatilim: "vakifkatilim.com.tr",
  // Card programmes.
  //
  // Listed beside their bank because people name the source after whichever
  // one they think of — "Bonus" and "Garanti" are the same plastic — and
  // because the programme has its own mark, which is the one printed on the
  // card in the drawer.
  maximum: "maximum.com.tr",
  maximiles: "maximiles.com.tr",
  axess: "axess.com.tr",
  wings: "wings.com.tr",
  paraf: "paraf.com.tr",
  cardfinans: "cardfinans.com.tr",
  "card finans": "cardfinans.com.tr",
  bankkart: "bankkart.com.tr",
  "bank kart": "bankkart.com.tr",
  // Digital banks, wallets and payment institutions
  "n kolay": "nkolay.com.tr",
  nkolay: "nkolay.com.tr",
  papara: "papara.com",
  paycell: "paycell.com.tr",
  colendi: "colendi.com",
  "getir finans": "getirfinans.com",
  getirfinans: "getirfinans.com",
  sipay: "sipay.com.tr",
  iyzico: "iyzico.com",
  moka: "moka.com",
  paratika: "paratika.com.tr",
  "bkm express": "bkmexpress.com.tr",
  bkmexpress: "bkmexpress.com.tr",
  // Garanti Ödeme ve Elektronik Para Hizmetleri A.Ş. — verified, and NOT
  // Ziraat's, which is the easy mistake to make with a bank-adjacent brand.
  tami: "tami.com.tr",
  // Türkiye İş Bankası's app. The favicon service answers this domain with the
  // bank's own mark, byte for byte, which is the right picture either way.
  // Card networks, for a source someone names after the scheme. `troy.com.tr`
  // is a promotional-gifts company, not the payment scheme — checked, because
  // the name makes it the obvious wrong guess.
  visa: "visa.com.tr",
  mastercard: "mastercard.com.tr",
  troy: "troyodeme.com",
};

/**
 * Names that belong to a real institution but have no mark worth drawing.
 *
 * Two reasons, both measured (see `brand-marks.ts`):
 *
 *   - NOT INDEXED. The favicon service answers an unknown domain with HTTP 404
 *     and a grey globe in the body. `expo-image` treats the status as an error
 *     and falls back, but a browser's `<img>` renders any valid image body
 *     whatever the status says — so these drew a globe on web and the type
 *     glyph on iOS, which is both a wrong picture and two different ones.
 *     DenizBank, Türkiye Finans, Emlak Katılım and Tosla publish nothing the
 *     service has indexed.
 *   - TOO SMALL TO DRAW. Twenty-seven names resolved to a mark of 16-44px,
 *     which the app then blew up into a 36-48pt tile — up to nine times its
 *     real size. Akbank (32), VakıfBank (16), QNB (16), TEB (16), ING (33),
 *     Şekerbank (16), Kuveyt Türk (32), World (16), Bonus (44), BKM (16),
 *     ininal (32), Param (32) and the rest are listed here rather than fetched.
 *     Alternate hosts were checked for each of them — `akbank.com`,
 *     `qnbfinansbank.com`, `teb.com`, `ingbank.com.tr`, `kuveytturk.com`,
 *     `world.com.tr`, `bonuscard.com.tr`, `paramtr.com` — and none publishes a
 *     larger mark; several are not indexed at all.
 *
 * A name here falls back to the app's own mark: initials for a subscription,
 * whose name IS its identity, and the payment type's glyph for a source, where
 * "Nakit" and "Ana Kart" are kinds of thing rather than brands. Both are drawn
 * from the palette at the exact tile size, so they are sharp at any density —
 * which a 16px bitmap in a 144px box is not.
 *
 * Nays and Advantage are here for a third reason: their marks are byte-for-byte
 * copies of İş Bankası's and HSBC's. A payment method that draws another
 * institution's logo is worse than one that draws none.
 */
export const UNMARKED_INSTITUTIONS = [
  // Not indexed at all.
  "denizbank",
  "turkiye finans",
  "emlak katilim",
  "tosla",
  // Indexed, but too small to draw.
  "akbank",
  "vakifbank",
  "qnb",
  "finansbank",
  "teb",
  "ing",
  "sekerbank",
  "odeabank",
  "anadolubank",
  "adabank",
  "turkishbank",
  "turklandbank",
  "icbc",
  "kuveyt turk",
  "world",
  "worldcard",
  "bonus",
  "ininal",
  "param",
  "bkm",
  // Indexed, high resolution, and the wrong institution's logo.
  "nays",
  "advantage",
  // Subscriptions whose site publishes only a 16-35px mark. Same measurement,
  // same rule: the app's own brand chip or utility glyph is drawn at the exact
  // tile size and stays sharp at any density, which an upscaled favicon does
  // not. Twitch, X, GitHub and Google One keep their accent chips from
  // `BRAND`; the rest fall back to a utility icon or their initials.
  "bip",
  "bisu",
  "blinkist",
  "digiturk",
  "d-smart",
  "dsmart",
  "dropbox",
  "ea play",
  "enpara",
  "evernote",
  "github",
  "google drive",
  "google one",
  "headspace",
  "hepsiburada",
  "ininal",
  "kaspersky",
  "marti",
  "millenicom",
  "podimo",
  "slack",
  "sok",
  "superonline",
  "turkcell",
  "turk telekom",
  "twitch",
  "twitter",
  "vodafone",
  "whatsapp",
  "x",
  "zoom",
] as const;

/** Resolve the domain to fetch a favicon from (explicit override or a brand). */
/**
 * The catalogue entry a name refers to.
 *
 * Whole name, then first word, then any brand mentioned as a whole word inside
 * it — "Ailem için Netflix" is a Netflix subscription, and "maximum" is not
 * Max. Longest key first, so "youtube music" wins over "youtube".
 */
function catalogueKey<T>(name: string, table: Record<string, T>): T | null {
  const key = foldForMatch(name);
  if (table[key] != null) return table[key]!;
  const firstWord = key.split(/\s+/)[0];
  if (firstWord && table[firstWord] != null) return table[firstWord]!;
  const keys = Object.keys(table);
  const longestFirst = (a: string, b: string) => b.length - a.length;
  const mentioned = keys
    .filter((entry) => entry.length >= 3 && nameMentions(name, entry))
    .sort(longestFirst)[0];
  if (mentioned != null) return table[mentioned]!;
  // Last, and only for keys long enough to be a brand rather than a fragment:
  // the concatenated sub-brand. "Worldeko", "Worldgold" and "bonusplatinium"
  // are cards people really hold, and every one of them fails all three passes
  // above. Longest key first here too, so a name that begins two keys resolves
  // to the more specific one.
  const prefixed = keys
    .filter((entry) => entry.length >= MIN_PREFIX_MATCH && nameStartsWord(name, entry))
    .sort(longestFirst)[0];
  return prefixed != null ? table[prefixed]! : null;
}

/**
 * Both catalogues as one, so the MORE SPECIFIC key wins rather than whichever
 * table was consulted first.
 *
 * Asking the brands first and the banks second is a rule about tables, not
 * about names: "Getir Finans" is a bank, and it mentions "getir" as a whole
 * word, so the grocery app's mark was returned before the bank table was ever
 * read. `catalogueKey` already prefers the longest matching key; giving it
 * everything at once is what lets that preference do its job. The bank entry
 * wins an exact collision, which is the right way round for a payment source
 * and identical in value for the two keys the tables share.
 */
const CATALOGUE_DOMAIN: Record<string, string> = { ...BRAND_DOMAIN, ...BANK_DOMAIN };

function domainFor(name: string, override?: string | null): string | null {
  const normalizedOverride = normalizeLogoDomain(override);
  if (normalizedOverride) return normalizedOverride;
  return catalogueKey(name, CATALOGUE_DOMAIN);
}

export function Logo({
  name,
  domain,
  size = 36,
  fallback: FallbackIcon,
}: {
  name: string;
  domain?: string | null;
  size?: number;
  /**
   * Drawn instead of the initials badge when no mark resolves.
   *
   * A subscription with an unknown name is best served by its initials — the
   * name IS the identity. A payment source is not: "Nakit" and "Ana Kart" are
   * kinds of thing, and their type already says which, so the type's own glyph
   * carries more than two letters would.
   */
  fallback?: LucideIcon;
}) {
  const { palette } = useTheme();
  const [failedDomain, setFailedDomain] = useState<string | null>(null);

  const folded = foldForMatch(name);
  const brand = catalogueKey(name, BRAND);
  // A brand wins over a utility word: "Vodafone" is a brand chip even though
  // its name mentions a phone line, and "Netflix" is not a "site" aidatı.
  const utility = brand ? undefined : UTILITY_ICONS.find((u) => u.match.test(folded));
  // A utility (electricity/water/…) keeps its themed icon; other known public
  // domains load transparently and fall back locally on any network error.
  const faviconDomain = utility ? null : domainFor(name, domain);
  const faviconUrl = remoteFaviconUrl(faviconDomain);

  if (faviconDomain && faviconUrl && failedDomain !== faviconDomain) {
    return (
      // Hidden on the tile, not on the image: `expo-image` renders its own web
      // `<img>` and forwards only `alt`, `src` and `style`, so accessibility
      // props handed to it never reach the DOM. The row already names the
      // subscription, and this favicon repeats nothing.
      <View
        aria-hidden
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={tileStyle(size)}
      >
        <Image
          alt=""
          source={{ uri: faviconUrl }}
          onError={() => setFailedDomain(faviconDomain)}
          style={{ width: Math.round(size * FAVICON_FILL), height: Math.round(size * FAVICON_FILL) }}
          // `contain`, never `cover`: a favicon that is not square must fit
          // whole rather than lose part of the mark to a crop.
          contentFit="contain"
          cachePolicy="disk"
        />
      </View>
    );
  }

  if (utility) {
    const IconCmp = utility.icon;
    return (
      <View style={[tileStyle(size), { backgroundColor: utility.color + "22" }]}>
        <IconCmp accessible={false} size={size * 0.55} color={utility.color} strokeWidth={2} />
      </View>
    );
  }

  if (brand) {
    const { plate, ink } = brandPlate(brand.color);
    const mark = brand.mark || name.trim().slice(0, 1).toLocaleUpperCase("tr-TR");
    const plateSize = Math.round(size * 0.62);
    return (
      <View style={[tileStyle(size), { backgroundColor: brand.color }]}>
        <View
          style={{
            width: plateSize,
            height: plateSize,
            borderRadius: plateSize / 2,
            backgroundColor: plate,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: ink, fontSize: size * (mark.length > 2 ? 0.26 : 0.34), fontFamily: font.bold }}>
            {mark}
          </Text>
        </View>
      </View>
    );
  }

  if (FallbackIcon) {
    return (
      <View accessible={false} style={[tileStyle(size), { backgroundColor: palette.primarySoft }]}>
        <FallbackIcon accessible={false} size={Math.round(size * 0.46)} color={palette.accentText} strokeWidth={1.9} />
      </View>
    );
  }

  return <InitialsBadge name={name} size={size} />;
}

/**
 * The mark for a payment source, resolved exactly like a subscription's.
 *
 * `logoRef` is the manual override the schema already carries; when it holds a
 * domain it wins, otherwise the name is looked up in the shared catalogue. A
 * source that resolves to neither falls back to its TYPE glyph rather than to
 * initials — see `fallback` above.
 */
export function PaymentSourceLogo({
  name,
  type,
  logoRef,
  size = 36,
}: {
  name: string;
  type: PaymentSourceType;
  logoRef?: string | null;
  size?: number;
}) {
  return (
    <Logo
      name={name}
      domain={logoRef}
      size={size}
      fallback={paymentSourceIconComponent(type)}
    />
  );
}
