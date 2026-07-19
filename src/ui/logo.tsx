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
import {
  Building2,
  Car,
  Droplets,
  Dumbbell,
  Flame,
  GraduationCap,
  Phone,
  Shield,
  Trash2,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react-native";
import { InitialsBadge } from "./components";
import { darkPalette, lightPalette, useTheme } from "./theme";
import { normalizeLogoDomain, remoteFaviconUrl } from "../domain/logo-domain";

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

/** Utility/service keywords → icon + accent (checked before brand lookup). */
const UTILITY_ICONS: { match: RegExp; icon: LucideIcon; color: string }[] = [
  { match: /elektrik|enerji/i, icon: Zap, color: "#eda100" },
  { match: /\bsu\b|iski/i, icon: Droplets, color: "#2a78d6" },
  { match: /do[gğ]algaz|\bgaz\b/i, icon: Flame, color: "#eb6834" },
  { match: /internet|fiber|adsl/i, icon: Wifi, color: "#4a3aa7" },
  { match: /telefon|gsm|hat\b/i, icon: Phone, color: "#1baf7a" },
  { match: /aidat|site\b|apartman/i, icon: Building2, color: "#5d6579" },
  { match: /sigorta|kasko|dask/i, icon: Shield, color: "#008300" },
  { match: /okul|kurs|e[gğ]itim/i, icon: GraduationCap, color: "#d55181" },
  { match: /spor|fitness|gym/i, icon: Dumbbell, color: "#e34948" },
  { match: /araç|otopark|hgs|ogs/i, icon: Car, color: "#2a78d6" },
  { match: /çöp|belediye/i, icon: Trash2, color: "#5d6579" },
];

/**
 * Accent colour + optional short monogram for well-known subscriptions, keyed
 * by a normalised name. Matched on the whole trimmed name first, then on the
 * first word, so "Netflix Premium" still resolves to Netflix.
 */
const BRAND: Record<string, { color: string; mark?: string }> = {
  netflix: { color: "#e50914", mark: "N" },
  spotify: { color: "#1db954", mark: "S" },
  youtube: { color: "#ff0000", mark: "YT" },
  "youtube premium": { color: "#ff0000", mark: "YT" },
  "youtube music": { color: "#ff0000", mark: "YT" },
  disney: { color: "#113ccf", mark: "D+" },
  "disney+": { color: "#113ccf", mark: "D+" },
  amazon: { color: "#ff9900", mark: "a" },
  prime: { color: "#1a98ff", mark: "P" },
  "prime video": { color: "#1a98ff", mark: "P" },
  "amazon prime": { color: "#1a98ff", mark: "P" },
  hbo: { color: "#002be7", mark: "M" },
  "hbo max": { color: "#002be7", mark: "M" },
  max: { color: "#002be7", mark: "M" },
  "apple music": { color: "#fa243c", mark: "" },
  "apple tv": { color: "#000000", mark: "TV" },
  "apple tv+": { color: "#000000", mark: "TV" },
  icloud: { color: "#3693f3", mark: "i" },
  chatgpt: { color: "#10a37f", mark: "AI" },
  openai: { color: "#10a37f", mark: "AI" },
  x: { color: "#000000", mark: "X" },
  twitter: { color: "#000000", mark: "X" },
  "google one": { color: "#4285f4", mark: "G" },
  twitch: { color: "#9146ff", mark: "T" },
  steam: { color: "#1b2838", mark: "S" },
  playstation: { color: "#003791", mark: "PS" },
  "playstation plus": { color: "#003791", mark: "PS" },
  xbox: { color: "#107c10", mark: "X" },
  "xbox game pass": { color: "#107c10", mark: "X" },
  nintendo: { color: "#e60012", mark: "N" },
  github: { color: "#181717", mark: "GH" },
  "github copilot": { color: "#181717", mark: "GH" },
  notion: { color: "#111111", mark: "N" },
  dropbox: { color: "#0061ff", mark: "D" },
  adobe: { color: "#da1f26", mark: "A" },
  canva: { color: "#00c4cc", mark: "C" },
  linkedin: { color: "#0a66c2", mark: "in" },
  "linkedin premium": { color: "#0a66c2", mark: "in" },
  patreon: { color: "#f96854", mark: "P" },
  audible: { color: "#f8991c", mark: "A" },
  duolingo: { color: "#58cc02", mark: "D" },
  deezer: { color: "#a238ff", mark: "D" },
  tidal: { color: "#000000", mark: "T" },
  blutv: { color: "#f8009e", mark: "blu" },
  exxen: { color: "#00e0b8", mark: "e" },
  tabii: { color: "#ff6600", mark: "t" },
  gain: { color: "#7c4dff", mark: "G" },
  todtv: { color: "#ed1c24", mark: "tod" },
  tod: { color: "#ed1c24", mark: "tod" },
  storytel: { color: "#ff5a5f", mark: "S" },
  claude: { color: "#d97757", mark: "C" },
  anthropic: { color: "#d97757", mark: "A" },
  gemini: { color: "#4285f4", mark: "G" },
  perplexity: { color: "#20808d", mark: "P" },
  midjourney: { color: "#1a1a2e", mark: "MJ" },
  cursor: { color: "#111111", mark: "C" },
  microsoft: { color: "#0078d4", mark: "M" },
  office: { color: "#d83b01", mark: "O" },
  onedrive: { color: "#0364b8", mark: "OD" },
  google: { color: "#4285f4", mark: "G" },
  apple: { color: "#000000", mark: "" },
  discord: { color: "#5865f2", mark: "D" },
  telegram: { color: "#26a5e4", mark: "T" },
  zoom: { color: "#0b5cff", mark: "Z" },
  slack: { color: "#611f69", mark: "S" },
  figma: { color: "#f24e1e", mark: "F" },
  evernote: { color: "#00a82d", mark: "E" },
  todoist: { color: "#e44332", mark: "T" },
  "1password": { color: "#0572ec", mark: "1P" },
  bitwarden: { color: "#175ddc", mark: "B" },
  nordvpn: { color: "#4687ff", mark: "N" },
  expressvpn: { color: "#da3940", mark: "EV" },
  surfshark: { color: "#178a9e", mark: "S" },
  crunchyroll: { color: "#f47521", mark: "CR" },
  mubi: { color: "#001489", mark: "M" },
  paramount: { color: "#0064ff", mark: "P+" },
  "paramount+": { color: "#0064ff", mark: "P+" },
  bein: { color: "#63276f", mark: "b" },
  "bein connect": { color: "#63276f", mark: "b" },
  "s sport": { color: "#e4002b", mark: "S" },
  "s sport plus": { color: "#e4002b", mark: "S" },
  "tv+": { color: "#ffc900", mark: "TV" },
  "tv plus": { color: "#ffc900", mark: "TV" },
  fizy: { color: "#8624db", mark: "f" },
  muud: { color: "#e6006d", mark: "M" },
  soundcloud: { color: "#ff5500", mark: "SC" },
  podimo: { color: "#5b2e90", mark: "P" },
  turkcell: { color: "#ffc900", mark: "T" },
  vodafone: { color: "#e60000", mark: "V" },
  "türk telekom": { color: "#0056a3", mark: "TT" },
  turktelekom: { color: "#0056a3", mark: "TT" },
  strava: { color: "#fc4c02", mark: "S" },
  macfit: { color: "#e30613", mark: "M" },
  nike: { color: "#111111", mark: "N" },
  medium: { color: "#191919", mark: "M" },
  scribd: { color: "#1e7b85", mark: "S" },
  blinkist: { color: "#2ce080", mark: "B" },
  roblox: { color: "#393b3d", mark: "R" },
  "epic games": { color: "#2f2d2e", mark: "E" },
  epic: { color: "#2f2d2e", mark: "E" },
  ubisoft: { color: "#0070ff", mark: "U" },
  "ea play": { color: "#ff4747", mark: "EA" },
  tinder: { color: "#fd5068", mark: "t" },
  bumble: { color: "#ffc629", mark: "b" },
  trendyol: { color: "#f27a1a", mark: "ty" },
  hepsiburada: { color: "#ff6000", mark: "hb" },
  getir: { color: "#5d3ebc", mark: "g" },
  yemeksepeti: { color: "#fa0050", mark: "ys" },
};

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
  "türk telekom": "turktelekom.com.tr",
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
};

/** Resolve the domain to fetch a favicon from (explicit override or a brand). */
function domainFor(name: string, override?: string | null): string | null {
  const normalizedOverride = normalizeLogoDomain(override);
  if (normalizedOverride) return normalizedOverride;
  const key = name.trim().toLocaleLowerCase("tr-TR");
  const firstWord = key.split(/\s+/)[0];
  return BRAND_DOMAIN[key] ?? (firstWord ? BRAND_DOMAIN[firstWord] : undefined) ?? null;
}

/** Perceived luminance → pick the palette's dark or light ink. */
function inkFor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? lightPalette.textStrong : darkPalette.textStrong;
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
  const { palette } = useTheme();
  const [failedDomain, setFailedDomain] = useState<string | null>(null);

  const utility = UTILITY_ICONS.find((u) => u.match.test(name));
  const key = name.trim().toLocaleLowerCase("tr-TR");
  const firstWord = key.split(/\s+/)[0];
  const brand = BRAND[key] ?? (firstWord ? BRAND[firstWord] : undefined) ?? null;
  // A utility (electricity/water/…) keeps its themed icon; other known public
  // domains load transparently and fall back locally on any network error.
  const faviconDomain = utility ? null : domainFor(name, domain);
  const faviconUrl = remoteFaviconUrl(faviconDomain);

  if (faviconDomain && faviconUrl && failedDomain !== faviconDomain) {
    return (
      <View style={[tileStyle(size), { backgroundColor: palette.surfaceAlt }]}>
        <Image
          accessible={false}
          accessibilityRole="none"
          accessibilityLabel=""
          alt=""
          source={{ uri: faviconUrl }}
          onError={() => setFailedDomain(faviconDomain)}
          // Fill the whole frame instead of floating at 72% inside it, which
          // left a ring of the theme surface colour showing around the mark.
          style={{ width: size, height: size }}
          contentFit="cover"
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
    const ink = inkFor(brand.color);
    const mark = brand.mark || name.trim().slice(0, 1).toLocaleUpperCase("tr-TR");
    return (
      <View style={[tileStyle(size), { backgroundColor: brand.color }]}>
        <Text style={{ color: ink, fontSize: size * (mark.length > 2 ? 0.3 : 0.42), fontFamily: "Inter_700Bold" }}>
          {mark}
        </Text>
      </View>
    );
  }

  return <InitialsBadge name={name} size={size} />;
}
