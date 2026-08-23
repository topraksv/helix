/**
 * The leaf layer of the design system: text roles, the two action controls, and
 * the small status marks. Nothing here renders another Helix component, so
 * nothing here can take part in an import cycle.
 *
 * It exists because `components.tsx` had grown to 2,483 lines holding forty
 * exports, which made every one of them a level-C change and forced a
 * `components ⇄ calculator` cycle: the calculator needed `Button` and
 * `FadeIn`, and the only place to get them was the module that also holds
 * everything else. `components.tsx` re-exports all of this, so no screen has
 * to know the split happened.
 */

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import type { LucideIcon } from "lucide-react-native";
import { formatMinorCompact } from "../domain/money";
import { initialAmountFontSize, nextAmountFontSize, type AmountScale } from "./amount-layout";
import { initialsBadgeColor } from "./badge-color";
import { haptic, type HapticKind } from "./haptics";
import { interactionSurface } from "./interaction";
import { useReducedMotion } from "./motion";
import { useCountUp } from "./motion-primitives";
import { LoadingIndicator } from "./loading-indicator";
import { upperTR } from "../i18n/tr";
import { borderWidth, controlSize, font, generatedBadgeForeground, iconSize, motion, proseLeading, radius, spacing, staggerDelay, stateOpacity, type, useTheme, type Palette } from "./theme";

export function controlStateStyle(palette: Palette, active: boolean, error = false) {
  return {
    backgroundColor: palette.surface,
    borderWidth: active || error ? borderWidth.control : StyleSheet.hairlineWidth,
    borderColor: error ? palette.error : active ? palette.focus : palette.controlBorder,
  };
}


/**
 * The chevron on anything that opens and closes.
 *
 * Every disclosure in the app swapped one glyph for another — `ChevronUp` for
 * `ChevronDown` — which is a cut, and a cut in the one control whose entire job
 * is to say that something is about to move. One glyph, rotated, is also one
 * icon import instead of two at each call site.
 */
export function DisclosureChevron({
  open,
  size = iconSize.control,
  color,
}: {
  open: boolean;
  size?: number;
  color?: string;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const settled = useRef(open);
  useEffect(() => {
    // A list of thirty closed disclosures should not run thirty 120ms
    // animations from a value to itself just because they mounted.
    if (settled.current === open) return;
    settled.current = open;
    if (reducedMotion) {
      progress.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: motion.feedback,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [open, progress, reducedMotion]);
  return (
    <Animated.View
      accessible={false}
      style={{ transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) }] }}
    >
      <ChevronDown accessible={false} size={size} color={color ?? palette.textSecondary} strokeWidth={2} />
    </Animated.View>
  );
}

/** Shared reduced-motion-aware entrance. */

export function FadeIn({
  children,
  delay = 0,
  rise = true,
  style,
  replayToken,
  testID,
  accessibilityViewIsModal,
  accessibilityRole,
  accessibilityLiveRegion,
}: {
  children: ReactNode;
  delay?: number;
  /**
   * Whether it lifts into place as well as fading.
   *
   * A block that REPLACES another one in the same box must not: the tour's
   * slides are keyed on the step, so each "next" restarted the rise and the
   * whole card visibly hopped. Something arriving into empty space still
   * lifts; something taking another's seat only fades.
   */
  rise?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Reset and replay without remounting the child tree. */
  replayToken?: string | number;
  testID?: string;
  accessibilityViewIsModal?: boolean;
  accessibilityRole?: ViewProps["accessibilityRole"];
  accessibilityLiveRegion?: ViewProps["accessibilityLiveRegion"];
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.spring(progress, {
      toValue: 1,
      delay,
      useNativeDriver: Platform.OS !== "web",
      ...motion.spring.entrance,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, reducedMotion, replayToken]);
  return (
    <Animated.View
      testID={testID}
      accessibilityViewIsModal={accessibilityViewIsModal}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [rise ? 10 : 0, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Screen scaffold with safe areas and bounded wide-screen content. */

export function Row({ children, style, gap = spacing.md, ...props }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
} & Omit<ViewProps, "children" | "style">) {
  return <View {...props} style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spread({ children, style, ...props }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
} & Omit<ViewProps, "children" | "style">) {
  return <View {...props} style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, style]}>{children}</View>;
}


/**
 * How many lines of text a leading mark still centres itself against.
 *
 * A mark beside a title-and-description block used to pin itself to the top of
 * that block, which put it level with the first line's cap height and left it
 * looking dropped in from above. Centring against the whole block is wrong the
 * other way: a five-line description drags the mark to the middle of a
 * paragraph it does not belong to.
 *
 * Three is the compromise the owner asked for — centre honestly while the text
 * is short, and past that behave as though the block were three lines, so the
 * mark keeps a little air above it and stops travelling.
 */
const LEDE_CENTRE_LINES = 3;

/**
 * Vertical alignment for a mark that leads a block of text.
 *
 * Measures the block and one line of it rather than assuming a line height:
 * the type scale sets `fontSize` only and lets each platform derive the line
 * box, so the number is different on iOS, Android and the web and only the
 * layout knows it.
 */
export function useLedeAlignment(markHeight: number) {
  const [blockHeight, setBlockHeight] = useState(0);
  const [lineHeight, setLineHeight] = useState(0);
  const cap = lineHeight > 0 ? lineHeight * LEDE_CENTRE_LINES : 0;
  const effective = cap > 0 ? Math.min(blockHeight, cap) : blockHeight;
  return {
    /** Spread onto the mark's own container. */
    markStyle: { marginTop: Math.max(0, Math.round((effective - markHeight) / 2)) },
    /**
     * For a trailing cluster whose height is its own business — a button, a
     * badge, a chevron. `markStyle` centres a KNOWN mark height; a 44pt action
     * given the 17pt icon's offset sat well above the text it belongs to.
     */
    blockStyle: { minHeight: effective, justifyContent: "center" as const },
    /** `onLayout` for the whole text block. */
    onBlockLayout: (event: LayoutChangeEvent) => setBlockHeight(event.nativeEvent.layout.height),
    /** `onLayout` for the block's first line — its title. */
    onLineLayout: (event: LayoutChangeEvent) => setLineHeight(event.nativeEvent.layout.height),
  };
}

export function Title({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text accessibilityRole="header" style={[type.title, { color: palette.textStrong, marginBottom: spacing.md }]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { palette } = useTheme();
  return <Text accessibilityRole="header" style={[type.heading, { color: palette.text, marginVertical: spacing.sm }, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
  ...props
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
} & Omit<TextProps, "children" | "style">) {
  const { palette } = useTheme();
  return (
    <Text
      {...props}
      style={[
        type.body,
        // Prose, and the only role that gets a line box. See `proseLeading`.
        Platform.OS === "web" && { lineHeight: Math.round(type.body.fontSize * proseLeading) },
        { color: muted ? palette.textSecondary : palette.text },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The small capital line that names the block under it.
 *
 * One component, so the ten hand-written eyebrows cannot go on disagreeing
 * about size, weight and letter-spacing — five recipes for one job.
 *
 * The CASING is done differently on each platform, and deliberately:
 *
 * Web keeps `textTransform`. The document is `lang="tr"`, and browsers case
 * per the document language, so it is already correct there — and it leaves
 * the real string in the DOM, which is what a screen reader reads. Uppercasing
 * the text itself would hand assistive technology "GÜNCEL BAKİYE", which some
 * screen readers spell out letter by letter.
 *
 * Native has neither of those. React Native's transform has no locale and maps
 * "i" to "I" rather than "İ" — GÜNCEL BAKIYE, NISAN, HAZIRAN, EKIM on the
 * shipped iOS and Android builds. So the string is cased here, correctly, and
 * the untouched original is handed to accessibility alongside it.
 */
export function Eyebrow({
  children,
  color,
  align,
  style,
}: {
  children: string;
  color?: string;
  align?: "left" | "center" | "right";
  style?: StyleProp<TextStyle>;
}) {
  const { palette } = useTheme();
  const web = Platform.OS === "web";
  return (
    <Text
      accessibilityLabel={web ? undefined : children}
      style={[
        type.eyebrow,
        { color: color ?? palette.textSecondary, textAlign: align },
        web && { textTransform: "uppercase" as const },
        style,
      ]}
    >
      {web ? children : upperTR(children)}
    </Text>
  );
}

export function Label({
  children,
  style,
  ...props
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
} & Omit<TextProps, "children" | "style">) {
  const { palette } = useTheme();
  return <Text {...props} style={[type.label, { color: palette.textSecondary, marginBottom: spacing.xs + 2 }, style]}>{children}</Text>;
}

/** Section title used between card groups. */

interface AmountProps {
  minor: number;
  currency?: string;
  large?: boolean;
  hero?: boolean;
  colorized?: boolean;
  color?: string;
  /**
   * Count to its value instead of appearing at it, on every arrival.
   *
   * Opt-in, and only for a surface's ONE hero figure. A table of amounts must
   * never do this: twelve numbers moving at once is noise, and the ledger's
   * whole job is to be read. The accessible label always carries the settled
   * figure, so assistive technology never hears the intermediate frames.
   */
  count?: boolean;
  /** Spoken settled figure when the visible text intentionally uses compact notation. */
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Money.
 *
 * Two components, one prop, and the split is the point: the ledger renders
 * hundreds of these, so the counting hook — and the navigation subscription it
 * needs to know when the screen was re-entered — must not exist on a cell that
 * never counts. Only the figure that asked for it pays for it.
 */
export function Amount(props: AmountProps) {
  return props.count ? <CountingAmount {...props} /> : <Figure {...props} />;
}

function CountingAmount(props: AmountProps) {
  return <Figure {...props} shownMinor={useCountUp(props.minor)} />;
}

function Figure({
  minor,
  currency = "TRY",
  large,
  hero,
  colorized = true,
  color,
  accessibilityLabel,
  style,
  testID,
  shownMinor,
}: AmountProps & { shownMinor?: number }) {
  const { palette } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const shown = shownMinor ?? minor;
  const resolved = color ?? (colorized && minor < 0 ? palette.negativeText : palette.text);
  const formatted = formatMinorCompact(shown, currency);
  const settled = formatMinorCompact(minor, currency);
  const scale: AmountScale = hero ? "hero" : large ? "large" : "regular";
  const requestedFontSize = StyleSheet.flatten(style)?.fontSize;
  const initialSize = typeof requestedFontSize === "number"
    ? Math.min(initialAmountFontSize(scale), requestedFontSize)
    : initialAmountFontSize(scale);
  // Width/font-scale changes start a fresh fit pass so rotation and Dynamic
  // Type can shrink or grow without opting out of system font scaling.
  const fitKey = `${settled}|${scale}|${width}|${fontScale}|${initialSize}`;
  const [fit, setFit] = useState({ key: fitKey, size: initialSize });
  const fittedSize = fit.key === fitKey ? fit.size : initialSize;
  const textRef = useRef<Text>(null);
  const availableWidth = useRef(0);
  const intrinsicWidth = useRef(0);
  const shouldProbeOverflow = scale !== "regular" || formatted.length > 10;
  const shrinkToNextStep = () => {
    const next = nextAmountFontSize(scale, fittedSize);
    if (next !== fittedSize) setFit({ key: fitKey, size: next });
  };
  useEffect(() => {
    if (Platform.OS !== "web" || !shouldProbeOverflow) return;
    const webNode = textRef.current as unknown as { scrollWidth?: number; clientWidth?: number } | null;
    if ((webNode?.scrollWidth ?? 0) <= (webNode?.clientWidth ?? 0) + 1) return;
    const next = nextAmountFontSize(scale, fittedSize);
    if (next !== fittedSize) setFit({ key: fitKey, size: next });
  }, [fitKey, fittedSize, formatted, scale, shouldProbeOverflow]);
  return (
    <Text
      ref={textRef}
      testID={testID}
      selectable
      accessibilityLabel={accessibilityLabel ?? settled}
      onTextLayout={(event) => {
        const widestLine = Math.max(...event.nativeEvent.lines.map((line) => line.width), 0);
        intrinsicWidth.current = widestLine;
        if (
          event.nativeEvent.lines.length <= 1
          && (availableWidth.current <= 0 || widestLine <= availableWidth.current + 1)
        ) return;
        shrinkToNextStep();
      }}
      onLayout={(event) => {
        // RN Web does not consistently dispatch onTextLayout. The DOM overflow
        // probe below catches a nowrap value whose glyphs are wider than its
        // flexed box; native still uses the line width and height signals.
        const layout = event.nativeEvent.layout;
        availableWidth.current = layout.width;
        const webNode = textRef.current as unknown as { scrollWidth?: number } | null;
        if (typeof webNode?.scrollWidth === "number") intrinsicWidth.current = webNode.scrollWidth;
        const singleLineBudget = fittedSize * fontScale * 1.7;
        if (layout.height > singleLineBudget || (shouldProbeOverflow && intrinsicWidth.current > layout.width + 1)) shrinkToNextStep();
      }}
      style={[
        large || hero ? type.amountLg : type.amount,
        { color: resolved, ...(large || hero ? { alignSelf: "stretch" as const } : null), flexShrink: 1, minWidth: 0, maxWidth: "100%", textAlign: "right" },
        style,
        // A caller may request a smaller starting role, but never gets to
        // override a measured fit on the final style layer. That override was
        // why a long negative figure could wrap again after Amount had already
        // walked down its font ladder.
        {
          fontSize: fittedSize,
          minWidth: 0,
          maxWidth: "100%",
          ...(Platform.OS === "web" ? ({ whiteSpace: "nowrap" } as unknown as TextStyle) : {}),
        },
      ]}
    >
      {formatted}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  tone,
  disabled,
  loading,
  icon: IconCmp,
  size = "md",
  haptic: hapticKind = "none",
  accessibilityHint,
  expanded,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  /**
   * What the action does to the money, for the quiet variants only.
   *
   * A row of "Alındı" and "Ödendi" buttons rendered as identical beige blocks:
   * the two opposite things you can confirm looked the same, and neither
   * belonged to the app's colour language. The fill stays quiet — this is a
   * list, not a call to action — and the outline and label carry the meaning.
   */
  tone?: "positive" | "primary";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  size?: "md" | "sm";
  haptic?: HapticKind;
  accessibilityHint?: string;
  expanded?: boolean;
  testID?: string;
}) {
  const { palette } = useTheme();
  const enabledColors = {
    primary: { background: palette.primary, foreground: palette.onPrimary },
    secondary: { background: palette.surfaceAlt, foreground: palette.text },
    danger: { background: palette.destructive, foreground: palette.onDestructive },
    ghost: { background: "transparent", foreground: palette.accentText },
  }[variant];
  const visuallyDisabled = Boolean(disabled && !loading);
  const colors = visuallyDisabled
    ? {
        background: variant === "ghost" ? "transparent" : palette.surfaceAlt,
        foreground: palette.textSecondary,
      }
    : enabledColors;
  const toneColor = tone === "positive" ? palette.positiveText : tone === "primary" ? palette.primaryText : null;
  const toned = toneColor != null && !visuallyDisabled && (variant === "secondary" || variant === "ghost");
  const small = size === "sm";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      aria-expanded={expanded}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading), expanded }}
      disabled={disabled || loading}
      // `hitSlop` used to stand in for the missing height. It does nothing on
      // the web, so a "small" button really was 36pt tall there. The box is the
      // minimum target now and the type scale keeps it reading as the compact
      // one; 44 against the regular 48 is a smaller step than 36 was, which
      // also settles the button-next-to-field alignment this file used to
      // work around per call site.
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={(state) => [
        {
          ...interactionSurface(palette, state, { base: colors.background, enabled: !visuallyDisabled }),
          borderRadius: radius.md,
          borderCurve: "continuous",
          paddingVertical: small ? spacing.sm : spacing.md + 1,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          minHeight: small ? controlSize.minimumTarget : controlSize.regular,
          flexDirection: "row",
          gap: spacing.sm,
          alignItems: "center",
          justifyContent: "center",
          // Three weights that cannot be confused: primary is a brand fill,
          // secondary is the same fill under a real outline, disabled is the
          // fill alone. They used to differ only in text colour, so a disabled
          // "Kaydet" and an enabled "Kaydet ve Yeni Ekle" rendered as the same
          // beige block and the form's primary action was unfindable.
          borderWidth: visuallyDisabled ? 0 : variant === "secondary" ? borderWidth.control : 0,
          borderColor: toned ? toneColor + "8C" : palette.controlBorder,
          opacity: state.pressed && variant === "danger" ? stateOpacity.pressed : 1,
          transform: [{ translateY: state.pressed && !visuallyDisabled ? 1 : 0 }],
        },
      ]}
    >
      {loading ? (
        <LoadingIndicator size={6} label={label} color={colors.foreground} />
      ) : (
        <>
          {IconCmp ? <IconCmp accessible={false} size={small ? iconSize.compact : iconSize.control} color={toned ? toneColor : colors.foreground} strokeWidth={2.2} /> : null}
          <Text
            style={[small ? type.buttonCompact : type.button, { color: toned ? toneColor : colors.foreground, textAlign: "center", flexShrink: 1 }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The shape of content that has not arrived.
 *
 * The app had one placeholder — two flat grey blocks in the dashboard's hero —
 * and nothing anywhere else, so a loading screen showed three different
 * behaviours at once: a grey box where the balance goes, three dots where the
 * data notice goes, and simply nothing where the other cards go. Then all of
 * it appeared in one frame and the page jumped twice.
 *
 * A skeleton is not a spinner and must not read as one: it says "something of
 * about this size is coming here". The pulse is deliberately slow and shallow
 * — a fast or high-contrast shimmer competes with the content that replaces
 * it — and Reduce Motion holds it still at the midpoint rather than removing
 * it, because the SHAPE is the message and only the movement is decoration.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius = radius.sm,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(reducedMotion ? 0.5 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: motion.loading, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: motion.loading, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);
  return (
    <Animated.View
      accessible={false}
      // The block is scenery while the real thing loads; the screen's own
      // `DataStateNotice` is what announces the wait.
      aria-hidden
      style={[
        {
          width,
          height,
          borderRadius: cornerRadius,
          backgroundColor: palette.surfaceAlt,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
        },
        style,
      ]}
    />
  );
}

/** Circular icon-only button (navigation arrows, close, inline actions). */

export function IconButton({
  icon: IconCmp,
  onPress,
  disabled,
  expanded,
  iconSize: iconSizeValue,
  tone = "default",
  size = controlSize.compact,
  label,
  haptic: hapticKind = "none",
}: {
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  expanded?: boolean;
  iconSize?: number;
  tone?: "default" | "danger" | "primary";
  size?: number;
  label?: string;
  haptic?: HapticKind;
}) {
  const { palette } = useTheme();
  const color = disabled
    ? palette.textSecondary
    : tone === "danger"
      ? palette.destructive
      : tone === "primary"
        ? palette.accentText
        : palette.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), ...(expanded == null ? {} : { expanded }) }}
      disabled={disabled}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      // The pressable box is the platform minimum; the painted chip inside it
      // is the compact one. `hitSlop` alone used to carry this, and it is a
      // no-op in react-native-web — only the legacy `Touchable` implements it —
      // so on the web every row's edit and delete control really was 32x32,
      // measured, while the code claimed 44.
      style={{
        minWidth: controlSize.minimumTarget,
        minHeight: controlSize.minimumTarget,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {(state) => (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius.sm,
            ...interactionSurface(palette, state, {
              base: tone === "primary" ? palette.primarySoft : palette.surface,
              enabled: !disabled,
            }),
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border + "90",
            transform: [{ translateY: state.pressed && !disabled ? 1 : 0 }],
          }}
        >
          <IconCmp accessible={false} size={iconSizeValue ?? Math.round(size * 0.5)} color={color} strokeWidth={2.2} />
        </View>
      )}
    </Pressable>
  );
}

/** Shared width for a status column and the control that replaces it. */
export const STATUS_W = 88;

export function Badge({
  text,
  tone = "muted",
  icon: IconCmp,
  testID,
}: {
  text: string;
  tone?: "muted" | "positive" | "negative" | "success" | "error" | "warning" | "primary";
  icon?: LucideIcon;
  testID?: string;
}) {
  const { palette } = useTheme();
  const colors = {
    muted: { bg: palette.surfaceAlt, fg: palette.textSecondary },
    positive: { bg: palette.positive + "1F", fg: palette.positiveText },
    negative: { bg: palette.negative + "1F", fg: palette.negativeText },
    success: { bg: palette.success + "1F", fg: palette.successText },
    error: { bg: palette.error + "1F", fg: palette.errorText },
    warning: { bg: palette.warning + "1F", fg: palette.warningText },
    primary: { bg: palette.primarySoft, fg: palette.primaryText },
  }[tone];
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.bg,
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: 3,
        // No `alignSelf`. It cannot be right for both axes: `flex-start` hung
        // the badge from the top of a row whose label wrapped, and `center`
        // then overrode `alignItems: flex-end` on the stacked budget rows and
        // left their badges floating mid-row. The container knows which axis it
        // is — rows already centre, and a COLUMN caller states its own
        // alignment so the badge shrinks to its text instead of stretching.
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
      }}
    >
      {IconCmp ? <IconCmp accessible={false} size={12} color={colors.fg} strokeWidth={2} /> : null}
      <Text style={[type.small, { color: colors.fg, fontFamily: font.medium, flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

/** Shared width for matching status and action controls. */

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />;
}

/**
 * Card list with separators only between rows.
 *
 * The rows arrive as a list: each one enters a beat after the one above it,
 * inside `motion.stagger.budget` however long the list is. A slab of twenty
 * rows appearing at once reads as a screenshot, and the cascade is the one
 * moment the app can show that these are separate things. Reduce Motion drops
 * every delay, so the list is simply present.
 */

/**
 * Progress as countable steps, not as a smear.
 *
 * The budget card already read this way and the owner liked it: ten segments
 * filling left to right says how much of the month is gone at a glance, and the
 * cascade says the figure was computed rather than painted. An instalment plan
 * has a natural step — 2 of 6 — so it takes one segment per instalment and the
 * bar answers "how many are left" without reading the label.
 *
 * `segments` is capped because past about a dozen the steps stop being
 * countable and a plain proportion is the honest picture.
 */
const MAX_SEGMENTS = 12;

export function SegmentBar({
  ratio,
  segments = 10,
  tone,
  height = 12,
}: {
  /** 0…1. Values outside are clamped, so an overspent budget fills completely. */
  ratio: number;
  segments?: number;
  tone?: string;
  height?: number;
}) {
  const { palette } = useTheme();
  const count = Math.max(1, Math.min(Math.round(segments), MAX_SEGMENTS));
  const filled = Math.max(0, Math.min(1, ratio));
  return (
    <View style={{ flexDirection: "row", gap: spacing.xs }}>
      {Array.from({ length: count }, (_, index) => {
        const segmentRatio = Math.max(0, Math.min(1, filled * count - index));
        return (
          <View
            key={index}
            style={{
              flex: 1,
              height,
              borderRadius: radius.sm - 2,
              backgroundColor: palette.surfaceAlt,
              overflow: "hidden",
            }}
          >
            {segmentRatio > 0 ? (
              <FadeIn
                delay={staggerDelay(index, count)}
                style={{
                  width: `${segmentRatio * 100}%` as `${number}%`,
                  height: "100%",
                  backgroundColor: tone ?? palette.positive,
                }}
              >
                <View />
              </FadeIn>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function InitialsBadge({ name, size = 36 }: { name: string; size?: number }) {
  const bg = initialsBadgeColor(name);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase("tr-TR") ?? "")
    .join("");
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: generatedBadgeForeground, fontSize: size * 0.38, fontFamily: font.semibold }}>{initials}</Text>
    </View>
  );
}
