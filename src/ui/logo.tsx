/**
 * Brand logo chain (spec §2.4), derived from the subscription NAME alone:
 *   utility keyword → themed icon chip (electricity, water, internet…)
 *   known brand alias → simple-icons CDN
 *   optional domain → favicon
 *   otherwise → initials badge
 * Runtime fetch with graceful fallback; nothing bundled.
 */

import React, { useMemo, useState } from "react";
import { View } from "react-native";
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

/** Popular names whose simple-icons slug differs from a naive slugify. */
const BRAND_ALIASES: Record<string, string> = {
  hbo: "hbomax",
  hbomax: "hbomax",
  "hbo max": "hbomax",
  blutv: "blutv",
  exxen: "exxen",
  prime: "primevideo",
  "prime video": "primevideo",
  "amazon prime": "primevideo",
  chatgpt: "openai",
  "youtube premium": "youtube",
  "youtube music": "youtubemusic",
  "google one": "google",
  "apple music": "applemusic",
  "apple tv": "appletv",
  icloud: "icloud",
  "x premium": "x",
  twitter: "x",
};

function slugify(name: string): string {
  return name
    .toLocaleLowerCase("en-US")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

export function Logo({ name, domain, size = 36 }: { name: string; domain?: string | null; size?: number }) {
  const { palette } = useTheme();
  const [failed, setFailed] = useState(0);

  const utility = useMemo(() => UTILITY_ICONS.find((u) => u.match.test(name)), [name]);
  const urls = useMemo(() => {
    const list: string[] = [];
    const alias = BRAND_ALIASES[name.trim().toLocaleLowerCase("tr-TR")];
    const slug = alias ?? slugify(name);
    if (slug.length >= 3) list.push(`https://cdn.simpleicons.org/${slug}`);
    if (domain) list.push(`https://icons.duckduckgo.com/ip3/${domain.replace(/^https?:\/\//, "")}.ico`);
    return list;
  }, [name, domain]);

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
        <IconCmp size={size * 0.55} color={utility.color} strokeWidth={2} />
      </View>
    );
  }
  if (failed >= urls.length || urls.length === 0) return <InitialsBadge name={name} size={size} />;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        backgroundColor: palette.surfaceAlt,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={{ uri: urls[failed] }}
        style={{ width: size * 0.7, height: size * 0.7 }}
        contentFit="contain"
        cachePolicy="disk"
        onError={() => setFailed((f) => f + 1)}
        accessibilityLabel={name}
      />
    </View>
  );
}
