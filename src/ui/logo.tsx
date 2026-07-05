/** Brand logo chain (spec §2.4): simple-icons CDN → favicon by domain →
 *  initials badge. Runtime fetch with graceful fallback; nothing bundled. */

import React, { useMemo, useState } from "react";
import { Image } from "expo-image";
import { InitialsBadge } from "./components";

function slugify(name: string): string {
  return name
    .toLocaleLowerCase("en-US")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

export function Logo({ name, domain, size = 36 }: { name: string; domain?: string | null; size?: number }) {
  const [failed, setFailed] = useState(0);
  const urls = useMemo(() => {
    const list: string[] = [];
    const slug = slugify(name);
    if (slug.length >= 3) list.push(`https://cdn.simpleicons.org/${slug}`);
    if (domain) list.push(`https://icons.duckduckgo.com/ip3/${domain.replace(/^https?:\/\//, "")}.ico`);
    return list;
  }, [name, domain]);

  if (failed >= urls.length || urls.length === 0) return <InitialsBadge name={name} size={size} />;
  return (
    <Image
      source={{ uri: urls[failed] }}
      style={{ width: size, height: size, borderRadius: 8 }}
      contentFit="contain"
      cachePolicy="disk"
      onError={() => setFailed((f) => f + 1)}
      accessibilityLabel={name}
    />
  );
}
