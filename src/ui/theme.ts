/**
 * Design tokens + theme resolution (system / light / dark, user-overridable).
 * Plain StyleSheet tokens — no styling runtime, zero config, works identically
 * on iOS and web.
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
  onPrimary: string;
  positive: string;
  negative: string;
  warning: string;
  focus: string;
}

export const lightPalette: Palette = {
  background: "#F6F7F9",
  surface: "#FFFFFF",
  surfaceAlt: "#EEF0F4",
  border: "#E1E4EA",
  text: "#191C22",
  textMuted: "#5D6470",
  primary: "#2A5DB0",
  onPrimary: "#FFFFFF",
  positive: "#1E7F4F",
  negative: "#B3362C",
  warning: "#9A6A00",
  focus: "#2A5DB0",
};

export const darkPalette: Palette = {
  background: "#101318",
  surface: "#181C23",
  surfaceAlt: "#20252E",
  border: "#2A303B",
  text: "#E8EAEE",
  textMuted: "#9AA1AC",
  primary: "#7FA7E8",
  onPrimary: "#0F1420",
  positive: "#5FBF8F",
  negative: "#E08076",
  warning: "#D9A94A",
  focus: "#7FA7E8",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;

export const type = {
  title: { fontSize: 24, fontWeight: "700" as const },
  heading: { fontSize: 18, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  label: { fontSize: 13, fontWeight: "500" as const },
  small: { fontSize: 12, fontWeight: "400" as const },
  amountLg: { fontSize: 28, fontWeight: "700" as const, fontVariant: ["tabular-nums" as const] },
  amount: { fontSize: 15, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
};

export type ThemePreference = "system" | "light" | "dark";

export interface Theme {
  palette: Palette;
  scheme: "light" | "dark";
}

export const ThemeContext = createContext<Theme>({ palette: lightPalette, scheme: "light" });

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
