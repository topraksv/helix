/**
 * The drawn mark for a category or a payment source.
 *
 * Categories and payment sources used to be marked with an emoji, and every
 * other mark in this app is a single-colour lucide glyph. Four things followed
 * from that, all of them visible:
 *
 *   - an emoji does not take the palette, so it stayed at full saturation in a
 *     deliberately desaturated app and was the loudest thing on the screen;
 *   - it does not follow the theme, so dark mode got the light-mode mark;
 *   - it is drawn by the platform, so the same table was Apple Color Emoji on
 *     iOS, Segoe on Windows and Noto on Android — three different pictures of
 *     one workbook;
 *   - several of them carry a variation selector (🏋️ 🛡️ 🍽️ ✈️ 🏛️), which some
 *     platforms render as a MONOCHROME text glyph — so one column mixed
 *     colour marks and black-and-white ones.
 *
 * The mapping lives here, in the UI layer, and not in `domain/category-icons`
 * on purpose. The stored value stays exactly what it was: nothing migrates, no
 * sync payload changes shape, and the domain rule that picks a suggestion from
 * a Turkish name is untouched and still tested on its own terms. This module
 * only decides how the value that rule produced is DRAWN.
 *
 * The set is closed, which is what makes a total mapping honest: `icon` is
 * written in exactly two places (`repo/categories.ts` and `repo/imports.ts`),
 * both from `suggestCategoryIcon`, and there is no icon picker in the app. A
 * value from outside the set can still arrive from a restored backup, so there
 * is a fallback rather than an assertion.
 */

import React from "react";
import type { LucideIcon } from "lucide-react-native";
import Baby from "lucide-react-native/icons/baby";
import Banknote from "lucide-react-native/icons/banknote";
import Bus from "lucide-react-native/icons/bus";
import Clapperboard from "lucide-react-native/icons/clapperboard";
import Coins from "lucide-react-native/icons/coins";
import CreditCard from "lucide-react-native/icons/credit-card";
import Droplets from "lucide-react-native/icons/droplets";
import Dumbbell from "lucide-react-native/icons/dumbbell";
import Flame from "lucide-react-native/icons/flame";
import FolderOpen from "lucide-react-native/icons/folder-open";
import Fuel from "lucide-react-native/icons/fuel";
import Gift from "lucide-react-native/icons/gift";
import GraduationCap from "lucide-react-native/icons/graduation-cap";
import HandCoins from "lucide-react-native/icons/hand-coins";
import Handshake from "lucide-react-native/icons/handshake";
import House from "lucide-react-native/icons/house";
import Landmark from "lucide-react-native/icons/landmark";
import Package from "lucide-react-native/icons/package";
import PawPrint from "lucide-react-native/icons/paw-print";
import Pin from "lucide-react-native/icons/pin";
import Plane from "lucide-react-native/icons/plane";
import Plus from "lucide-react-native/icons/plus";
import Puzzle from "lucide-react-native/icons/puzzle";
import Receipt from "lucide-react-native/icons/receipt";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Scale from "lucide-react-native/icons/scale";
import Shapes from "lucide-react-native/icons/shapes";
import Shield from "lucide-react-native/icons/shield";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Shirt from "lucide-react-native/icons/shirt";
import ShoppingBag from "lucide-react-native/icons/shopping-bag";
import ShoppingCart from "lucide-react-native/icons/shopping-cart";
import Smartphone from "lucide-react-native/icons/smartphone";
import Sparkles from "lucide-react-native/icons/sparkles";
import Stethoscope from "lucide-react-native/icons/stethoscope";
import Tag from "lucide-react-native/icons/tag";
import Target from "lucide-react-native/icons/target";
import TrendingUp from "lucide-react-native/icons/trending-up";
import UtensilsCrossed from "lucide-react-native/icons/utensils-crossed";
import Wallet from "lucide-react-native/icons/wallet";
import WalletCards from "lucide-react-native/icons/wallet-cards";
import Wifi from "lucide-react-native/icons/wifi";
import Wrench from "lucide-react-native/icons/wrench";
import Zap from "lucide-react-native/icons/zap";
import { categoryIcon } from "../domain/category-icons";
import type { PaymentSourceType } from "../domain/types";
import { iconSize, useTheme } from "./theme";

/**
 * Every glyph `suggestCategoryIcon` can produce, and what it is drawn as.
 *
 * Keyed on the stored string rather than on a new enum, so nothing in the
 * database or in a backup has to change for this to take effect.
 */
const CATEGORY_GLYPHS: Record<string, LucideIcon> = {
  // Keyword rules, in the order `domain/category-icons` declares them.
  "🏠": House,
  "🛒": ShoppingCart,
  "⛽": Fuel,
  "🚌": Bus,
  "🧾": Receipt,
  "📈": TrendingUp,
  // Salary and the generic income fallback. It was a piggy bank, which is a
  // SAVINGS mark: the owner opened "Maaş" and found a pig looking back. A
  // wallet is what a salary lands in, and at 18pt it is still distinct from
  // the banknote (💵) and the coins (🪙) that share the income pool with it.
  "💰": Wallet,
  "🩺": Stethoscope,
  "🎓": GraduationCap,
  "👕": Shirt,
  "🎬": Clapperboard,
  "🏦": Landmark,
  "💳": CreditCard,
  "🏋️": Dumbbell,
  "✈️": Plane,
  "🎁": Gift,
  "🛡️": Shield,
  // Tax and duties: the scales, not the bank's colonnade — `🏦` already has
  // that and two identical marks in one column is the problem, not the fix.
  "🏛️": Scale,
  "🔧": Wrench,
  "⚡": Zap,
  "💧": Droplets,
  "🔥": Flame,
  "📶": Wifi,
  "🍼": Baby,
  "🐾": PawPrint,
  "🍽️": UtensilsCrossed,
  "➕": Plus,
  // Deterministic fallbacks, expense then income.
  "🛍️": ShoppingBag,
  "📦": Package,
  "💸": HandCoins,
  "🗂️": FolderOpen,
  "🎯": Target,
  "🧩": Puzzle,
  "📌": Pin,
  "🏷️": Tag,
  "🪙": Coins,
  "💵": Banknote,
  "🤝": Handshake,
  "✨": Sparkles,
};

/**
 * A mark for a value this build has never seen — a category restored from a
 * backup written by an older version, for instance. It is deliberately a shape
 * and not a question mark: the category is fine, only its picture is unknown.
 */
const UNKNOWN_GLYPH = Shapes;

export function categoryIconComponent(category: {
  name: string;
  kind: "expense" | "income";
  /** A stored category has `null`; a template one simply omits it. */
  icon?: string | null;
}): LucideIcon {
  return CATEGORY_GLYPHS[categoryIcon({ ...category, icon: category.icon ?? null })] ?? UNKNOWN_GLYPH;
}

/**
 * Payment sources map from the TYPE, not from the stored glyph.
 *
 * The type is a closed set the schema enforces, so this mapping cannot fall
 * through — and it lets two sources that happen to share a glyph still read
 * differently, which the emoji table could not do.
 */
const SOURCE_GLYPHS: Record<PaymentSourceType, LucideIcon> = {
  credit_card: CreditCard,
  debit_card: WalletCards,
  virtual_card: ShieldCheck,
  e_wallet: Smartphone,
  cash: Banknote,
  direct_debit: RefreshCw,
  bank_transfer: Landmark,
};

export function paymentSourceIconComponent(type: PaymentSourceType): LucideIcon {
  return SOURCE_GLYPHS[type] ?? UNKNOWN_GLYPH;
}

/**
 * The category mark, drawn.
 *
 * Decoration in every case this is used: the row, cell or option beside it
 * already carries the category's name, and an assistive technology that also
 * announced the picture would be reading the same thing twice.
 */
export function CategoryIcon({
  category,
  size = iconSize.control,
  color,
}: {
  category: { name: string; kind: "expense" | "income"; icon?: string | null };
  size?: number;
  color?: string;
}) {
  const { palette } = useTheme();
  const Icon = categoryIconComponent(category);
  return <Icon accessible={false} size={size} color={color ?? palette.accentText} strokeWidth={2} />;
}
