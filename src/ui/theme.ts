/** System/light/dark design tokens shared by native and web. */

import { createContext, useContext } from "react";
import type { MatrixColorToken } from "../domain/matrix-colors";

export interface Palette {
  // Yapısal nötrler: tema karakterini taşır ama ekranı tek renge boyamaz.
  background: string;
  surface: string;
  /** `surface` renginin `EB` alpha eklenmiş hali. */
  surfaceTranslucent: string;
  surfaceAlt: string;
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
  /**
   * The fourth contextual-mark hue: a yellow between amber and green.
   *
   * It exists because Mali Tablo's marks need four hues a person can tell
   * apart at a glance, and the semantic set had three. `warning` is an amber at
   * hue ~34°; this sits at ~54°, which is the separation that makes "gecikti"
   * and "kontrol edilmeli" two different colours rather than two shades of the
   * same one. Not a status role: nothing outside the marks should reach for it.
   */
  caution: string;
  cautionText: string;
  focus: string;
}

type SemanticPalette = Pick<Palette,
  | "destructive" | "onDestructive" | "error" | "errorText"
  | "success" | "successText" | "positive" | "positiveText"
  | "negative" | "negativeText" | "warning" | "warningText"
  | "caution" | "cautionText" | "focus"
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
  caution: "#877E2B",
  cautionText: "#665F1D",
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
  caution: "#C8C176",
  cautionText: "#DEDA9C",
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
  background: "#F1EDE8",
  surface: "#FFFDFB",
  surfaceTranslucent: "#FFFDFBEB",
  surfaceAlt: "#E7DFD7",
  surfaceStrong: "#C2B2A3",
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
  shadow: "rgba(63, 45, 34, 0.08)",
  shadowStrong: "rgba(63, 45, 34, 0.20)",
  scrim: "rgba(39, 29, 23, 0.52)",
  ...lightSemanticColors,
};

const amberDark: Palette = {
  background: "#090807",
  surface: "#191512",
  surfaceTranslucent: "#191512EB",
  surfaceAlt: "#27211D",
  surfaceStrong: "#473D36",
  border: "#807064",
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
// Petrol — nötr mineral taban, petrol mavisi ve küçük mercan karşılığı.
// ---------------------------------------------------------------------------
const petrolLight: Palette = {
  background: "#ECEEEE",
  surface: "#FEFEFD",
  surfaceTranslucent: "#FEFEFDEB",
  surfaceAlt: "#E6E9EA",
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
  secondary: "#5B7973",
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
  surfaceStrong: "#3A444A",
  border: "#687882",
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
  secondary: "#987F4D",
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
  surfaceStrong: "#414641",
  border: "#6F786F",
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

export const PALETTES: Record<PaletteId, { light: Palette; dark: Palette }> = {
  clay: { light: amberLight, dark: amberDark },
  ocean: { light: petrolLight, dark: petrolDark },
  forest: { light: serviLight, dark: serviDark },
};

/** Varsayılan marka paletini kullanan eski kodlar için geriye uyumlu alias'lar. */
export const lightPalette = PALETTES[DEFAULT_PALETTE_ID].light;
export const darkPalette = PALETTES[DEFAULT_PALETTE_ID].dark;

/** Eski veya bozuk tercihler güvenli biçimde varsayılan palete döner. */
export function resolvePaletteId(value: string | null): PaletteId {
  // `hasOwn`, not `in`: "constructor" is `in` every object.
  return value != null && Object.hasOwn(PALETTES, value) ? (value as PaletteId) : DEFAULT_PALETTE_ID;
}

/** Tema tercihi için aynısı: tanınmayan değer sistemi izler. */
export function resolveThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** How wide a content column may grow, by information structure; `wide` is a ceiling. */
export const contentWidth = {
  /** One decision at a time — sign-in, onboarding, recovery. */
  focus: 560,
  /** One object being edited, with its own explanation beside it. */
  form: 860,
  /** A primary work area plus the records or context it manages. */
  workspace: 1180,
  /** Dense financial data that earns the width it is given. */
  wide: 1560,
} as const;

export type ContentWidth = keyof typeof contentWidth;

// Crisp ledger geometry: enough softness for touch, never a stack of bubbles.
export const radius = { sm: 8, md: 10, lg: 14, xl: 18, full: 999 } as const;

/** A circle, said once: half the box. */
export function circle(size: number): number {
  return size / 2;
}

/** Context-specific rhythm keeps a dashboard breathable without making a
 * financial table wasteful. */
export const density = {
  dashboard: { sectionGap: spacing.xl, cardPadding: spacing.xl, rowGap: spacing.md },
  list: { sectionGap: spacing.lg, cardPadding: spacing.md, rowGap: spacing.sm },
} as const;

/** Named motion families. A duration belongs to a user-perceived event, not a
 * screen's private taste. Reduced motion still short-circuits every family. */
export const motion = {
  feedback: 120,
  standard: 220,
  settle: 420,
  loading: 1200,
  loadingReveal: 350,
  /** A pointer arriving on, or leaving, a control; longer than `feedback`, which at 120ms flickered as the pointer crossed a list. */
  hover: 170,
  /** A figure counting to its new value. Long enough to be read as movement,
   *  short enough that the number is legible before the user looks away. */
  figure: 900,
  /** A chart drawing itself in once, after its data has settled. */
  draw: 1150,
  /** Light to dark. Long, because it is the only moment the whole window
   *  changes at once and a snap of that size reads as a fault rather than as a
   *  choice — and because nothing is waiting on it. */
  theme: 600,
  /** An error the user has to notice without being shouted at: three
   *  oscillations inside the standard duration. */
  shake: 320,
  /** The ease-out every web CSS transition uses. */
  webEase: "cubic-bezier(0.22, 1, 0.36, 1)",
  spring: {
    entrance: { damping: 18, stiffness: 170, mass: 1 },
    toggle: { speed: 20, bounciness: 6 },
  },
  /**
   * A list arriving as a list rather than as a slab.
   *
   * `step` is the gap between neighbours and `budget` is the ceiling the whole
   * cascade must finish inside — past about half a second a stagger stops
   * reading as choreography and starts reading as lag, so a long list
   * compresses its step instead of running longer.
   */
  stagger: { step: 28, budget: 320 },
} as const;

/** One alpha of the palette's own ink, so a hover is the same step in every palette and on every surface. */
export const INTERACTION_ALPHA = { hover: 0.06, pressed: 0.11 } as const;

/** `alpha` of `tint` composited over an opaque `base`, both `#RRGGBB`. */
export function composite(base: string, tint: string, alpha: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(base, at) * (1 - alpha) + channel(tint, at) * alpha))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The delay an item at `index` waits before entering. */
export function staggerDelay(index: number, count = 1): number {
  if (index <= 0) return 0;
  const step = count > 1
    ? Math.min(motion.stagger.step, motion.stagger.budget / (count - 1))
    : motion.stagger.step;
  return Math.min(index * step, motion.stagger.budget);
}

/** Shared chart grammar: series meaning is chosen by the caller, geometry is
 * chosen here. The palette supplies semantic colors; charts never invent one. */
export const chart = {
  gridOpacity: 0.18,
  baselineOpacity: 0.58,
  lineWidth: 2.5,
  donutWidth: 20,
  markerRadius: 4,
  barRadius: 4,
  // Text inside an SVG obeys the type scale's floor; the centre sizes are ratios of the ring, which is drawn at 152, 236 or 300.
  axisFontSize: 10,
  axisFontSizeLarge: 11,
  centreLabelRatio: 0.062,
  centreValueRatio: 0.098,
  // A queried slice grows and the rest thin: emphasis by width, never by opacity, since any alpha breaks the ramp's 3:1.
  // `donutLift` thickens the chosen arc and `donutThin` narrows the rest, both about the same centre line.
  donutLift: 3,
  donutThin: 7,
} as const;

/** Categorical ramp outside the brand fan, separated by lightness as well as hue; the dark ramp keeps each hue. theme-contrast.test re-measures it. */
const chartSeries = {
  light: ["#9c3548", "#008a99", "#997026", "#005fa4", "#535f06", "#006853", "#007ec4", "#a56758"],
  dark: ["#dd6f7d", "#60c4d3", "#d8a95d", "#5f98e3", "#8d9741", "#50a58d", "#c7dffe", "#eaa594"],
} as const;

/** The series ramp for a scheme as a plain function, so a test can call what the hook memoizes. */
export function chartSeriesColors(scheme: "light" | "dark"): readonly string[] {
  return chartSeries[scheme];
}

/** WCAG 1.4.4's 200%, applied only where a box cannot grow with its text. */
export const maxFontScale = {
  /** A label inside a box whose width or height is a measured constant. */
  measuredBox: 2,
} as const;

export const controlSize = {
  compact: 36,
  minimumTarget: 44,
  regular: 48,
  segmented: 52,
  inputAccessoryWidth: 42,
  inputAccessoryInset: 44,
} as const;

export const loadingSize = {
  progressWidth: 120,
} as const;

/** A segmented control's width is per option, with a ceiling. */
const controlWidth = {
  segmentedPerOption: 132,
  segmentedMax: 560,
} as const;

export function segmentedMaxWidth(optionCount: number): number {
  return Math.min(optionCount * controlWidth.segmentedPerOption, controlWidth.segmentedMax);
}

/** `headerBack` is even so it centres on whole pixels at 1x/2x/3x. */
export const iconSize = { compact: 15, control: 17, accessory: 18, headerBack: 24 } as const;

export const borderWidth = { control: 1.5, toggle: 1, selected: 2 } as const;

/** State opacity roles stay separate because their current perceptual weight is
 *  intentional. Naming them prevents near-duplicate feature-local values. */
export const stateOpacity = {
  pressed: 0.85,
  /** A control that is present, explained and refused. */
  disabled: 0.45,
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
  // The brand voice. IBM Plex Serif is drawn for technical and financial
  // documents, and unlike the display serif it replaces its digits are
  // monospaced by construction — see the note below.
  serif: "IBMPlexSerif_600SemiBold",
} as const;

// One weight per static face, so fontFamily only, never fontWeight. Plex Serif's digits are tabular; dense numerics stay Inter with tnum.
export const type = {
  display: { fontSize: 40, fontFamily: font.serif, letterSpacing: -0.8 },
  title: { fontSize: 26, fontFamily: font.serif, letterSpacing: -0.2 },
  heading: { fontSize: 18, fontFamily: font.semibold, letterSpacing: -0.2 },
  /** A group's name inside a card, below the screen's own heading. */
  sectionTitle: { fontSize: 16, fontFamily: font.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.medium },
  /** No textTransform: it is locale-blind and turns Turkish "i" into "I"; use upperTR. */
  eyebrow: { fontSize: 11, fontFamily: font.semibold, letterSpacing: 1 },
  small: { fontSize: 12, fontFamily: font.regular },
  /** What a figure beside it is called. */
  caption: { fontSize: 11, fontFamily: font.regular },
  /** The smallest text the app is allowed to draw: markers, eyebrows, the
   *  caption under a dense tile. */
  micro: { fontSize: 10, fontFamily: font.medium },
  button: { fontSize: 15, fontFamily: font.medium },
  buttonCompact: { fontSize: 13, fontFamily: font.medium },
  /**
   * 16 is not a taste. Mobile Safari zooms the whole viewport when a focused
   * input renders below 16px, and it does not zoom back out on blur, so at 15
   * every text field in the app left the user on a magnified page they had to
   * pinch out of. WebKit picked 16 as the point where an input is legible
   * without the enlarged viewport.
   * https://webkit.org/blog/5610/more-responsive-tapping-on-ios/
   */
  field: { fontSize: 16, fontFamily: font.regular },
  /** A calculator key's glyph, sized to the pad rather than to prose. */
  keypad: { fontSize: 22, fontFamily: font.medium },
  moneyInput: { fontSize: 17, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
  amountLg: {
    fontSize: 38,
    fontFamily: font.bold,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums" as const],
  },
  /** The hero figure when the hero is a phone-width column. */
  amountMd: {
    fontSize: 30,
    fontFamily: font.bold,
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums" as const],
  },
  amount: { fontSize: 15, fontFamily: font.semibold, fontVariant: ["tabular-nums" as const] },
  amountSm: { fontSize: 12, fontFamily: font.medium, fontVariant: ["tabular-nums" as const] },
};

/** Prose leading, applied on web only: RNW's font shorthand resets line-height to ~1.21; a native line box cannot follow Dynamic Type. */
export const proseLeading = 1.5;

/**
 * The dense action tile used by equal-width action rails.
 *
 * The rail has one row for an icon, one for its title and one for its
 * explanation. Its height therefore belongs to the same token contract as
 * the spacing and type it contains; a screen must not guess a pixel height
 * when a Turkish title wraps on a narrow column.
 */
export const actionTile = {
  padding: spacing.sm,
  gap: spacing.xs,
  iconSize: controlSize.compact,
  lineBox: type.micro.fontSize * 1.2,
  lines: {
    wide: { label: 1, caption: 1 },
    compact: { label: 3, caption: 2 },
  },
} as const;

export function actionTileMetrics(compact: boolean) {
  const lines = compact ? actionTile.lines.compact : actionTile.lines.wide;
  const labelHeight = actionTile.lineBox * lines.label;
  const captionHeight = actionTile.lineBox * lines.caption;
  return {
    padding: actionTile.padding,
    gap: actionTile.gap,
    iconSize: actionTile.iconSize,
    lineBox: actionTile.lineBox,
    labelHeight,
    captionHeight,
    height: actionTile.padding * 2
      + actionTile.iconSize
      + actionTile.gap * 2
      + labelHeight
      + captionHeight,
  } as const;
}

/** Shadows take the live palette, always. */
export const themeShadow = {
  card: (palette: Palette) => ({ boxShadow: `0 8px 24px ${palette.shadow}` } as const),
  overlay: (palette: Palette) => ({ boxShadow: `0 16px 40px ${palette.shadowStrong}` } as const),
  toggleThumb: (palette: Palette) => ({ boxShadow: `0 1px 3px ${palette.shadowStrong}` } as const),
} as const;

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

/** The floating tab bar; the safe-area inset sits under it, so its padding is even. Web gets extra height so Turkish descenders are not clipped. */
export const TAB_BAR = {
  /** The bar itself — content only, no safe area. */
  height: 56,
  webHeight: 60,
  /** Distance from the bar to the bottom edge when there is no home indicator. */
  minBottomGap: 10,
  /** Side inset of the bar, and the gap it keeps from the content above it. */
  sideInset: 12,
  gap: 10,
  /** Bounded and centred, so the bar stays a bar at every width. */
  maxWidth: 560,
} as const;

export function tabBarHeight(isWeb: boolean): number {
  return isWeb ? TAB_BAR.webHeight : TAB_BAR.height;
}

/** How far the bar's own bottom edge sits above the screen's. */
export function tabBarBottomOffset(bottomInset: number): number {
  return Math.max(bottomInset, TAB_BAR.minBottomGap);
}

/** Navigation material: a veil, not a lid. Alpha belongs to the surface and the label on it is full strength; web is thinner because a real blur removes the detail behind it. */
export const NAV_GLASS = {
  webAlpha: "70",
  mobileWebAlpha: "80",
  nativeAlpha: "C0",
  blur: "blur(30px) saturate(180%)",
} as const;

export function navigationMaterial(surface: string, { glass, isWeb, compact = false }: { glass: boolean; isWeb: boolean; compact?: boolean }): string {
  if (!glass) return surface;
  return surface + (isWeb ? compact ? NAV_GLASS.mobileWebAlpha : NAV_GLASS.webAlpha : NAV_GLASS.nativeAlpha);
}

/**
 * Space a tab scene must leave under its content. The bar floats over the
 * scene, so this is the single source every scroller and overlay reads.
 */
export function navigationInset({ bottomInset, isWeb }: { bottomInset: number; isWeb: boolean }): { bottom: number } {
  return { bottom: tabBarHeight(isWeb) + tabBarBottomOffset(bottomInset) + TAB_BAR.gap };
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

/** 35% tint: the four hues separate while palette.text on the cell stays past AA. */
const MATRIX_MARK_FILL_ALPHA = "59";

const MARK_ROLE = { green: "success", yellow: "caution", orange: "warning", red: "error" } as const;

/**
 * A contextual mark from roles the theme already measures. `edge` is the full-strength 3px rule, `fill` the wash,
 * `ink` a mark on the fill (3:1, WCAG 1.4.11).
 */
export function matrixColorStyle(
  palette: Palette,
  token: MatrixColorToken,
): { fill: string; edge: string; ink: string } {
  const role = MARK_ROLE[token];
  return { fill: palette[role] + MATRIX_MARK_FILL_ALPHA, edge: palette[role], ink: palette[`${role}Text`] };
}
