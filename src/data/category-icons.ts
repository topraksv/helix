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

// Aesthetic fallbacks when the name matches no keyword: picked deterministically
// from the name so different columns get different (but stable) icons instead of
// all sharing one emoji.
const EXPENSE_FALLBACKS = ["🧾", "🛍️", "📦", "💸", "🗂️", "🎯", "🧩", "📌", "🏷️", "🪙"] as const;
const INCOME_FALLBACKS = ["💰", "💵", "🪙", "📈", "🏦", "💳", "🤝", "✨"] as const;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function suggestCategoryIcon(name: string, kind: "expense" | "income"): string {
  for (const [pattern, icon] of RULES) if (pattern.test(name)) return icon;
  const pool = kind === "income" ? INCOME_FALLBACKS : EXPENSE_FALLBACKS;
  return pool[hashString(name.trim().toLocaleLowerCase("tr-TR")) % pool.length] ?? pool[0];
}

/** Display icon for a category row (stored icon, else a live suggestion). */
export function categoryIcon(category: { name: string; kind: "expense" | "income"; icon: string | null }): string {
  return category.icon ?? suggestCategoryIcon(category.name, category.kind);
}
