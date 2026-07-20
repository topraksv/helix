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
import { useTheme } from "./theme";
import { BRAND, brandPlate } from "../domain/brand-colors";
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
          <Text style={{ color: ink, fontSize: size * (mark.length > 2 ? 0.26 : 0.34), fontFamily: "Inter_700Bold" }}>
            {mark}
          </Text>
        </View>
      </View>
    );
  }

  return <InitialsBadge name={name} size={size} />;
}
