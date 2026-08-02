/** System/light/dark design tokens shared by native and web. */

import { createContext, useContext } from "react";

export interface Palette {
  // Yapısal nötrler: tema karakterini taşır ama ekranı tek renge boyamaz.
  background: string;
  surface: string;
  /** `surface` renginin `EB` alpha eklenmiş hali. */
  surfaceTranslucent: string;
  surfaceAlt: string;
  surfaceHover: string;
  surfaceStrong: string;
  border: string;
  controlBorder: string;

  // Metin hiyerarşisi.
  textStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;

  // Birincil marka rengi: ana CTA, seçili navigasyon ve ana grafik serisi.
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  accentText: string;
  primaryText: string;
  onPrimary: string;

  // İkincil ve üçüncül vurgu aileleri. Genel yüzeylerde kullanılmazlar.
  secondary: string;
  secondaryStrong: string;
  secondarySoft: string;
  secondaryText: string;
  onSecondary: string;
  tertiary: string;
  tertiaryStrong: string;
  tertiarySoft: string;
  tertiaryText: string;
  onTertiary: string;

  // Temaya bağlı derinlik. Sabit sıcak gölge bütün temaları Clay'e çekmemeli.
  shadow: string;
  shadowStrong: string;
  scrim: string;

  // Semantik roller: anlamları tema değişse de sabit kalır.
  destructive: string;
  onDestructive: string;
  error: string;
  errorText: string;
  success: string;
  successText: string;
  /** Finansal yön rolleri; genel durum UI'ında kullanılmamalı. */
  positive: string;
  positiveText: string;
  negative: string;
  negativeText: string;
  warning: string;
  warningText: string;
  focus: string;
}

type SemanticPalette = Pick<Palette,
  | "destructive" | "onDestructive" | "error" | "errorText"
  | "success" | "successText" | "positive" | "positiveText"
  | "negative" | "negativeText" | "warning" | "warningText" | "focus"
>;

/**
 * Semantik renkler tema kimliğinden bağımsızdır. Tema değiştiğinde gelir hâlâ
 * yeşil, gider hâlâ kırmızı, uyarı hâlâ amber kalır. Böylece kullanıcı renk
 * anlamlarını her palette yeniden öğrenmek zorunda kalmaz.
 */
const lightSemanticColors = {
  destructive: "#A94F48",
  onDestructive: "#FBF4F1",
  error: "#A94F48",
  errorText: "#833832",
  success: "#4D775B",
  successText: "#365D43",
  positive: "#4D775B",
  positiveText: "#365D43",
  negative: "#A94F48",
  negativeText: "#833832",
  warning: "#9A703A",
  warningText: "#745126",
  focus: "#3C6F96",
} satisfies SemanticPalette;

const darkSemanticColors = {
  destructive: "#D77C74",
  onDestructive: "#3A2726",
  error: "#D77C74",
  errorText: "#F0A49E",
  success: "#82A68A",
  successText: "#B0CFB5",
  positive: "#82A68A",
  positiveText: "#B0CFB5",
  negative: "#D77C74",
  negativeText: "#F0A49E",
  warning: "#CFA667",
  warningText: "#E6C78F",
  focus: "#7EADD0",
} satisfies SemanticPalette;

/**
 * Tema mimarisi:
 * - Yüzeylerin büyük bölümü düşük doygunluklu nötrlerden oluşur.
 * - Tema kimliği primary + secondary + tertiary aileleriyle verilir.
 * - Bir tema "yeşil" diye bütün kartlar yeşile boyanmaz.
 * - Dark mod, nötr kömür tabanlıdır; tema tonu yüzeylerde yalnızca mikro miktarda hissedilir.
 */

// ---------------------------------------------------------------------------
// Signal — mineral paper, ink, copper and lichen. The palette treats the
// balance like an instrument: the field stays quiet and the signal is legible.
// ---------------------------------------------------------------------------
const amberLight: Palette = {
  background: "#E8EDE9",
  surface: "#FCFDF9",
  surfaceTranslucent: "#FCFDF9EB",
  surfaceAlt: "#E3E9E4",
  surfaceHover: "#D0DAD4",
  surfaceStrong: "#B7C4BC",
  border: "#7C8E84",
  controlBorder: "#52665C",
  textStrong: "#12231B",
  text: "#22362C",
  textSecondary: "#53675D",
  textMuted: "#5C6D64",
  primary: "#C8623D",
  primaryStrong: "#9E432D",
  primarySoft: "#F1D8CE",
  accentText: "#93412E",
  primaryText: "#3F2117",
  onPrimary: "#1F100B",
  secondary: "#477A78",
  secondaryStrong: "#335F5D",
  secondarySoft: "#D5E6E2",
  secondaryText: "#335F5D",
  onSecondary: "#F4FBF8",
  tertiary: "#B18A3B",
  tertiaryStrong: "#846428",
  tertiarySoft: "#EDE3C8",
  tertiaryText: "#745720",
  onTertiary: "#FFF9EE",
  shadow: "rgba(18, 35, 27, 0.10)",
  shadowStrong: "rgba(18, 35, 27, 0.22)",
  scrim: "rgba(11, 22, 17, 0.52)",
  ...lightSemanticColors,
};

const amberDark: Palette = {
  background: "#081012",
  surface: "#111C1D",
  surfaceTranslucent: "#111C1DEB",
  surfaceAlt: "#1C2B2B",
  surfaceHover: "#273A38",
  surfaceStrong: "#3A504C",
  border: "#536D67",
  controlBorder: "#91A9A0",
  textStrong: "#F2F5EC",
  text: "#E2EAE2",
  textSecondary: "#B1C2B8",
  textMuted: "#92A59A",
  primary: "#E28760",
  primaryStrong: "#C56847",
  primarySoft: "#3A2924",
  accentText: "#F0A383",
  primaryText: "#FFF0E8",
  onPrimary: "#24140E",
  secondary: "#76B2AA",
  secondaryStrong: "#5A928B",
  secondarySoft: "#213C3A",
  secondaryText: "#B1D5CE",
  onSecondary: "#0F211F",
  tertiary: "#D1AA5D",
  tertiaryStrong: "#B28A43",
  tertiarySoft: "#3B3221",
  tertiaryText: "#E4C982",
  onTertiary: "#201A0F",
  shadow: "rgba(0, 0, 0, 0.34)",
  shadowStrong: "rgba(0, 0, 0, 0.56)",
  scrim: "rgba(5, 12, 13, 0.72)",
  ...darkSemanticColors,
};

// ---------------------------------------------------------------------------
// Petrol — nötr mineral taban, petrol mavisi ve küçük mercan karşılığı.
// ---------------------------------------------------------------------------
const petrolLight: Palette = {
  background: "#ECEEEE",
  surface: "#FEFEFD",
  surfaceTranslucent: "#FEFEFDEB",
  surfaceAlt: "#E6E9EA",
  surfaceHover: "#D4D9DB",
  surfaceStrong: "#C1C8CB",
  border: "#808B91",
  controlBorder: "#5E6B72",
  textStrong: "#20292E",
  text: "#2B353A",
  textSecondary: "#566268",
  textMuted: "#626D72",
  primary: "#315F78",
  primaryStrong: "#244C63",
  primarySoft: "#DCE8EE",
  accentText: "#284F65",
  primaryText: "#20292E",
  onPrimary: "#F7FAFB",
  secondary: "#63847D",
  secondaryStrong: "#4E6C66",
  secondarySoft: "#DFE9E6",
  secondaryText: "#44645D",
  onSecondary: "#F6FAF8",
  tertiary: "#A8604C",
  tertiaryStrong: "#874937",
  tertiarySoft: "#F0E0DA",
  tertiaryText: "#7E4434",
  onTertiary: "#FFF9F6",
  shadow: "rgba(28, 37, 42, 0.06)",
  shadowStrong: "rgba(28, 37, 42, 0.18)",
  scrim: "rgba(24, 29, 32, 0.50)",
  ...lightSemanticColors,
};

const petrolDark: Palette = {
  background: "#0B0D0F",
  surface: "#15191C",
  surfaceTranslucent: "#15191CEB",
  surfaceAlt: "#20262A",
  surfaceHover: "#2B3338",
  surfaceStrong: "#3A444A",
  border: "#536068",
  controlBorder: "#89969D",
  textStrong: "#F1F3F3",
  text: "#E2E6E7",
  textSecondary: "#B8C0C4",
  textMuted: "#98A3A8",
  primary: "#7FAAC2",
  primaryStrong: "#628FA8",
  primarySoft: "#263842",
  accentText: "#AFCCE0",
  primaryText: "#F1F3F3",
  onPrimary: "#1B2A32",
  secondary: "#91B1A9",
  secondaryStrong: "#75978F",
  secondarySoft: "#2D3D39",
  secondaryText: "#C2D7D1",
  onSecondary: "#202C29",
  tertiary: "#D08C79",
  tertiaryStrong: "#B4715F",
  tertiarySoft: "#44312D",
  tertiaryText: "#EDB9AA",
  onTertiary: "#2D201D",
  shadow: "rgba(0, 0, 0, 0.30)",
  shadowStrong: "rgba(0, 0, 0, 0.52)",
  scrim: "rgba(4, 5, 6, 0.70)",
  ...darkSemanticColors,
};

// ---------------------------------------------------------------------------
// Servi — sıcak nötr taban, koyu servi ve ölçülü pirinç/yaban eriği.
// ---------------------------------------------------------------------------
const serviLight: Palette = {
  background: "#ECEBE7",
  surface: "#FFFDF9",
  surfaceTranslucent: "#FFFDF9EB",
  surfaceAlt: "#E8E6DF",
  surfaceHover: "#D5D3CB",
  surfaceStrong: "#C5C2B8",
  border: "#817E74",
  controlBorder: "#625F56",
  textStrong: "#292C29",
  text: "#343734",
  textSecondary: "#60645F",
  textMuted: "#60645F",
  primary: "#3D5D49",
  primaryStrong: "#2E4938",
  primarySoft: "#DFE7E1",
  accentText: "#35513F",
  primaryText: "#292C29",
  onPrimary: "#F4F7F1",
  secondary: "#8A7346",
  secondaryStrong: "#6E5A35",
  secondarySoft: "#ECE5D5",
  secondaryText: "#66532F",
  onSecondary: "#1A1A12",
  tertiary: "#885966",
  tertiaryStrong: "#704551",
  tertiarySoft: "#EADDE0",
  tertiaryText: "#69414C",
  onTertiary: "#F9F3F4",
  shadow: "rgba(39, 42, 39, 0.06)",
  shadowStrong: "rgba(39, 42, 39, 0.18)",
  scrim: "rgba(29, 31, 29, 0.50)",
  ...lightSemanticColors,
};

const serviDark: Palette = {
  background: "#0C0D0C",
  surface: "#171917",
  surfaceTranslucent: "#171917EB",
  surfaceAlt: "#232623",
  surfaceHover: "#303430",
  surfaceStrong: "#414641",
  border: "#596059",
  controlBorder: "#8B938C",
  textStrong: "#F0F2ED",
  text: "#E2E7E1",
  textSecondary: "#BBC5BA",
  textMuted: "#9AA69A",
  primary: "#8FAB94",
  primaryStrong: "#739078",
  primarySoft: "#2B3830",
  accentText: "#BED1C0",
  primaryText: "#F0F2ED",
  onPrimary: "#263128",
  secondary: "#B1AA76",
  secondaryStrong: "#96905F",
  secondarySoft: "#403D2C",
  secondaryText: "#D9D4A6",
  onSecondary: "#29271B",
  tertiary: "#BE8E95",
  tertiaryStrong: "#A4747C",
  tertiarySoft: "#443335",
  tertiaryText: "#DFC0C4",
  onTertiary: "#2D2123",
  shadow: "rgba(0, 0, 0, 0.30)",
  shadowStrong: "rgba(0, 0, 0, 0.52)",
  scrim: "rgba(5, 6, 5, 0.70)",
  ...darkSemanticColors,
};

export type PaletteId = "clay" | "ocean" | "forest";

export const DEFAULT_PALETTE_ID: PaletteId = "clay";
const PALETTE_IDS = ["clay", "ocean", "forest"] as const satisfies readonly PaletteId[];

export const PALETTES: Record<PaletteId, { light: Palette; dark: Palette }> = {
  clay: { light: amberLight, dark: amberDark },
  ocean: { light: petrolLight, dark: petrolDark },
  forest: { light: serviLight, dark: serviDark },
};

/** Varsayılan marka paletini kullanan eski kodlar için geriye uyumlu alias'lar. */
export const lightPalette = PALETTES[DEFAULT_PALETTE_ID].light;
export const darkPalette = PALETTES[DEFAULT_PALETTE_ID].dark;

function isPaletteId(value: string | null): value is PaletteId {
  return value != null && PALETTE_IDS.some((id) => id === value);
}

/** Eski veya bozuk tercihler güvenli biçimde varsayılan palete döner. */
export function resolvePaletteId(value: string | null): PaletteId {
  return isPaletteId(value) ? value : DEFAULT_PALETTE_ID;
}

/** @deprecated Yeni kodda `palette.scrim` kullan. */
export const scrim = lightPalette.scrim;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Crisp ledger geometry: enough softness for touch, never a stack of bubbles.
export const radius = { sm: 8, md: 10, lg: 14, xl: 18, full: 999 } as const;

/** Context-specific rhythm keeps a dashboard breathable without making a
 * financial table wasteful or turning settings into a dense control panel. */
export const density = {
  dashboard: { sectionGap: spacing.xl, cardPadding: spacing.xl, rowGap: spacing.md },
  list: { sectionGap: spacing.lg, cardPadding: spacing.md, rowGap: spacing.sm },
  settings: { sectionGap: spacing.lg, cardPadding: spacing.md, rowGap: spacing.xs },
  analytics: { sectionGap: spacing.lg, cardPadding: spacing.lg, rowGap: spacing.sm },
} as const;

/** Named motion families. A duration belongs to a user-perceived event, not a
 * screen's private taste. Reduced motion still short-circuits every family. */
export const motion = {
  feedback: 120,
  standard: 220,
  sheet: 320,
  settle: 420,
  waiting: 1600,
} as const;

/** Shared chart grammar: series meaning is chosen by the caller, geometry is
 * chosen here. The palette supplies semantic colors; charts never invent one. */
export const chart = {
  gridOpacity: 0.18,
  baselineOpacity: 0.58,
  lineWidth: 2.5,
  donutWidth: 20,
  markerRadius: 4,
  barRadius: 4,
} as const;

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
  pressed: 0.85,
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
  // Editorial serif is reserved for the one figure that benefits from it.
  serif: "Fraunces_600SemiBold",
  serifBold: "Fraunces_700Bold",
} as const;

/**
 * Static font files carry one weight each, so tokens set fontFamily only —
 * never fontWeight (iOS would try to synthesize a second face). Fraunces is
 * reserved for the hero figures; navigation, headings, labels and tables stay
 * in Inter so dense financial surfaces scan consistently.
 */
export const type = {
  display: { fontSize: 40, fontFamily: font.serifBold, letterSpacing: -0.8 },
  title: { fontSize: 26, fontFamily: font.semibold, letterSpacing: -0.45 },
  heading: { fontSize: 18, fontFamily: font.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.medium },
  small: { fontSize: 12, fontFamily: font.regular },
  button: { fontSize: 15, fontFamily: font.medium },
  buttonCompact: { fontSize: 13, fontFamily: font.medium },
  field: { fontSize: 15, fontFamily: font.regular },
  moneyInput: { fontSize: 17, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
  amountLg: {
    fontSize: 38,
    fontFamily: font.serifBold,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums" as const],
  },
  amount: { fontSize: 15, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
  amountSm: { fontSize: 12, fontFamily: font.medium, fontVariant: ["tabular-nums" as const] },
};

export const themeShadow = {
  card: (palette: Palette) => ({ boxShadow: `0 8px 24px ${palette.shadow}` } as const),
  overlay: (palette: Palette) => ({ boxShadow: `0 16px 40px ${palette.shadowStrong}` } as const),
  toggleThumb: (palette: Palette) => ({ boxShadow: `0 1px 3px ${palette.shadowStrong}` } as const),
} as const;

/** @deprecated Yeni kodda `themeShadow.card(palette)` kullan. */
export const cardShadow = themeShadow.card(lightPalette);
/** @deprecated Yeni kodda `themeShadow.overlay(palette)` kullan. */
export const overlayShadow = themeShadow.overlay(lightPalette);
/** @deprecated Yeni kodda `themeShadow.toggleThumb(palette)` kullan. */
export const toggleThumbShadow = themeShadow.toggleThumb(lightPalette);

/** The balance instrument stays neutral so the money outranks the theme. */
export function heroSurface(
  palette: Palette,
  scheme: "light" | "dark",
): { fill: string; ink: string } {
  return {
    fill: scheme === "light" ? palette.surface : palette.surfaceAlt,
    ink: palette.textStrong,
  };
}

/** Deterministik rozet renkleri için saf beyaz olmayan sabit foreground. */
export const generatedBadgeForeground = "#FBF6F1";

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

interface Theme {
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
