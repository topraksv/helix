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
import { radius, useTheme } from "./theme";
import { normalizeLogoDomain, remoteFaviconUrl } from "../domain/logo-domain";

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
  storytel: { color: "#ff5a5f", mark: "S" },
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
};

/** Resolve the domain to fetch a favicon from (explicit override or a brand). */
function domainFor(name: string, override?: string | null): string | null {
  const normalizedOverride = normalizeLogoDomain(override);
  if (normalizedOverride) return normalizedOverride;
  const key = name.trim().toLocaleLowerCase("tr-TR");
  const firstWord = key.split(/\s+/)[0];
  return BRAND_DOMAIN[key] ?? (firstWord ? BRAND_DOMAIN[firstWord] : undefined) ?? null;
}

/** Perceived luminance → pick black or white ink for legible contrast. */
function inkFor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1a1918" : "#ffffff";
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
      <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: palette.border }}>
        <Image
          accessible={false}
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
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.sm,
          backgroundColor: utility.color + "22",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconCmp accessible={false} size={size * 0.55} color={utility.color} strokeWidth={2} />
      </View>
    );
  }

  if (brand) {
    const ink = inkFor(brand.color);
    const mark = brand.mark || name.trim().slice(0, 1).toLocaleUpperCase("tr-TR");
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.sm,
          backgroundColor: brand.color,
          borderWidth: ink === "#1a1918" ? 1 : 0,
          borderColor: palette.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: ink, fontSize: size * (mark.length > 2 ? 0.3 : 0.42), fontFamily: "Inter_700Bold" }}>
          {mark}
        </Text>
      </View>
    );
  }

  return <InitialsBadge name={name} size={size} />;
}
