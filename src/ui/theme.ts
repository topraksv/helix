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
  background: "#F1EDE8",
  surface: "#FFFDFB",
  surfaceTranslucent: "#FFFDFBEB",
  surfaceAlt: "#E7DFD7",
  surfaceHover: "#D7CCC1",
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
  surfaceHover: "#352D28",
  surfaceStrong: "#473D36",
  border: "#5F534A",
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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * How wide a screen's content column is allowed to grow.
 *
 * These used to be per-route numbers, and the routes drifted: settings stopped
 * at 920 while the dashboard beside it ran to 1120 and the ledger to 1200, so
 * moving between two tabs on the same desktop shifted the whole page. The width
 * now follows the information structure, which is a property of the screen, not
 * a taste — and four names are enough to describe every surface Helix has.
 *
 * `wide` is a ceiling, not a target: it exists so a very large monitor cannot
 * stretch a table into unreadable line lengths, and everything below it simply
 * fills the column.
 */
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

/**
 * A circle, said once.
 *
 * Ten places wrote half of their own box as a literal — 15, 17, 19, 21, 28, 39,
 * 41, 48, 52, 64 — which is a circle only for as long as nobody edits the size
 * without editing the radius. `radius.full` also works for a square box, but it
 * says "pill" and reads as a guess next to a width; this says what it is.
 */
export function circle(size: number): number {
  return size / 2;
}

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
  loading: 1200,
  loadingReveal: 350,
  /** A figure counting to its new value. Long enough to be read as movement,
   *  short enough that the number is legible before the user looks away. */
  figure: 520,
  /** A chart drawing itself in once, after its data has settled. */
  draw: 620,
  /** An error the user has to notice without being shouted at: three
   *  oscillations inside the standard duration. */
  shake: 320,
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
} as const;

/** Shared control geometry. Keep compact visual controls distinct from the
 *  minimum interactive target: compact buttons use hitSlop to reach 44pt. */
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

/**
 * Intrinsic control width.
 *
 * A segmented control is a choice, not a banner. Given a whole desktop column it
 * stretched to it — three options across 1130 px, ~376 px per segment — and
 * stopped reading as one control. This is the same defect `TAB_BAR.maxWidth`
 * already fixes for navigation; it simply never propagated to the other control
 * that divides its container between equal children.
 *
 * The budget is per option so a two-way choice does not inherit the width a
 * six-way one needs, and the ceiling stops even a long row from spanning a wide
 * monitor. Below the cap nothing changes, which is every phone.
 */
export const controlWidth = {
  segmentedPerOption: 132,
  segmentedMax: 560,
} as const;

export function segmentedMaxWidth(optionCount: number): number {
  return Math.min(optionCount * controlWidth.segmentedPerOption, controlWidth.segmentedMax);
}

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
/**
 * `emoji` is a glyph used as an icon: a user-chosen category mark rendered by
 * the text engine rather than by lucide. It sizes with the other marks, not
 * with the copy beside it, so it belongs here and not in the type scale.
 */
export const iconSize = { compact: 15, control: 17, accessory: 18, headerBack: 24, emoji: 14 } as const;

/**
 * `selected` is the ring a chosen tile wears. It used to be written as
 * `selected ? 2 : 1` in five screens and `selected ? 1.5 : hairline` in two
 * more, so the same answer to the same question had three weights depending on
 * which file you were in.
 */
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

/**
 * Static font files carry one weight each, so tokens set fontFamily only —
 * never fontWeight (iOS would try to synthesize a second face).
 *
 * The serif carries the brand voice: the sign-in hero and every screen title.
 * It was Fraunces, a display face whose digit advances measured 978–1404 units
 * at 2000 upem — a **43.6% spread**, with no `tnum` feature to correct it — so
 * the rule was that it could never touch a figure: a balance updating in place
 * would visibly jump and a column of amounts would never align.
 *
 * IBM Plex Serif is drawn for technical and financial documents and does not
 * have that problem. Measured from the shipped `600SemiBold` TTF: every digit
 * advances exactly 600 units at 1000 upem — **0% spread, tabular by
 * construction**, no feature to request. Turkish is complete and ₺ (U+20BA) is
 * present, so a title never falls back mid-word.
 *
 * Dense numerics still stay Inter, whose `tnum` the amount roles below request:
 * Inter's own default spread is 58.8% and the feature is what corrects it.
 * A serif figure is for a hero, not for a table.
 */
export const type = {
  display: { fontSize: 40, fontFamily: font.serif, letterSpacing: -0.8 },
  title: { fontSize: 26, fontFamily: font.serif, letterSpacing: -0.2 },
  heading: { fontSize: 18, fontFamily: font.semibold, letterSpacing: -0.2 },
  /** A group's name inside a card, below the screen's own heading. */
  sectionTitle: { fontSize: 16, fontFamily: font.semibold, letterSpacing: -0.2 },
  body: { fontSize: 15, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.medium },
  small: { fontSize: 12, fontFamily: font.regular },
  /** What a figure beside it is called. */
  caption: { fontSize: 11, fontFamily: font.regular },
  /** The smallest text the app is allowed to draw: markers, eyebrows, the
   *  caption under a dense tile. Nothing may go below it — the sizes it
   *  replaces reached 9, which is 25% under the old floor. */
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

/**
 * Shadows take the live palette, always.
 *
 * There used to be `cardShadow` / `overlayShadow` / `toggleThumbShadow` /
 * `scrim` constants beside these, each evaluated once against `lightPalette`.
 * Four surfaces still imported them, so in dark mode the calculator, the
 * calendar and the undo bar drew an 8%-alpha warm-brown shadow where the theme
 * asks for 30% near-black — effectively no shadow at all — and every scrim in
 * the app was the light theme's 52% instead of the dark theme's 68%.
 */
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

/**
 * Navigation material.
 *
 * The bar floats over the content it navigates, and the point of floating is
 * that the page keeps going underneath — so the fill is a veil, not a lid. The
 * owner asked for as much glass as the label can survive, so both alphas are as
 * low as the ink allows: web can afford the thinner one because a real backdrop
 * blur removes the detail that would otherwise compete with an 11px label,
 * while native has no blur in this runtime and keeps a denser veil rather than
 * setting a label directly on whatever text scrolls behind it.
 *
 * The LABEL never takes any of this. Alpha belongs to the surface; the text on
 * top is painted at full strength, which is the whole difference between a
 * translucent panel and a faded one.
 *
 * Both are alpha over `surface`, so every contrast pair already proved against
 * `surface` still describes the ink on top.
 */
export const NAV_GLASS = {
  webAlpha: "70",
  nativeAlpha: "B0",
  blur: "blur(30px) saturate(180%)",
} as const;

export function navigationMaterial(surface: string, { glass, isWeb }: { glass: boolean; isWeb: boolean }): string {
  if (!glass) return surface;
  return surface + (isWeb ? NAV_GLASS.webAlpha : NAV_GLASS.nativeAlpha);
}

/**
 * Space a tab scene must leave for navigation.
 *
 * One function so a scene, the undo snackbar and the bar itself cannot disagree
 * about where navigation is. It briefly returned a left inset too, for a
 * desktop rail; the rail is gone — it pushed every page off centre and gave the
 * app two navigations to learn — and the shape stays a single owner rather than
 * scattering `tabBarClearance` back across three call sites.
 */
export function navigationInset({
  bottomInset,
  isWeb,
}: {
  bottomInset: number;
  isWeb: boolean;
}): { bottom: number; left: number } {
  return { bottom: tabBarClearance(bottomInset, isWeb), left: 0 };
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
