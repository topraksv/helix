/** System/light/dark design tokens shared by native and web. */

import { createContext, useContext } from "react";

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceHover: string;
  surfaceStrong: string;
  border: string;
  textStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  accentText: string;
  primaryText: string;
  onPrimary: string;
  onNegative: string;
  positive: string;
  positiveText: string;
  negative: string;
  negativeText: string;
  warning: string;
  warningText: string;
  focus: string;
}

// Claude's warm neutral/clay palette. Semantic text roles deliberately use the
// supplied neutral foregrounds when a chromatic token is not AA at body size.
export const lightPalette: Palette = {
  background: "#F8F8F7",
  surface: "#F5F4EF",
  surfaceAlt: "#F0EEE5",
  surfaceHover: "#E8E5D8",
  surfaceStrong: "#DED8C4",
  border: "#706B57",
  textStrong: "#0F0F0D",
  text: "#29261B",
  textSecondary: "#535146",
  textMuted: "#737163",
  primary: "#BA5B38",
  primaryStrong: "#C96442",
  primarySoft: "#F2E0DA",
  accentText: "#AB5235",
  primaryText: "#0F0F0D",
  onPrimary: "#FFFFFF",
  onNegative: "#FFFFFF",
  positive: "#207FDE",
  positiveText: "#535146",
  negative: "#A72519",
  negativeText: "#A72519",
  warning: "#5645A1",
  warningText: "#535146",
  focus: "#207FDE",
};

export const darkPalette: Palette = {
  background: "#1A1A19",
  surface: "#222220",
  surfaceAlt: "#2D2D2A",
  surfaceHover: "#393937",
  surfaceStrong: "#494946",
  border: "#514F48",
  textStrong: "#FAF9F5",
  text: "#EFEEEC",
  textSecondary: "#B6B5AF",
  textMuted: "#989790",
  primary: "#D56E48",
  primaryStrong: "#CC5933",
  primarySoft: "#493027",
  accentText: "#D97959",
  primaryText: "#FAF9F5",
  onPrimary: "#1A1A19",
  onNegative: "#0F0F0D",
  positive: "#4594E3",
  positiveText: "#B6B5AF",
  negative: "#DD493C",
  negativeText: "#EFEEEC",
  warning: "#8979D2",
  warningText: "#B6B5AF",
  focus: "#4594E3",
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

export const cardShadow = { boxShadow: "0 2px 8px rgba(15, 15, 13, 0.05)" } as const;
export const overlayShadow = { boxShadow: "0 4px 16px rgba(15, 15, 13, 0.18)" } as const;

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
