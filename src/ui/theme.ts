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
// Amber — reçine sıcaklığı: keten taban, pişmiş toprak, zeytin ve eskitilmiş pirinç.
// ---------------------------------------------------------------------------
const amberLight: Palette = {
  background: "#ECE5DC",
  surface: "#FBF8F4",
  surfaceTranslucent: "#FBF8F4EB",
  surfaceAlt: "#E9E1D8",
  surfaceHover: "#DDD0C2",
  surfaceStrong: "#CDBCAA",
  border: "#8B796A",
  controlBorder: "#6D5B4D",
  textStrong: "#2A211B",
  text: "#3A3028",
  textSecondary: "#62564C",
  textMuted: "#6D6157",
  primary: "#A55335",
  primaryStrong: "#88432D",
  primarySoft: "#EED8CC",
  accentText: "#7B3A28",
  primaryText: "#2A211B",
  onPrimary: "#FBF4EF",
  secondary: "#6C7047",
  secondaryStrong: "#585C39",
  secondarySoft: "#E2E1C9",
  secondaryText: "#555937",
  onSecondary: "#FAF8F0",
  tertiary: "#91672F",
  tertiaryStrong: "#765226",
  tertiarySoft: "#EDDFC5",
  tertiaryText: "#775624",
  onTertiary: "#FBF7EE",
  shadow: "rgba(63, 45, 34, 0.10)",
  shadowStrong: "rgba(63, 45, 34, 0.22)",
  scrim: "rgba(39, 29, 23, 0.52)",
  ...lightSemanticColors,
};

const amberDark: Palette = {
  background: "#121110",
  surface: "#1E1B19",
  surfaceTranslucent: "#1E1B19EB",
  surfaceAlt: "#282421",
  surfaceHover: "#342F2B",
  surfaceStrong: "#443E38",
  border: "#62574E",
  controlBorder: "#8F8176",
  textStrong: "#F2ECE6",
  text: "#E5DDD6",
  textSecondary: "#BEB2A8",
  textMuted: "#9D9289",
  primary: "#D88967",
  primaryStrong: "#BE6B4A",
  primarySoft: "#3C2A22",
  accentText: "#E7A68B",
  primaryText: "#F2ECE6",
  onPrimary: "#2C1D17",
  secondary: "#A3A774",
  secondaryStrong: "#898E5E",
  secondarySoft: "#3A3B2B",
  secondaryText: "#CED1A5",
  onSecondary: "#25261B",
  tertiary: "#CAA05F",
  tertiaryStrong: "#AD8549",
  tertiarySoft: "#443824",
  tertiaryText: "#E3C187",
  onTertiary: "#2D2416",
  shadow: "rgba(9, 7, 6, 0.30)",
  shadowStrong: "rgba(9, 7, 6, 0.50)",
  scrim: "rgba(10, 8, 7, 0.68)",
  ...darkSemanticColors,
};

// ---------------------------------------------------------------------------
// Çelik — inci ve ıslak taş taban, tavlanmış çelik mavisi, deniz köpüğü ve mercan.
// ---------------------------------------------------------------------------
const celikLight: Palette = {
  background: "#E7ECEB",
  surface: "#FAFBF9",
  surfaceTranslucent: "#FAFBF9EB",
  surfaceAlt: "#E2EAE9",
  surfaceHover: "#CEDBDB",
  surfaceStrong: "#B7CACB",
  border: "#71858B",
  controlBorder: "#566B72",
  textStrong: "#223138",
  text: "#2A3A40",
  textSecondary: "#586A70",
  textMuted: "#586A70",
  primary: "#356B7F",
  primaryStrong: "#285469",
  primarySoft: "#D3E5EA",
  accentText: "#285669",
  primaryText: "#223138",
  onPrimary: "#F4F8F7",
  secondary: "#6F988F",
  secondaryStrong: "#587E76",
  secondarySoft: "#DCEAE3",
  secondaryText: "#496C64",
  onSecondary: "#1F2A26",
  tertiary: "#B67661",
  tertiaryStrong: "#985E4D",
  tertiarySoft: "#EEDDD7",
  tertiaryText: "#875345",
  onTertiary: "#211A17",
  shadow: "rgba(42, 66, 76, 0.10)",
  shadowStrong: "rgba(42, 66, 76, 0.22)",
  scrim: "rgba(28, 47, 55, 0.50)",
  ...lightSemanticColors,
};

const celikDark: Palette = {
  background: "#101315",
  surface: "#1A1E20",
  surfaceTranslucent: "#1A1E20EB",
  surfaceAlt: "#242A2C",
  surfaceHover: "#2F3639",
  surfaceStrong: "#3F4649",
  border: "#58666C",
  controlBorder: "#8C9DA3",
  textStrong: "#EFF2F2",
  text: "#E1E6E6",
  textSecondary: "#BAC5C7",
  textMuted: "#99A6A9",
  primary: "#86B4C3",
  primaryStrong: "#6D9CAB",
  primarySoft: "#2A3A40",
  accentText: "#B9D7DF",
  primaryText: "#EFF2F2",
  onPrimary: "#203037",
  secondary: "#9ABDAE",
  secondaryStrong: "#7FA393",
  secondarySoft: "#31433C",
  secondaryText: "#C8DDD3",
  onSecondary: "#202D27",
  tertiary: "#CF9582",
  tertiaryStrong: "#B57A68",
  tertiarySoft: "#493633",
  tertiaryText: "#EAC0B3",
  onTertiary: "#2F211E",
  shadow: "rgba(7, 10, 12, 0.30)",
  shadowStrong: "rgba(7, 10, 12, 0.50)",
  scrim: "rgba(8, 12, 14, 0.68)",
  ...darkSemanticColors,
};

// ---------------------------------------------------------------------------
// Orman — mantar taşı taban, servi, liken ve yabani meyve tonları.
// ---------------------------------------------------------------------------
const serviLight: Palette = {
  background: "#E9E9E1",
  surface: "#FAF9F4",
  surfaceTranslucent: "#FAF9F4EB",
  surfaceAlt: "#E4E3DB",
  surfaceHover: "#D2D1C7",
  surfaceStrong: "#BEBDB1",
  border: "#7A7E70",
  controlBorder: "#5D6256",
  textStrong: "#293028",
  text: "#2E362D",
  textSecondary: "#5C665B",
  textMuted: "#5F6A5F",
  primary: "#42654B",
  primaryStrong: "#304D38",
  primarySoft: "#D7E2D5",
  accentText: "#35543D",
  primaryText: "#293028",
  onPrimary: "#F4F7F1",
  secondary: "#8B8456",
  secondaryStrong: "#706A45",
  secondarySoft: "#E6E2CB",
  secondaryText: "#66613E",
  onSecondary: "#1A1A12",
  tertiary: "#8C5F64",
  tertiaryStrong: "#71494E",
  tertiarySoft: "#E7D8DA",
  tertiaryText: "#694349",
  onTertiary: "#F9F3F4",
  shadow: "rgba(48, 58, 49, 0.10)",
  shadowStrong: "rgba(48, 58, 49, 0.22)",
  scrim: "rgba(32, 41, 34, 0.50)",
  ...lightSemanticColors,
};

const serviDark: Palette = {
  background: "#121413",
  surface: "#1C201C",
  surfaceTranslucent: "#1C201CEB",
  surfaceAlt: "#262B26",
  surfaceHover: "#323833",
  surfaceStrong: "#424944",
  border: "#5B665C",
  controlBorder: "#89948A",
  textStrong: "#F0F2ED",
  text: "#E2E7E1",
  textSecondary: "#BBC5BA",
  textMuted: "#9AA69A",
  primary: "#8FAB94",
  primaryStrong: "#739078",
  primarySoft: "#2C3A30",
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
  shadow: "rgba(7, 10, 8, 0.30)",
  shadowStrong: "rgba(7, 10, 8, 0.50)",
  scrim: "rgba(8, 11, 9, 0.68)",
  ...darkSemanticColors,
};

export type PaletteId = "clay" | "ocean" | "forest";

export const DEFAULT_PALETTE_ID: PaletteId = "clay";
export const PALETTE_IDS = ["clay", "ocean", "forest"] as const satisfies readonly PaletteId[];

export const PALETTE_META = {
  clay: {
    label: "Sonbahar",
    description: "Keten, pişmiş toprak, zeytin ve eskitilmiş pirinç.",
  },
  ocean: {
    label: "Gelgit",
    description: "İnci, derin akıntı, deniz köpüğü ve soluk mercan.",
  },
  forest: {
    label: "Orman",
    description: "Mantar taşı, servi, liken ve yabani meyve.",
  },
} as const satisfies Record<PaletteId, { label: string; description: string }>;

export const PALETTES: Record<PaletteId, { light: Palette; dark: Palette }> = {
  clay: { light: amberLight, dark: amberDark },
  ocean: { light: celikLight, dark: celikDark },
  forest: { light: serviLight, dark: serviDark },
};

/** Varsayılan marka paletini kullanan eski kodlar için geriye uyumlu alias'lar. */
export const lightPalette = PALETTES.clay.light;
export const darkPalette = PALETTES.clay.dark;

export function isPaletteId(value: string | null): value is PaletteId {
  return value != null && PALETTE_IDS.some((id) => id === value);
}

/** Eski veya bozuk tercihler güvenli biçimde varsayılan palete döner. */
export function resolvePaletteId(value: string | null): PaletteId {
  return isPaletteId(value) ? value : DEFAULT_PALETTE_ID;
}

export function resolvePalette(paletteId: PaletteId, scheme: "light" | "dark"): Palette {
  return PALETTES[paletteId][scheme];
}

/** @deprecated Yeni kodda `palette.scrim` kullan. */
export const scrim = lightPalette.scrim;

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

export const themeShadow = {
  card: (palette: Palette) => ({ boxShadow: `0 2px 10px ${palette.shadow}` } as const),
  overlay: (palette: Palette) => ({ boxShadow: `0 6px 20px ${palette.shadowStrong}` } as const),
  toggleThumb: (palette: Palette) => ({ boxShadow: `0 1px 3px ${palette.shadowStrong}` } as const),
} as const;

/** @deprecated Yeni kodda `themeShadow.card(palette)` kullan. */
export const cardShadow = themeShadow.card(lightPalette);
/** @deprecated Yeni kodda `themeShadow.overlay(palette)` kullan. */
export const overlayShadow = themeShadow.overlay(lightPalette);
/** @deprecated Yeni kodda `themeShadow.toggleThumb(palette)` kullan. */
export const toggleThumbShadow = themeShadow.toggleThumb(lightPalette);

/** Deterministik rozet renkleri için saf beyaz olmayan sabit foreground. */
/**
 * The dashboard's balance slab: fill and ink, chosen per scheme.
 *
 * Both schemes want the same thing — the DEEP end of the accent with cream type
 * on it — but they keep it in different tokens. `primary` is deep in light and
 * deliberately light in dark, where it has to stay legible as small text and
 * marks; filling a whole card with the dark `primary` turned the top of the
 * screen into glare. `primarySoft` is the deep one there.
 *
 * `tests/theme-contrast.test.ts` measures this pair for every palette, so the
 * slab can never be assembled from two tokens that were never checked together.
 */
export function heroSurface(
  palette: Palette,
  scheme: "light" | "dark",
): { fill: string; ink: string; inset: string } {
  return scheme === "light"
    // `inset` goes DEEPER, not lighter. Lightening the slab for the nested
    // control pulled the cream label down to 4.0:1 on it — axe caught it — and
    // the accent already has a darker step for exactly this.
    ? { fill: palette.primary, ink: palette.onPrimary, inset: palette.primaryStrong }
    // Dark keeps the slab NEUTRAL. Filled with the accent's soft tint it was the
    // largest coloured area on screen and turned each dark theme into a wash of
    // one hue — "ekran komple masmavi, yemyeşil". An elevated charcoal anchors
    // the balance just as well, and the theme is carried by the accent on small
    // elements, where a strong colour reads as deliberate instead of as a filter
    // laid over the whole app.
    : { fill: palette.surfaceStrong, ink: palette.textStrong, inset: palette.textStrong + "14" };
}

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