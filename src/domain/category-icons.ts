/**
 * Category icon suggestions: new columns get a fitting emoji automatically
 * (keyword match on the Turkish name), so hand-made categories sit visually
 * level with the template ones. Kind-based fallback guarantees an icon.
 */


const RULES: [RegExp, string][] = [
  [/kira/i, "🏠"],
  [/market|gıda|mutfak/i, "🛒"],
  // Fuel and the vehicle it goes into are their own category in most Turkish
  // workbooks; matched before transit so "Araç & Yakıt" stops falling through
  // to a deterministic shopping bag.
  [/araç|araba|otomobil|yakıt|benzin|akaryakıt|otopark/i, "⛽"],
  [/ulaşım|otobüs|metro|taksi/i, "🚌"],
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
  [/sigorta/i, "🛡️"],
  [/vergi|harç/i, "🏛️"],
  [/bakım|onarım|tamir/i, "🔧"],
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

/**
 * Which rule above a piece of text falls under, or null.
 *
 * The rules are a small Turkish vocabulary of what money is spent ON, and they
 * were doing one job: choosing an emoji. They answer a second question just as
 * well — whether two strings are about the SAME thing — and that is what lets a
 * statement line find the owner's own column: "MIGROS MARKET" and a column
 * called "Gıda" share rule 1 without sharing a word. Exported as an index
 * rather than a name so there is still exactly one vocabulary; naming the
 * concepts would be a second list to keep in step with this one.
 */
export function conceptOf(text: string): number | null {
  const index = RULES.findIndex(([pattern]) => pattern.test(text));
  return index === -1 ? null : index;
}

export function suggestCategoryIcon(name: string, kind: "expense" | "income"): string {
  for (const [pattern, icon] of RULES) if (pattern.test(name)) return icon;
  const pool = kind === "income" ? INCOME_FALLBACKS : EXPENSE_FALLBACKS;
  // A remainder of a non-empty tuple's length is always in range, so the `??`
  // that stood here was a branch no input could take — and an untakeable branch
  // is what kept this file out of the coverage gate.
  return pool[hashString(name.trim().toLocaleLowerCase("tr-TR")) % pool.length]!;
}

/** Display icon for a category row (stored icon, else a live suggestion). */
export function categoryIcon(category: { name: string; kind: "expense" | "income"; icon: string | null }): string {
  return category.icon ?? suggestCategoryIcon(category.name, category.kind);
}
