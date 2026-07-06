/**
 * Category icon suggestions: new columns get a fitting emoji automatically
 * (keyword match on the Turkish name), so hand-made categories sit visually
 * level with the template ones. Kind-based fallback guarantees an icon.
 */

const RULES: [RegExp, string][] = [
  [/kira/i, "🏠"],
  [/market|gıda|mutfak/i, "🛒"],
  [/ulaşım|benzin|akaryakıt|otobüs|metro|taksi/i, "🚌"],
  [/fatura|abonelik/i, "🧾"],
  [/yatırım|borsa|fon/i, "📈"],
  [/maaş/i, "💰"],
  [/sağlık|eczane|doktor/i, "🩺"],
  [/eğitim|okul|kurs/i, "🎓"],
  [/giyim|kıyafet/i, "👕"],
  [/eğlence|sinema|oyun/i, "🎬"],
  [/kredi/i, "🏦"],
  [/kart/i, "💳"],
  [/spor|fitness/i, "🏋️"],
  [/tatil|seyahat|u[çc]ak/i, "✈️"],
  [/hediye/i, "🎁"],
  [/elektrik/i, "⚡"],
  [/\bsu\b/i, "💧"],
  [/gaz|ısınma/i, "🔥"],
  [/internet|telefon|iletişim/i, "📶"],
  [/çocuk|bebek/i, "🍼"],
  [/evcil|pet/i, "🐾"],
  [/restoran|yemek|kafe/i, "🍽️"],
  [/gelir|prim|burs/i, "➕"],
];

export function suggestCategoryIcon(name: string, kind: "expense" | "income"): string {
  for (const [pattern, icon] of RULES) if (pattern.test(name)) return icon;
  return kind === "income" ? "💰" : "🧾";
}

/** Display icon for a category row (stored icon, else a live suggestion). */
export function categoryIcon(category: { name: string; kind: "expense" | "income"; icon: string | null }): string {
  return category.icon ?? suggestCategoryIcon(category.name, category.kind);
}
