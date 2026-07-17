/**
 * Design tokens + theme resolution (system / light / dark, user-overridable).
 * Plain StyleSheet tokens — no styling runtime, zero config, works identically
 * on iOS and web. Typeface: Inter (loaded in the root layout).
 */

import { createContext, useContext } from "react";

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primarySoft: string; // tinted background for icon chips / selected states
  onPrimary: string;
  positive: string;
  negative: string;
  warning: string;
  focus: string;
  /** Hero gradient (balance card, auth backdrop accents). */
  gradientFrom: string;
  gradientTo: string;
}

// Warm Organic Editorial, aligned to Claude's design tokens: clay accent
// (#d97757) over a warm gray ramp (oat cream in light, near-black #141413 in
// dark). Sage/olive + amber secondaries carry the semantic roles.
// All hexes below are Claude's exact design tokens (gray ramp, clay, error,
// focus, extended-green/yellow). primarySoft is the one derived value (a clay
// tint) because the codebase appends hex alpha to it.
export const lightPalette: Palette = {
  background: "#faf9f5", // gray-050 (warm cream page)
  surface: "#ffffff", // gray-000
  surfaceAlt: "#f0eee6", // gray-150
  border: "#e8e6dc", // gray-200
  text: "#1a1918", // gray-900
  textMuted: "#73726c", // gray-550
  primary: "#d97757", // clay
  primarySoft: "#f6e7df", // clay tint (derived)
  onPrimary: "#ffffff",
  positive: "#1e9f3c", // extended-green (light)
  negative: "#bf4d43", // error
  warning: "#98801f", // extended-yellow (light)
  focus: "#2c84db", // color-focus
  gradientFrom: "#d97757", // clay
  gradientTo: "#c6613f", // clay-hover
};

export const darkPalette: Palette = {
  background: "#141413", // bg-primary
  surface: "#262624", // bg-tertiary (cards)
  surfaceAlt: "#30302e", // gray-750
  border: "#3d3d3a", // border-secondary
  text: "#faf9f5", // fg-primary
  textMuted: "#b0aea5", // fg-secondary
  primary: "#d97757", // clay
  primarySoft: "#3a2a22", // clay tint dark (derived)
  onPrimary: "#ffffff",
  positive: "#4dcb6b", // extended-green (dark)
  negative: "#bf4d43", // error
  warning: "#ffd014", // extended-yellow (dark)
  focus: "#2c84db", // color-focus
  gradientFrom: "#d97757", // clay
  gradientTo: "#c46849", // clay-dark
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Ultra-soft organic corners in the 12–16px editorial range.
export const radius = { sm: 12, md: 14, lg: 16, xl: 22, full: 999 } as const;

export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
  // Editorial serif for headings + hero figures (Warm Organic aesthetic).
  serifMedium: "Fraunces_500Medium",
  serif: "Fraunces_600SemiBold",
  serifBold: "Fraunces_700Bold",
} as const;

/**
 * Static font files carry one weight each, so tokens set fontFamily only —
 * never fontWeight (iOS would try to synthesize a second face). Headings and
 * the hero balance use the serif; body, labels and table figures stay Inter.
 */
export const type = {
  display: { fontSize: 34, fontFamily: font.serifBold, letterSpacing: -0.4 },
  title: { fontSize: 25, fontFamily: font.serifBold, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontFamily: font.serif, letterSpacing: -0.1 },
  body: { fontSize: 15, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.medium },
  small: { fontSize: 12, fontFamily: font.regular },
  amountLg: {
    fontSize: 33,
    fontFamily: font.serifBold,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums" as const],
  },
  amount: { fontSize: 15, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
  amountSm: { fontSize: 12, fontFamily: font.medium, fontVariant: ["tabular-nums" as const] },
};

/** Whisper-soft elevation for light cards; renders as box-shadow on web. */
export const cardShadow = {
  shadowColor: "#1E1E1E",
  shadowOpacity: 0.05,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 1,
} as const;

/** Floating overlays (snackbar) sit over content, so they need a firmer — but
 *  still soft — shadow than cards. One definition, no per-screen values. */
export const overlayShadow = {
  shadowColor: "#1E1E1E",
  shadowOpacity: 0.18,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 4,
} as const;

/** Tab bar metrics — the single source for the bar itself AND for overlays
 *  that must clear it (undo snackbar). Web gets extra height so Turkish
 *  descenders (ç/ğ) aren't clipped, and a floor because mobile web reports no
 *  bottom inset. */
export const TAB_BAR = { height: 56, webHeight: 64, minBottomInset: 8, webMinBottomInset: 14 } as const;

export function tabBarHeight(bottomInset: number, isWeb: boolean): number {
  const pad = Math.max(bottomInset, isWeb ? TAB_BAR.webMinBottomInset : TAB_BAR.minBottomInset);
  return (isWeb ? TAB_BAR.webHeight : TAB_BAR.height) + pad;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Theme {
  palette: Palette;
  scheme: "light" | "dark";
}

export const ThemeContext = createContext<Theme>({ palette: lightPalette, scheme: "light" });

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
