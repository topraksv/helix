/** System/light/dark design tokens shared by native and web. */

import { createContext, useContext } from "react";

export interface Palette {
  background: string;
  surface: string;
  /**
   * `surface` with alpha, for the floating tab bar that content scrolls under.
   * The opaque prefix must stay identical to `surface` so every contrast pair
   * already proved against `surface` still holds once it composites; the alpha
   * is high enough that what shows through reads as texture, not as a second
   * background. Reduce Transparency swaps it for `surface` itself.
   */
  surfaceTranslucent: string;
  surfaceAlt: string;
  surfaceHover: string;
  surfaceStrong: string;
  border: string;
  /**
   * Boundary for interactive controls (toggles, inputs). Separate from `border`
   * because a decorative divider only has to be visible, while a control has to
   * satisfy WCAG 1.4.11 (3:1) against every surface it can sit on — including
   * `primarySoft`, where the toggle track and its row background were the same
   * colour and the control vanished completely.
   */
  controlBorder: string;
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
  destructive: string;
  onDestructive: string;
  error: string;
  errorText: string;
  success: string;
  successText: string;
  /** Financial direction roles. Do not reuse them for generic status UI. */
  positive: string;
  positiveText: string;
  negative: string;
  negativeText: string;
  warning: string;
  warningText: string;
  focus: string;
}

const lightSemanticColors = {
  destructive: "#A72519",
  onDestructive: "#FFFFFF",
  error: "#A72519",
  errorText: "#A72519",
  success: "#2E8B47",
  successText: "#1F6B33",
  positive: "#2E8B47",
  positiveText: "#1F6B33",
  negative: "#A72519",
  negativeText: "#A72519",
  warning: "#A87B17",
  warningText: "#7A5A10",
  focus: "#207FDE",
} satisfies Pick<Palette,
  | "destructive" | "onDestructive" | "error" | "errorText"
  | "success" | "successText" | "positive" | "positiveText"
  | "negative" | "negativeText" | "warning" | "warningText" | "focus"
>;

const darkSemanticColors = {
  destructive: "#DD493C",
  onDestructive: "#0F0F0D",
  error: "#DD493C",
  errorText: "#FF8277",
  success: "#57B76B",
  successText: "#7CC98F",
  positive: "#57B76B",
  positiveText: "#7CC98F",
  negative: "#DD493C",
  negativeText: "#FF8277",
  warning: "#E0A83C",
  warningText: "#E3B978",
  focus: "#4594E3",
} satisfies Pick<Palette,
  | "destructive" | "onDestructive" | "error" | "errorText"
  | "success" | "successText" | "positive" | "positiveText"
  | "negative" | "negativeText" | "warning" | "warningText" | "focus"
>;

// Warm neutral/clay ramp with semantic accents tuned to the paper palette:
// income/positive is a garden green, expense/negative a brick red, warning a
// warm ochre. Purple and blue accents are banned (the sole blue is the focus
// ring, an a11y convention). `*Text` variants are the AA-safe foregrounds for
// body-size text; the base tokens are fills/chart marks (3:1 contract).
const clayLight: Palette = {
  background: "#F8F8F7",
  surface: "#F5F4EF",
  surfaceTranslucent: "#F5F4EFEB",
  surfaceAlt: "#F0EEE5",
  surfaceHover: "#E8E5D8",
  surfaceStrong: "#DED8C4",
  border: "#706B57",
  controlBorder: "#706B57",
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
  ...lightSemanticColors,
};

const clayDark: Palette = {
  background: "#1A1A19",
  surface: "#222220",
  surfaceTranslucent: "#222220EB",
  surfaceAlt: "#2D2D2A",
  surfaceHover: "#393937",
  surfaceStrong: "#494946",
  border: "#514F48",
  controlBorder: "#908C80",
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
  ...darkSemanticColors,
};

const sandLight: Palette = {
  background: "#FBF5E8",
  surface: "#F7EEDC",
  surfaceTranslucent: "#F7EEDCEB",
  surfaceAlt: "#EFE3CC",
  surfaceHover: "#E7D6B8",
  surfaceStrong: "#D8C29D",
  border: "#776244",
  controlBorder: "#776244",
  textStrong: "#1C140A",
  text: "#352816",
  textSecondary: "#5C4B34",
  textMuted: "#75664F",
  primary: "#A95A24",
  primaryStrong: "#B9642B",
  primarySoft: "#F2DCC8",
  accentText: "#884318",
  primaryText: "#1C140A",
  onPrimary: "#FFFFFF",
  ...lightSemanticColors,
};

const sandDark: Palette = {
  background: "#1C1812",
  surface: "#252019",
  surfaceTranslucent: "#252019EB",
  surfaceAlt: "#332A20",
  surfaceHover: "#403428",
  surfaceStrong: "#534434",
  border: "#645442",
  controlBorder: "#A38F73",
  textStrong: "#FFF9ED",
  text: "#F3EBDD",
  textSecondary: "#C0B29F",
  textMuted: "#9F927F",
  primary: "#D98545",
  primaryStrong: "#CF7436",
  primarySoft: "#513621",
  accentText: "#F0A064",
  primaryText: "#FFF9ED",
  onPrimary: "#1C1812",
  ...darkSemanticColors,
};

const cinnamonLight: Palette = {
  background: "#FAF5F2",
  surface: "#F6EEE9",
  surfaceTranslucent: "#F6EEE9EB",
  surfaceAlt: "#EEE1D9",
  surfaceHover: "#E5D4CA",
  surfaceStrong: "#D5BCAE",
  border: "#745B4E",
  controlBorder: "#745B4E",
  textStrong: "#1A110D",
  text: "#35251E",
  textSecondary: "#5C4A41",
  textMuted: "#76655C",
  primary: "#A84F30",
  primaryStrong: "#B95B39",
  primarySoft: "#F0D9D0",
  accentText: "#8E3D24",
  primaryText: "#1A110D",
  onPrimary: "#FFFFFF",
  ...lightSemanticColors,
};

const cinnamonDark: Palette = {
  background: "#1D1715",
  surface: "#281F1C",
  surfaceTranslucent: "#281F1CEB",
  surfaceAlt: "#352925",
  surfaceHover: "#43322D",
  surfaceStrong: "#554039",
  border: "#634C44",
  controlBorder: "#A28579",
  textStrong: "#FFF8F4",
  text: "#F4EAE5",
  textSecondary: "#C2B0A8",
  textMuted: "#A08E86",
  primary: "#D77753",
  primaryStrong: "#CB6541",
  primarySoft: "#533126",
  accentText: "#ED9271",
  primaryText: "#FFF8F4",
  onPrimary: "#1D1715",
  ...darkSemanticColors,
};

export type PaletteId = "clay" | "sand" | "cinnamon";

export const DEFAULT_PALETTE_ID: PaletteId = "clay";
export const PALETTE_IDS = ["clay", "sand", "cinnamon"] as const satisfies readonly PaletteId[];
export const PALETTES: Record<PaletteId, { light: Palette; dark: Palette }> = {
  clay: { light: clayLight, dark: clayDark },
  sand: { light: sandLight, dark: sandDark },
  cinnamon: { light: cinnamonLight, dark: cinnamonDark },
};

/** Backwards-compatible aliases for code that needs the default brand palette. */
export const lightPalette = PALETTES.clay.light;
export const darkPalette = PALETTES.clay.dark;

export function isPaletteId(value: string | null): value is PaletteId {
  return value != null && PALETTE_IDS.some((id) => id === value);
}

/** Shared modal scrim — warm ink, matching `textStrong`'s hue. */
export const scrim = "rgba(15, 15, 13, 0.55)";

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Ultra-soft organic corners in the 12–16px editorial range.
export const radius = { sm: 12, md: 14, lg: 16, xl: 22, full: 999 } as const;

/** Shared control geometry. Keep compact visual controls distinct from the
 *  minimum interactive target: compact buttons use hitSlop to reach 44pt. */
export const controlSize = {
  compact: 36,
  minimumTarget: 44,
  regular: 48,
  inputAccessoryWidth: 42,
  inputAccessoryInset: 44,
} as const;

export const loadingSize = {
  progressWidth: 120,
} as const;

/**
 * `headerBack` is deliberately even.
 *
 * The chevron is centred inside `controlSize.minimumTarget`, so the leftover
 * space is split in two. At 25pt each side got (44 − 25) / 2 = 9.5pt: a
 * browser paints that as-is, but React Native rounds layout to the device
 * pixel grid, so at @3x one side rounded 28.5 physical px up to 29 and the
 * other kept 28 — the glyph sat one physical pixel off-centre inside its own
 * circular target on native while the web header looked correct. An even size
 * halves to a whole point at 1x, 2x and 3x alike.
 */
export const iconSize = { compact: 15, control: 17, accessory: 18, headerBack: 24 } as const;
export const borderWidth = { control: 1.5, toggle: 1 } as const;

/** State opacity roles stay separate because their current perceptual weight is
 *  intentional. Naming them prevents near-duplicate feature-local values. */
export const stateOpacity = {
  buttonDisabled: 0.45,
  iconDisabled: 0.4,
  controlDisabled: 0.5,
  fieldDisabled: 0.6,
  pressed: 0.85,
  calendarDisabled: 0.3,
  dragActive: 0.96,
} as const;

/** Platform-neutral ordering plus the Android elevation for a picked-up row. */
export const layer = { dragActive: 10 } as const;
export const elevation = { dragActive: 6 } as const;

/** The toggle is custom on every platform, so its geometry is one contract. */
export const toggleSize = { width: 46, height: 28, padding: 3 } as const;

// Every face listed here must be loaded in `_layout.tsx` and used by a `type.*`
// scale or an explicit fontFamily — an unused weight is ~340 KB of TTF and one
// more blocking fetch behind the font-load grace.
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  // Editorial serif for headings + hero figures (Warm Organic aesthetic).
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
  button: { fontSize: 15, fontFamily: font.medium },
  buttonCompact: { fontSize: 13, fontFamily: font.medium },
  field: { fontSize: 15, fontFamily: font.regular },
  moneyInput: { fontSize: 17, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
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
export const toggleThumbShadow = { boxShadow: "0 1px 3px rgba(15, 15, 13, 0.22)" } as const;

/** Stable foreground for deterministic, name-derived badge colours. */
export const generatedBadgeForeground = "#FFFFFF";

/** Tab bar metrics — the single source for the bar itself AND for overlays
 *  that must clear it (undo snackbar). Web gets extra height so Turkish
 *  descenders (ç/ğ) aren't clipped, and a floor because mobile web reports no
 *  bottom inset. */
/**
 * The floating tab bar.
 *
 * The safe-area inset sits UNDER the bar, not inside it. While the bar was
 * docked to the bottom edge its height had to swallow the home indicator, so
 * its bottom padding was always larger than its top and the icons rode high in
 * a bar that was supposed to look symmetrical. A floating bar clears the
 * indicator by standing above it, which makes the padding even by construction.
 */
export const TAB_BAR = {
  /** The bar itself — content only, no safe area. */
  height: 56,
  webHeight: 60,
  /** Distance from the bar to the bottom edge when there is no home indicator. */
  minBottomGap: 10,
  /** Side inset of the bar, and the gap it keeps from the content above it. */
  sideInset: 12,
  gap: 10,
  /**
   * A floating bar that spans a 1440 px viewport stops reading as floating and
   * starts reading as a stretched pill — each of the five targets becomes
   * ~288 px wide. Bounded and centred it stays a bar on every width, sitting
   * under the same content column the screens are already limited to.
   */
  maxWidth: 560,
} as const;

export function tabBarHeight(isWeb: boolean): number {
  return isWeb ? TAB_BAR.webHeight : TAB_BAR.height;
}

/** How far the bar's own bottom edge sits above the screen's. */
export function tabBarBottomOffset(bottomInset: number): number {
  return Math.max(bottomInset, TAB_BAR.minBottomGap);
}

/**
 * Space a tab scene must leave under its content. The bar floats over the
 * scene, so react-navigation no longer reserves its height — this is the single
 * source every scroller and overlay reads instead of guessing an offset.
 */
export function tabBarClearance(bottomInset: number, isWeb: boolean): number {
  return tabBarHeight(isWeb) + tabBarBottomOffset(bottomInset) + TAB_BAR.gap;
}

export type ThemePreference = "system" | "light" | "dark";

export interface Theme {
  palette: Palette;
  scheme: "light" | "dark";
  paletteId: PaletteId;
}

export const ThemeContext = createContext<Theme>({
  palette: lightPalette,
  scheme: "light",
  paletteId: DEFAULT_PALETTE_ID,
});

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
