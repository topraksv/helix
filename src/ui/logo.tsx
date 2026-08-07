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
import { font } from "./theme";
import { BRAND, brandPlate } from "./brand-colors";
import { foldForMatch, nameMentions, normalizeLogoDomain, remoteFaviconUrl } from "../domain/logo-domain";

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
  "millenicom": "millenicom.com.tr",
  "migros": "migros.com.tr",
  "a101": "a101.com.tr",
  "carrefoursa": "carrefoursa.com",
  "bim": "bim.com.tr",
  "sok": "sokmarket.com.tr",
  "bip": "bip.com",
  "papara": "papara.com",
  "ininal": "ininal.com",
  "marti": "marti.tech",
  "bisu": "bisu.com.tr",
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
  const mentioned = Object.keys(table)
    .filter((entry) => entry.length >= 3 && nameMentions(name, entry))
    .sort((a, b) => b.length - a.length)[0];
  return mentioned != null ? table[mentioned]! : null;
}

function domainFor(name: string, override?: string | null): string | null {
  const normalizedOverride = normalizeLogoDomain(override);
  if (normalizedOverride) return normalizedOverride;
  return catalogueKey(name, BRAND_DOMAIN);
}

export function Logo({
  name,
  domain,
  size = 36,
}: {
  name: string;
  domain?: string | null;
  size?: number;
}) {
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

  return <InitialsBadge name={name} size={size} />;
}
