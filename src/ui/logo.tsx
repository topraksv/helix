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

import { useState } from "react";
import { PixelRatio, Text, View } from "react-native";
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
import { SMALL_MARK_PX } from "../domain/brand-marks";
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

/**
 * How far a mark may be enlarged past its own resolution.
 *
 * Thirty-one of the 180 domains in the catalogue publish a mark smaller than
 * the tile it is drawn in, and nineteen of those publish only 16px. That is
 * not a service picking badly: `worldcard.com.tr` and `vakifbank.com.tr` serve
 * a single 16x16 entry inside their `.ico`, `turktelekom.com.tr` serves a 16px
 * PNG, and none of them links an apple-touch-icon or a manifest icon. Three
 * independent services were asked; none has anything larger, and there is no
 * free logo API left that does.
 *
 * So the softness the owner reported is ours. Painting a 16px source across a
 * 44pt tile on a 3x screen is an eightfold enlargement, which is a smear. This
 * caps it at three, which is the point where a mark still reads as its own
 * shape. A 16px logo then draws at about 16pt inside a 44pt tile: smaller than
 * its neighbours, and sharp. A small sharp logo is a better picture of a brand
 * than a large soft one, and the alternative — dropping the brand for its
 * initials — is the one the owner already rejected.
 *
 * Marks at or above the tile's own resolution are untouched, which is 149 of
 * the 180.
 */
const MAX_MARK_UPSCALE = 3;

/**
 * The floor a capped mark cannot go under, as a fraction of the tile.
 *
 * Sharpness is not worth a logo nobody can identify. At 0.45 a 16px mark on a
 * 3x phone lands at about 20pt in a 44pt tile — a 3.7x enlargement rather than
 * the 6.8x it was, and still unmistakably the brand.
 */
const MIN_MARK_FILL = 0.45;

/** How large this domain's mark may be drawn in a tile of `size`. */
function markFill(domain: string | null, size: number): number {
  const full = Math.round(size * FAVICON_FILL);
  const real = domain ? SMALL_MARK_PX[domain] : undefined;
  if (real == null) return full;
  const sharp = (real * MAX_MARK_UPSCALE) / PixelRatio.get();
  return Math.round(Math.max(Math.min(full, sharp), size * MIN_MARK_FILL));
}

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
  twitter: "x.com",
  x: "x.com",
  "google one": "one.google.com",
  twitch: "twitch.tv",
  steam: "steampowered.com",
  playstation: "playstation.com",
  "playstation plus": "playstation.com",
  xbox: "xbox.com",
  "xbox game pass": "xbox.com",
  nintendo: "nintendo.com",
  github: "github.com",
  "github copilot": "github.com",
  notion: "notion.so",
  dropbox: "dropbox.com",
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
  "google drive": "drive.google.com",
  apple: "apple.com",
  discord: "discord.com",
  "discord nitro": "discord.com",
  telegram: "telegram.org",
  zoom: "zoom.us",
  slack: "slack.com",
  figma: "figma.com",
  evernote: "evernote.com",
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
  podimo: "podimo.com",
  turkcell: "turkcell.com.tr",
  vodafone: "vodafone.com.tr",
  "turk telekom": "turktelekom.com.tr",
  turktelekom: "turktelekom.com.tr",
  strava: "strava.com",
  macfit: "macfit.com.tr",
  nike: "nike.com",
  medium: "medium.com",
  scribd: "scribd.com",
  blinkist: "blinkist.com",
  roblox: "roblox.com",
  "epic games": "epicgames.com",
  epic: "epicgames.com",
  ubisoft: "ubisoft.com",
  "ea play": "ea.com",
  tinder: "tinder.com",
  bumble: "bumble.com",
  trendyol: "trendyol.com",
  hepsiburada: "hepsiburada.com",
  getir: "getir.com",
  yemeksepeti: "yemeksepeti.com",
  "puhutv": "puhutv.com",
  "d-smart": "dsmart.com.tr",
  "dsmart": "dsmart.com.tr",
  "digiturk": "digiturk.com.tr",
  "tivibu": "tivibu.com.tr",
  "superonline": "superonline.net",
  "turknet": "turk.net",
  "migros": "migros.com.tr",
  "a101": "a101.com.tr",
  "carrefoursa": "carrefoursa.com",
  "bim": "bim.com.tr",
  "sok": "sokmarket.com.tr",
  "papara": "papara.com",
  "ininal": "ininal.com",
  "marti": "marti.tech",
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
  "headspace": "headspace.com",
  "calm": "calm.com",
  "proton": "proton.me",
  "protonmail": "proton.me",
  "mega": "mega.nz",
  "lastpass": "lastpass.com",
  "norton": "norton.com",
  "kaspersky": "kaspersky.com",
  "malwarebytes": "malwarebytes.com",
  "wetransfer": "wetransfer.com",
  "kindle": "amazon.com",
  "shazam": "shazam.com",
  "pinterest": "pinterest.com",
  "meta": "meta.com",
  "instagram": "instagram.com",
  "whatsapp": "whatsapp.com",
  "uber": "uber.com",
  "bolt": "bolt.eu",
  "booking": "booking.com",
};


/**
 * Turkish banks, card programmes and wallets.
 *
 * Same table and same resolution as the subscription brands above, because a
 * mark is a mark: a payment source called "Garanti" and a subscription called
 * "Garanti" should not be drawn by two different mechanisms. Card programmes
 * are listed beside their bank because people name the source after whichever
 * one they think of — "Bonus" and "Garanti" are the same plastic.
 *
 * Keys are written FOLDED (plain lowercase ASCII, no Turkish diacritics),
 * because `catalogueKey` folds the name before it looks anything up. "Yapı
 * Kredi" arrives here as "yapi kredi".
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
  akbank: "akbank.com.tr",
  ziraat: "ziraatbank.com.tr",
  "ziraat bankasi": "ziraatbank.com.tr",
  vakifbank: "vakifbank.com.tr",
  "vakif bank": "vakifbank.com.tr",
  halkbank: "halkbank.com.tr",
  qnb: "qnb.com.tr",
  finansbank: "qnb.com.tr",
  teb: "teb.com.tr",
  ing: "ing.com.tr",
  hsbc: "hsbc.com.tr",
  sekerbank: "sekerbank.com.tr",
  odeabank: "odeabank.com.tr",
  fibabanka: "fibabanka.com.tr",
  "alternatif bank": "alternatifbank.com.tr",
  alternatifbank: "alternatifbank.com.tr",
  burgan: "burgan.com.tr",
  anadolubank: "anadolubank.com.tr",
  aktifbank: "aktifbank.com.tr",
  "aktif bank": "aktifbank.com.tr",
  adabank: "adabank.com.tr",
  turkishbank: "turkishbank.com",
  "turkish bank": "turkishbank.com",
  turklandbank: "tbank.com.tr",
  "turkland bank": "tbank.com.tr",
  icbc: "icbc.com.tr",
  // Participation banks
  "kuveyt turk": "kuveytturk.com.tr",
  kuveytturk: "kuveytturk.com.tr",
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
  world: "worldcard.com.tr",
  worldcard: "worldcard.com.tr",
  "world card": "worldcard.com.tr",
  bonus: "bonus.com.tr",
  bonuscard: "bonus.com.tr",
  "bonus card": "bonus.com.tr",
  maximum: "maximum.com.tr",
  maximiles: "maximiles.com.tr",
  axess: "axess.com.tr",
  wings: "wings.com.tr",
  paraf: "paraf.com.tr",
  cardfinans: "cardfinans.com.tr",
  "card finans": "cardfinans.com.tr",
  bankkart: "bankkart.com.tr",
  "bank kart": "bankkart.com.tr",
  advantage: "advantage.com.tr",
  // Digital banks, wallets and payment institutions
  enpara: "enpara.com",
  "n kolay": "nkolay.com.tr",
  nkolay: "nkolay.com.tr",
  papara: "papara.com",
  ininal: "ininal.com",
  paycell: "paycell.com.tr",
  colendi: "colendi.com",
  "getir finans": "getirfinans.com",
  getirfinans: "getirfinans.com",
  param: "param.com.tr",
  sipay: "sipay.com.tr",
  iyzico: "iyzico.com",
  moka: "moka.com",
  paratika: "paratika.com.tr",
  bkm: "bkm.com.tr",
  "bkm express": "bkmexpress.com.tr",
  bkmexpress: "bkmexpress.com.tr",
  // Garanti Ödeme ve Elektronik Para Hizmetleri A.Ş. — verified, and NOT
  // Ziraat's, which is the easy mistake to make with a bank-adjacent brand.
  tami: "tami.com.tr",
  // Card networks, for a source someone names after the scheme. `troy.com.tr`
  // is a promotional-gifts company, not the payment scheme — checked, because
  // the name makes it the obvious wrong guess.
  visa: "visa.com.tr",
  mastercard: "mastercard.com.tr",
  troy: "troyodeme.com",
};

/**
 * Names that belong to a real brand but have no mark anyone publishes.
 *
 * Both favicon services answer an unknown domain with a picture rather than an
 * error — Google a grey globe, DuckDuckGo a grey letter tile. `expo-image`
 * treats the HTTP status as an error and falls back, but a browser's `<img>`
 * draws any valid image body whatever the status said, so each of these names
 * drew a placeholder on web and its own type glyph on iOS: a wrong picture,
 * and two different wrong pictures on the two platforms.
 *
 * Listing them keeps the knowledge that they were checked rather than missed.
 * `scripts/audit-brand-marks.mjs` is what checks; a name arrives here when it
 * measures as unmarked on both services.
 *
 * Nays is the one that is here by judgement rather than by measurement. It has
 * no mark of its own, and `naysapp.com.tr` resolves to İş Bankası's file byte
 * for byte — so the catalogue was showing the bank's logo to someone who had
 * chosen Nays. A neutral glyph is a smaller error than a confident picture of
 * the wrong institution.
 */
export const UNMARKED_INSTITUTIONS = [
  "denizbank",
  "turkiye finans",
  "emlak katilim",
  "tosla",
  "nays",
  "bip",
  "bisu",
  "millenicom",
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
  const markSize = markFill(faviconDomain, size);

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
          style={{ width: markSize, height: markSize }}
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
