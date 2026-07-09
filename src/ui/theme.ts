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

// Warm Organic Editorial — linen paper, antique charcoal, terracotta accent,
// with sage + camel secondaries. No pure #FFF / #000.
export const lightPalette: Palette = {
  background: "#F3EFE0",
  surface: "#FBF8EF",
  surfaceAlt: "#ECE5D3",
  border: "#E1D8C4",
  text: "#1E1E1E",
  textMuted: "#6E6656",
  primary: "#C9623F",
  primarySoft: "#F0E0D6",
  onPrimary: "#F6F5F2",
  positive: "#5F7A55",
  negative: "#A8432B",
  warning: "#A9772F",
  focus: "#C9623F",
  gradientFrom: "#C9623F",
  gradientTo: "#B5754A",
};

export const darkPalette: Palette = {
  background: "#181817",
  surface: "#222221",
  surfaceAlt: "#2B2B28",
  border: "#34332F",
  text: "#F6F5F2",
  textMuted: "#A8A296",
  primary: "#C9623F",
  primarySoft: "#3A2A22",
  onPrimary: "#F6F5F2",
  positive: "#96A085",
  negative: "#D97757",
  warning: "#CBA15E",
  focus: "#C9623F",
  gradientFrom: "#C9623F",
  gradientTo: "#8A5236",
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
} as const;

/**
 * Static font files carry one weight each, so tokens set fontFamily only —
 * never fontWeight (iOS would try to synthesize a second face).
 */
export const type = {
  display: { fontSize: 34, fontFamily: font.extrabold, letterSpacing: -0.8 },
  title: { fontSize: 24, fontFamily: font.bold, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontFamily: font.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.medium },
  small: { fontSize: 12, fontFamily: font.regular },
  amountLg: {
    fontSize: 32,
    fontFamily: font.bold,
    letterSpacing: -0.6,
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

export type ThemePreference = "system" | "light" | "dark";

export interface Theme {
  palette: Palette;
  scheme: "light" | "dark";
}

export const ThemeContext = createContext<Theme>({ palette: lightPalette, scheme: "light" });

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
