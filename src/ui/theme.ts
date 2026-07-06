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

export const lightPalette: Palette = {
  background: "#F6F7FA",
  surface: "#FFFFFF",
  surfaceAlt: "#EFF1F6",
  border: "#E4E7EF",
  text: "#12162B",
  textMuted: "#5D6579",
  primary: "#4F46E5",
  primarySoft: "#EEF0FE",
  onPrimary: "#FFFFFF",
  positive: "#0A7F53",
  negative: "#C93B31",
  warning: "#96690A",
  focus: "#4F46E5",
  gradientFrom: "#4F46E5",
  gradientTo: "#7C3AED",
};

export const darkPalette: Palette = {
  background: "#0B0E15",
  surface: "#131824",
  surfaceAlt: "#1B2231",
  border: "#252D40",
  text: "#EFF1F7",
  textMuted: "#98A0B5",
  primary: "#8B93F8",
  primarySoft: "#232A45",
  onPrimary: "#0B0E15",
  positive: "#4ADE97",
  negative: "#F28B82",
  warning: "#E8B54A",
  focus: "#8B93F8",
  gradientFrom: "#4338CA",
  gradientTo: "#7C3AED",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, full: 999 } as const;

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

/** Soft elevation for cards; renders as box-shadow on web. */
export const cardShadow = {
  shadowColor: "#0B0E15",
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
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
