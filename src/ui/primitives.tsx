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
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { ChevronDown, type LucideIcon } from "lucide-react-native";
import { formatMinor, formatMinorCompact } from "../domain/money";
import { initialAmountFontSize, nextAmountFontSize, type AmountScale } from "./amount-layout";
import { initialsBadgeColor } from "./badge-color";
import { haptic, type HapticKind } from "./haptics";
import { useReducedMotion } from "./motion";
import { useCountUp } from "./motion-primitives";
import { borderWidth, controlSize, font, generatedBadgeForeground, iconSize, motion, radius, spacing, staggerDelay, stateOpacity, type, useTheme, type Palette } from "./theme";

export function controlStateStyle(palette: Palette, active: boolean, error = false) {
  return {
    backgroundColor: palette.surface,
    borderWidth: active || error ? borderWidth.control : StyleSheet.hairlineWidth,
    borderColor: error ? palette.error : active ? palette.focus : palette.controlBorder,
  };
}

/**
 * Whether a pointer is resting on this control.
 *
 * react-native-web's `Pressable` already tracks hover and hands it to the style
 * callback — it re-renders on enter and leave whether or not anyone reads it —
 * so taking the flag from there costs nothing, while adding
 * `onHoverIn`/`onHoverOut` state of our own would have paid for the same render
 * twice. React Native's types only declare `pressed` (iOS and Android have no
 * pointer to hover with), which is why the read is written once here instead of
 * being cast at every control.
 *
 * Hover lands on the same fill as the press. A pointer gets the fill on
 * approach and the 1pt depression on contact; a finger, which cannot hover,
 * gets both at once and loses nothing.
 */
export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as { hovered?: boolean }).hovered === true;
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
    const anim = Animated.spring(progress, {
      toValue: 1,
      delay,
      useNativeDriver: Platform.OS !== "web",
      ...motion.spring.entrance,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, reducedMotion]);
  return (
    <Animated.View
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
export const LEDE_CENTRE_LINES = 3;

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
    <Text {...props} style={[type.body, { color: muted ? palette.textSecondary : palette.text }, style]}>
      {children}
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
  /** Render as ₺1,2 M when the column cannot hold the exact figure. */
  compact?: boolean;
  /**
   * Count to its value instead of appearing at it, on every arrival.
   *
   * Opt-in, and only for a surface's ONE hero figure. A table of amounts must
   * never do this: twelve numbers moving at once is noise, and the ledger's
   * whole job is to be read. The accessible label always carries the settled
   * figure, so assistive technology never hears the intermediate frames.
   */
  count?: boolean;
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
  compact = false,
  style,
  testID,
  shownMinor,
}: AmountProps & { shownMinor?: number }) {
  const { palette } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const shown = shownMinor ?? minor;
  const resolved = color ?? (colorized && minor < 0 ? palette.negativeText : palette.text);
  const formatted = compact ? formatMinorCompact(shown, currency) : formatMinor(shown, currency);
  const settled = compact ? formatMinorCompact(minor, currency) : formatMinor(minor, currency);
  const scale: AmountScale = hero ? "hero" : large ? "large" : "regular";
  // Width/font-scale changes start a fresh fit pass so rotation and Dynamic
  // Type can shrink or grow without opting out of system font scaling.
  const fitKey = `${settled}|${scale}|${width}|${fontScale}`;
  const initialSize = initialAmountFontSize(scale);
  const [fit, setFit] = useState({ key: fitKey, size: initialSize });
  const fittedSize = fit.key === fitKey ? fit.size : initialSize;
  const shrinkToNextStep = () => {
    const next = nextAmountFontSize(scale, fittedSize);
    if (next !== fittedSize) setFit({ key: fitKey, size: next });
  };
  return (
    <Text
      testID={testID}
      selectable
      accessibilityLabel={settled}
      onTextLayout={(event) => {
        if (event.nativeEvent.lines.length <= 1) return;
        shrinkToNextStep();
      }}
      onLayout={(event) => {
        // RN Web does not consistently dispatch onTextLayout. A wrapped value
        // is taller than one derived line box, so the platform-neutral layout
        // event provides the same fit signal without clipping or font caps.
        const singleLineBudget = fittedSize * fontScale * 1.7;
        if (event.nativeEvent.layout.height > singleLineBudget) shrinkToNextStep();
      }}
      style={[
        large || hero ? type.amountLg : type.amount,
        { color: resolved, flexShrink: 1, textAlign: "right" },
        { fontSize: fittedSize },
        style,
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
  const pressedBackground = {
    primary: palette.primaryStrong,
    secondary: palette.surfaceHover,
    danger: palette.destructive,
    ghost: palette.surfaceHover,
  }[variant];
  const toneColor = tone === "positive" ? palette.positiveText : tone === "primary" ? palette.primaryText : null;
  const toned = toneColor != null && !visuallyDisabled && (variant === "secondary" || variant === "ghost");
  const small = size === "sm";
  return (
    <Pressable
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
          backgroundColor: (state.pressed || isHovered(state)) && !visuallyDisabled ? pressedBackground : colors.background,
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
        <ActivityIndicator accessibilityLabel={label} color={colors.foreground} />
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
            backgroundColor: tone === "primary"
              ? palette.primarySoft
              : state.pressed || isHovered(state)
                ? palette.surfaceHover
                : palette.surface,
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
}: {
  text: string;
  tone?: "muted" | "positive" | "negative" | "success" | "error" | "warning" | "primary";
  icon?: LucideIcon;
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
export const MAX_SEGMENTS = 12;

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
        borderRadius: size / 3,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: generatedBadgeForeground, fontSize: size * 0.38, fontFamily: font.semibold }}>{initials}</Text>
    </View>
  );
}
