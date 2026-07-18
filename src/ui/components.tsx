/**
 * Shared UI primitives — the design system's single implementation point.
 * Accessible touch targets (min 44pt), TR money formatting, identical
 * rendering on iOS and web. Typeface: Inter; icons: lucide.
 */

import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSegments } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Calculator as CalculatorIcon, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, type LucideIcon } from "lucide-react-native";
import { formatMinor, formatMoneyInputLive, parseAmountExpression } from "../domain/money";
import { INPUT_LIMITS } from "../domain/input";
import { addMonthsToKey, type MonthKey } from "../domain/dates";
import { monthLabel, tr } from "../i18n/tr";
import type { LiveQueryStatus } from "../data/live-state";
import { haptic, selectionTap, selectionTapIfChanged, type HapticKind } from "./haptics";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { useReducedMotion } from "./motion";
import { useModalAccessibility } from "./accessibility";
import { shouldStackListActions } from "./responsive";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Springy press feedback used by tappable primitives — a small, quick scale-in
 * on press and a gentle settle back, giving surfaces a native-iOS liveliness
 * without attention-grabbing motion. Returns a stable animated scale value.
 */
function useSpringPress(pressedScale = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => () => scale.stopAnimation(), [scale]);
  // Interruptible by construction: each press starts a fresh spring from the
  // current (possibly mid-flight) value, so reversing never glitches.
  const onPressIn = () => reducedMotion
    ? scale.setValue(1)
    : Animated.spring(scale, { toValue: pressedScale, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => reducedMotion
    ? scale.setValue(1)
    : Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 36, bounciness: 9 }).start();
  return { scale, onPressIn, onPressOut };
}

/**
 * Motion system: one iOS-flavored entrance used everywhere — quick fade with
 * a soft rise (220ms, decelerating). Consistent across web and native, never
 * attention-grabbing.
 */
export function FadeIn({
  children,
  delay = 0,
  style,
  accessibilityViewIsModal,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityViewIsModal?: boolean;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    // Spring-driven entrance (mass/stiffness feel) — weighted and organic
    // rather than a fixed-duration curve, matching the app-wide motion system.
    const anim = Animated.spring(progress, {
      toValue: 1,
      delay,
      useNativeDriver: Platform.OS !== "web",
      damping: 18,
      stiffness: 170,
      mass: 1,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, reducedMotion]);
  return (
    <Animated.View
      accessibilityViewIsModal={accessibilityViewIsModal}
      style={[
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Screen scaffold: themed background, safe-area padding, optional large
 * title header (replaces the native header inside tabs so titles never
 * appear twice), and content centering on wide viewports.
 */
export function Screen({
  children,
  scroll = true,
  scrollEnabled = true,
  padded = true,
  title,
  subtitle,
  right,
  leading,
  maxWidth = 760,
  scrollRef,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Temporarily freeze vertical scrolling (e.g. during a drag reorder). */
  scrollEnabled?: boolean;
  padded?: boolean;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  /** Optional mark shown to the left of the title (e.g. the brand logo). */
  leading?: ReactNode;
  maxWidth?: number;
  /** Access to the vertical scroller for explicit workflow navigation. */
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const segments = useSegments();
  const wide = width > maxWidth + spacing.xl * 2;
  // Tab scenes already sit above the tab bar, whose own height reserves the
  // bottom safe-area inset — adding it again here just leaves dead space at the
  // end of a scroll. Only modal / stack scenes (no tab bar under them) need it.
  const inTabs = segments[0] === "(tabs)";
  const bottomPad = inTabs ? spacing.lg : Math.max(insets.bottom, spacing.lg) + spacing.md;
  // Content must clear the status bar / Dynamic Island on headerless full
  // screens. Titled screens already inset the top; the auth + onboarding
  // screens run with `headerShown: false` and no title, so they need it too
  // (otherwise the welcome header slid under the Dynamic Island). Modal/stack
  // screens keep the flat pad — their native header already reserves the inset,
  // so adding it here would double-pad them.
  const needsTopInset = title != null || segments[0] === "(auth)" || segments[0] === "(onboarding)";

  const header =
    title != null ? (
      <View style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[type.title, { color: palette.text }]}>{title}</Text>
          {subtitle ? (
            <Text style={[type.body, { color: palette.textMuted, marginTop: 2 }]}>{subtitle}</Text>
          ) : null}
        </View>
        {right}
      </View>
    ) : null;

  const inner: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: spacing.lg },
    { paddingTop: needsTopInset ? Math.max(insets.top, spacing.lg) : spacing.lg },
    { paddingBottom: bottomPad },
    wide && { width: "100%", maxWidth, alignSelf: "center" },
  ];

  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <FadeIn style={[{ flex: 1 }, inner]}>
          {header}
          {children}
        </FadeIn>
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={inner} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>
        <FadeIn>
          {header}
          {children}
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({
  children,
  style,
  onPress,
  onLayout,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  padded?: boolean;
}) {
  const { palette, scheme } = useTheme();
  const press = useSpringPress(0.985);
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      // Razor-thin border on both themes (editorial look), not a heavy shadow.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: padded ? spacing.lg : 0,
      marginBottom: spacing.md,
      overflow: "hidden",
    },
    scheme === "light" && cardShadow,
  ];
  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onLayout={onLayout}
        style={[base, style, { transform: [{ scale: press.scale }] }]}
        accessibilityRole="button"
      >
        {children}
      </AnimatedPressable>
    );
  }
  return <View style={[base, style]} onLayout={onLayout}>{children}</View>;
}

/** Gradient hero container (dashboard balance, auth brand panel). */
export function HeroCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { palette } = useTheme();
  return (
    <LinearGradient
      colors={[palette.gradientFrom, palette.gradientTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1.1, y: 1.2 }}
      style={[
        { borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.md, overflow: "hidden" },
        style,
      ]}
    >
      {children}
    </LinearGradient>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text accessibilityRole="header" style={[type.title, { color: palette.text, marginBottom: spacing.md }]}>{children}</Text>;
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
    <Text {...props} style={[type.body, { color: muted ? palette.textMuted : palette.text }, style]}>
      {children}
    </Text>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { palette } = useTheme();
  return <Text style={[type.label, { color: palette.textMuted, marginBottom: spacing.xs + 2 }, style]}>{children}</Text>;
}

/** Section title used between card groups. */
export function SectionHeader({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        type.label,
        {
          color: palette.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          fontSize: 12,
          marginBottom: spacing.sm,
          marginTop: spacing.sm,
        },
      ]}
    >
      {children}
    </Text>
  );
}

/** Signed money text: red for negatives, tabular figures. */
export function Amount({
  minor,
  currency = "TRY",
  large,
  colorized = true,
  color,
  style,
}: {
  minor: number;
  currency?: string;
  large?: boolean;
  colorized?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { palette } = useTheme();
  const resolved = color ?? (colorized && minor < 0 ? palette.negativeText : palette.text);
  const formatted = formatMinor(minor, currency);
  // Keep full figures legible by stepping the font down as the string grows.
  // Fixed table cells use formatMinorCompact; exact detail totals can pair this
  // with an unconstrained horizontal container as a final no-wrap fallback.
  const fittedSize = formatted.length > 22
    ? (large ? 15 : 11)
    : formatted.length > 18
      ? (large ? 19 : 12)
      : formatted.length > 15
        ? (large ? 24 : 13)
        : undefined;
  return (
    <Text
      style={[
        large ? type.amountLg : type.amount,
        { color: resolved, flexShrink: 1, textAlign: "right" },
        fittedSize == null ? null : { fontSize: fittedSize },
        style,
      ]}
    >
      {formatted}
    </Text>
  );
}

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

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon: IconCmp,
  size = "md",
  haptic: hapticKind = "light",
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  size?: "md" | "sm";
  haptic?: HapticKind;
  accessibilityHint?: string;
}) {
  const { palette } = useTheme();
  const background =
    variant === "primary"
      ? palette.primary
      : variant === "danger"
        ? palette.negative
        : variant === "secondary"
          ? palette.surfaceAlt
          : "transparent";
  const color =
    variant === "primary"
      ? palette.onPrimary
      : variant === "danger"
        ? palette.onNegative
        : variant === "ghost"
          ? palette.primaryText
          : palette.text;
  const small = size === "sm";
  const press = useSpringPress(0.97);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      // A small button's visual height stays compact (36) to fit inline rows,
      // but hitSlop lifts its effective touch target to the ~44pt minimum.
      hitSlop={small ? 8 : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={[
        {
          backgroundColor: background,
          borderRadius: radius.sm + 2,
          paddingVertical: small ? spacing.sm : spacing.md + 1,
          paddingHorizontal: small ? spacing.md : spacing.lg,
          minHeight: small ? 36 : 48,
          flexDirection: "row",
          gap: spacing.sm,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: press.scale }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel={label} color={color} />
      ) : (
        <>
          {IconCmp ? <IconCmp accessible={false} size={small ? 15 : 17} color={color} strokeWidth={2.2} /> : null}
          <Text
            style={[type.label, { color, fontSize: small ? 13 : 15, textAlign: "center", flexShrink: 1 }]}
          >
            {label}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}

/** Circular icon-only button (navigation arrows, close, inline actions). */
export function IconButton({
  icon: IconCmp,
  onPress,
  disabled,
  tone = "default",
  size = 36,
  label,
  haptic: hapticKind = "light",
}: {
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
  size?: number;
  label?: string;
  haptic?: HapticKind;
}) {
  const { palette } = useTheme();
  const color = tone === "danger" ? palette.negativeText : tone === "primary" ? palette.primaryText : palette.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <IconCmp accessible={false} size={size * 0.5} color={color} strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * Month navigator: ‹ Temmuz 2026 › — reused by the transaction form (which
 * month an entry belongs to), the installments view and anywhere a period is
 * stepped. `min`/`max` (inclusive) disable stepping past a bound.
 */
export function MonthStepper({
  value,
  onChange,
  min,
  max,
}: {
  value: MonthKey;
  onChange: (m: MonthKey) => void;
  min?: MonthKey;
  max?: MonthKey;
}) {
  const canPrev = !min || value > min;
  const canNext = !max || value < max;
  return (
    <Spread style={{ marginBottom: spacing.md }}>
      <IconButton icon={ChevronLeft} label={tr.common.previous} disabled={!canPrev} onPress={() => onChange(addMonthsToKey(value, -1))} />
      <Heading style={{ marginVertical: 0 }}>{monthLabel(value)}</Heading>
      <IconButton icon={ChevronRight} label={tr.common.next} disabled={!canNext} onPress={() => onChange(addMonthsToKey(value, 1))} />
    </Spread>
  );
}

export function Field({
  label,
  error,
  secure,
  style,
  noMargin = false,
  ...props
}: TextInputProps & { label?: string; error?: string | null; secure?: boolean; noMargin?: boolean }) {
  const { palette } = useTheme();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure === true);
  const maxLength = props.maxLength ?? (
    props.multiline
      ? INPUT_LIMITS.note
      : secure || props.secureTextEntry
        ? INPUT_LIMITS.password
        : props.keyboardType === "email-address" || props.inputMode === "email"
          ? INPUT_LIMITS.email
          : props.keyboardType === "number-pad" || props.keyboardType === "numeric"
            ? INPUT_LIMITS.numeric
            : INPUT_LIMITS.text
  );
  return (
    <View style={{ marginBottom: noMargin ? 0 : spacing.md }}>
      {label ? <Text nativeID={labelId} style={[type.label, { color: palette.textMuted, marginBottom: spacing.xs + 2 }]}>{label}</Text> : null}
      <View>
        <TextInput
          placeholderTextColor={palette.textMuted}
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityLabelledBy={label ? labelId : props.accessibilityLabelledBy}
          accessibilityHint={error ? [props.accessibilityHint, tr.a11y.fieldError(error)].filter(Boolean).join(". ") : props.accessibilityHint}
          accessibilityState={{ ...props.accessibilityState, disabled: props.editable === false }}
          maxLength={maxLength}
          secureTextEntry={secure ? hidden : props.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            {
              backgroundColor: palette.surfaceAlt,
              color: palette.text,
              borderRadius: radius.sm,
              borderWidth: 1.5,
              borderColor: error ? palette.negative : focused ? palette.focus : palette.controlBorder,
              paddingHorizontal: spacing.md,
              paddingRight: secure ? 44 : spacing.md,
              minHeight: 48,
              fontSize: 15,
              fontFamily: "Inter_400Regular",
            },
            // Multiline reads as an intentional text area: taller, top-aligned.
            props.multiline
              ? { minHeight: 88, paddingTop: spacing.md, paddingBottom: spacing.md, textAlignVertical: "top" as const }
              : null,
            style,
          ]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? tr.a11y.showPassword : tr.a11y.hidePassword}
            accessibilityHint={label}
            onPress={() => setHidden(!hidden)}
            hitSlop={8}
            style={{ position: "absolute", right: spacing.md, top: 0, bottom: 0, justifyContent: "center" }}
          >
            {hidden ? <Eye accessible={false} size={18} color={palette.textMuted} /> : <EyeOff accessible={false} size={18} color={palette.textMuted} />}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.small, { color: palette.negativeText, marginTop: spacing.xs }]}>{error}</Text> : null}
    </View>
  );
}

/** TR money input ("1.234,56") with a popup calculator; reports minor units.
 *  Parses sum expressions too ("400+500" → 900); pass `expression` to surface a
 *  keyboard with +/- operators (otherwise a clean decimal pad). */
export function MoneyField({
  label,
  value,
  onChangeMinor,
  placeholder = "0,00",
  expression = false,
  disabled = false,
  accessibilityLabel,
}: {
  label?: string;
  value: string;
  onChangeMinor: (raw: string, minor: number | null) => void;
  placeholder?: string;
  expression?: boolean;
  disabled?: boolean;
  /** Screen-reader label when a nearby visible section heading labels the field. */
  accessibilityLabel?: string;
}) {
  const { palette } = useTheme();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [focused, setFocused] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const calculatorTriggerRef = useRef<View>(null);
  // Display is the live-grouped form; parsing accepts single amounts and sums
  // ("400+500"), grouped or ungrouped, so an initial "15000,00" shows as
  // "15.000,00" and a typed sum evaluates.
  const display = formatMoneyInputLive(value);
  const minor = value.trim() === "" ? null : parseAmountExpression(display);
  const invalid = value.trim() !== "" && minor === null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text nativeID={labelId} style={[type.label, { color: palette.textMuted, marginBottom: spacing.xs + 2 }]}>{label}</Text> : null}
      <View>
        <TextInput
          value={display}
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityLabelledBy={label ? labelId : undefined}
          accessibilityHint={invalid ? tr.a11y.fieldError(tr.common.amountLimit) : undefined}
          accessibilityState={{ disabled }}
          maxLength={INPUT_LIMITS.money}
          editable={!disabled}
          onChangeText={(raw) => {
            const formatted = formatMoneyInputLive(raw);
            onChangeMinor(formatted, formatted.trim() === "" ? null : parseAmountExpression(formatted));
          }}
          keyboardType={expression ? "numbers-and-punctuation" : "decimal-pad"}
          inputMode={expression ? "text" : "decimal"}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            backgroundColor: palette.surfaceAlt,
            color: invalid ? palette.negativeText : disabled ? palette.textMuted : palette.text,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: invalid ? palette.negative : focused ? palette.focus : palette.controlBorder,
            paddingHorizontal: spacing.md,
            paddingRight: 44,
            minHeight: 48,
            fontSize: 17,
            fontFamily: "Inter_600SemiBold",
            fontVariant: ["tabular-nums"],
            opacity: disabled ? 0.6 : 1,
          }}
        />
        {disabled ? null : (
          <Pressable
            ref={calculatorTriggerRef}
            accessibilityRole="button"
            accessibilityLabel={tr.a11y.openCalculator}
            accessibilityHint={accessibilityLabel ?? label}
            onPress={() => setCalcOpen(true)}
            hitSlop={8}
            style={{ position: "absolute", right: spacing.md, top: 0, bottom: 0, justifyContent: "center" }}
          >
            <CalculatorIcon accessible={false} size={18} color={palette.textMuted} />
          </Pressable>
        )}
      </View>
      {invalid ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.small, { color: palette.negativeText, marginTop: spacing.xs }]}>{tr.common.amountLimit}</Text> : null}
      {calcOpen ? (
        <LazyCalculatorModal
          returnFocusRef={calculatorTriggerRef}
          onClose={() => setCalcOpen(false)}
          onResult={(major) => {
            const raw = (Math.round(major * 100) / 100).toFixed(2).replace(".", ",");
            onChangeMinor(raw, parseAmountExpression(raw));
          }}
        />
      ) : null}
    </View>
  );
}

/** Indirection avoids a static components ⇄ calculator import cycle. */
function LazyCalculatorModal(props: { onClose: () => void; onResult: (major: number) => void; returnFocusRef?: React.RefObject<View | null> }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CalculatorModal } = require("./calculator") as typeof import("./calculator");
  return <CalculatorModal {...props} />;
}

/** Dropdown select: field-styled trigger opening a modal option list. */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const { palette, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const modalTitleRef = useModalAccessibility(open, triggerRef);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder ?? current?.label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            backgroundColor: palette.surfaceAlt,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: open ? palette.focus : palette.controlBorder,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[type.body, { color: current ? palette.text : palette.textMuted, flex: 1 }]}
        >
          {current?.label ?? placeholder ?? ""}
        </Text>
        <ChevronDown accessible={false} size={17} color={palette.textMuted} />
      </Pressable>
      {open ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
          <Pressable
            accessible={false}
            style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", justifyContent: "center", padding: spacing.lg }}
            onPress={() => setOpen(false)}
          >
            <Pressable accessible={false} accessibilityViewIsModal onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 380 }}>
              <FadeIn
                style={[
                  { backgroundColor: palette.surface, borderRadius: radius.lg, paddingVertical: spacing.sm, maxHeight: 420 },
                  scheme === "light" && cardShadow,
                ]}
              >
                <View ref={modalTitleRef} accessible accessibilityRole="header" tabIndex={-1}>
                  <Text style={[type.heading, { color: palette.text, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }]}>
                    {label ?? tr.a11y.selectOption}
                  </Text>
                </View>
                <ScrollView>
                  {options.map((option) => {
                    const selected = option.value === value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        aria-checked={selected}
                        accessibilityState={{ checked: selected, selected }}
                        onPress={() => {
                          onChange(option.value);
                          setOpen(false);
                        }}
                        style={({ pressed }) => [
                          {
                            paddingHorizontal: spacing.lg,
                            paddingVertical: spacing.md,
                            backgroundColor: selected ? palette.primarySoft : pressed ? palette.surfaceAlt : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            type.body,
                            { color: selected ? palette.primaryText : palette.text, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </FadeIn>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

/** Horizontal segmented selector. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  noMargin = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  noMargin?: boolean;
}) {
  const { palette, scheme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: palette.surfaceAlt,
        borderRadius: radius.sm + 2,
        padding: 3,
        marginBottom: noMargin ? 0 : spacing.md,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              selectionTapIfChanged(value, option.value);
              onChange(option.value);
            }}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected }}
            style={[
              {
                flex: 1,
                paddingVertical: spacing.sm + 2,
                borderRadius: radius.sm - 1,
                alignItems: "center",
                backgroundColor: selected ? palette.surface : "transparent",
                borderWidth: 1.5,
                borderColor: selected ? palette.primaryText : "transparent",
              },
              selected && scheme === "light" && cardShadow,
            ]}
          >
            <Text
              style={[
                type.label,
                // Constant metrics: only color changes on selection, so labels
                // never shift or look off-center when the thumb moves.
                { color: selected ? palette.text : palette.textMuted, fontFamily: "Inter_600SemiBold", textAlign: "center" },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Simple chip-row picker (categories, sources, persons); `multi` toggles a set. */
export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
  multi,
  values,
  onToggle,
}: {
  options: { value: T; label: string }[];
  value?: T | null;
  onChange?: (v: T) => void;
  multi?: boolean;
  values?: T[];
  onToggle?: (v: T) => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}>
      {options.map((option) => {
        const selected = multi ? (values ?? []).includes(option.value) : option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (multi) {
                selectionTap();
                onToggle?.(option.value);
              } else {
                selectionTapIfChanged(value, option.value);
                onChange?.(option.value);
              }
            }}
            accessibilityRole={multi ? "checkbox" : "radio"}
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected }}
            hitSlop={4}
            style={{
              paddingVertical: spacing.sm + 2,
              paddingHorizontal: spacing.md + 2,
              borderRadius: radius.full,
              borderWidth: 1.5,
              borderColor: selected ? palette.primaryText : palette.controlBorder,
              backgroundColor: selected ? palette.primarySoft : palette.surface,
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <Text
              style={[
                type.label,
                {
                  color: selected ? palette.primaryText : palette.text,
                  fontFamily: selected ? "Inter_600SemiBold" : "Inter_500Medium",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({ text, tone = "muted" }: { text: string; tone?: "muted" | "positive" | "negative" | "warning" | "primary" }) {
  const { palette } = useTheme();
  const colors = {
    muted: { bg: palette.surfaceAlt, fg: palette.textMuted },
    positive: { bg: palette.positive + "1F", fg: palette.positiveText },
    negative: { bg: palette.negative + "1F", fg: palette.negativeText },
    warning: { bg: palette.warning + "1F", fg: palette.warningText },
    primary: { bg: palette.primarySoft, fg: palette.primaryText },
  }[tone];
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={[type.small, { color: colors.fg, fontFamily: "Inter_500Medium" }]}>{text}</Text>
    </View>
  );
}

/** Shared action-slot width so a status pill and an action button form a
 *  symmetric, equally sized pair in a list row (dashboard "Yaklaşan Ödemeler"). */
export const STATUS_W = 88;

/** A status pill sized to match a small Button (same height and corner), so a
 *  status + action pair reads as one aligned unit. Fills the STATUS_W slot. */
export function StatusPill({ label, color, foreground = color }: { label: string; color: string; foreground?: string }) {
  return (
    <View
      style={{
        width: STATUS_W,
        minHeight: 36,
        borderRadius: radius.sm + 2,
        backgroundColor: color + "1F",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.sm,
      }}
    >
      <Text
        style={[type.label, { color: foreground, fontSize: 13, textAlign: "center" }]}
      >
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({ icon: IconCmp, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ padding: spacing.xxl, alignItems: "center", gap: spacing.sm }}>
      {IconCmp ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: palette.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.xs,
          }}
        >
          <IconCmp accessible={false} size={26} color={palette.textMuted} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
      {hint ? <Text style={[type.body, { color: palette.textMuted, textAlign: "center" }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * Honest feedback for local live-query failures. Last known data stays visible
 * while stale; a first-load failure is never presented as a genuine empty
 * account. Refreshing is intentionally quiet because the current snapshot is
 * still valid and most refreshes finish within a frame or two.
 */
export function DataStateNotice({
  status,
  retry,
}: {
  status: LiveQueryStatus;
  retry: () => void;
}) {
  const { palette } = useTheme();
  if (status === "ready" || status === "refreshing") return null;
  if (status === "loading") {
    return (
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={tr.dataState.loading}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md }}
      >
        <ActivityIndicator accessibilityLabel={tr.dataState.loading} color={palette.primary} />
        <Body muted>{tr.dataState.loading}</Body>
      </View>
    );
  }
  const stale = status === "stale";
  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={{
        backgroundColor: (stale ? palette.warning : palette.negative) + "14",
        borderColor: (stale ? palette.warning : palette.negative) + "55",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        gap: spacing.sm,
      }}
    >
      <Body>{stale ? tr.dataState.stale : tr.dataState.error}</Body>
      <View style={{ alignSelf: "flex-start" }}>
        <Button size="sm" variant="secondary" label={tr.common.retry} onPress={retry} />
      </View>
    </View>
  );
}

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />;
}

/**
 * A Card that renders a list of items with dividers *between* them only —
 * never a trailing line under the last (or only) row — and renders nothing at
 * all when the list is empty (no stray empty box). The single reusable answer
 * for every settings/list screen.
 */
export function CardList<T>({
  items,
  keyExtractor,
  renderItem,
  header,
  style,
  padded = true,
}: {
  items: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  header?: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Card style={style} padded={padded}>
      {header}
      {items.map((item, i) => (
        <React.Fragment key={keyExtractor(item, i)}>
          {i > 0 ? <Divider /> : null}
          {renderItem(item, i)}
        </React.Fragment>
      ))}
    </Card>
  );
}

/**
 * List row: icon chip + title/subtitle + right accessory. The workhorse of
 * settings and list screens.
 */
export function ListRow({
  icon: IconCmp,
  iconColor,
  leading,
  title,
  subtitle,
  right,
  onPress,
  chevron = false,
  stackRightOnNarrow = false,
}: {
  icon?: LucideIcon;
  iconColor?: string;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  /** Moves a wide action cluster below the label on phone-width viewports. */
  stackRightOnNarrow?: boolean;
}) {
  const { palette } = useTheme();
  const { width } = useWindowDimensions();
  const stackRight = Boolean(right && stackRightOnNarrow && shouldStackListActions(width));
  const content = (
    <View style={{ paddingVertical: spacing.md - 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      {leading}
      {IconCmp ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            backgroundColor: iconColor ? iconColor + "1F" : palette.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconCmp accessible={false} size={18} color={iconColor ?? palette.primary} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: palette.text, fontFamily: "Inter_500Medium" }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.small, { color: palette.textMuted, marginTop: 1 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {stackRight ? null : right}
      {chevron ? <ChevronRight accessible={false} size={17} color={palette.textMuted} /> : null}
      </View>
      {stackRight ? (
        <View style={{ marginTop: spacing.sm, marginLeft: IconCmp || leading ? 36 + spacing.md : 0, alignItems: "flex-end" }}>
          {right}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return <PressableRow onPress={onPress}>{content}</PressableRow>;
}

/** List row wrapper with the shared springy press feedback. */
function PressableRow({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const press = useSpringPress(0.98);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={{ transform: [{ scale: press.scale }] }}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Themed on/off toggle — a hand-built pill (not RN's bare `Switch`) so it looks
 * identical on iOS, Android and web and belongs to the warm-organic system. The
 * platform Switch renders the OS green on web/Android and ignored our track
 * tint; this animates its own track colour (border → clay) and springs the
 * thumb across, matching the app's motion language.
 */
const TOGGLE_W = 46;
const TOGGLE_H = 28;
const TOGGLE_PAD = 3;
const TOGGLE_THUMB = TOGGLE_H - TOGGLE_PAD * 2;
export function Toggle({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(value ? 1 : 0);
      return;
    }
    const animation = Animated.spring(progress, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 20, bounciness: 6 });
    animation.start();
    return () => animation.stop();
  }, [value, progress, reducedMotion]);
  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [palette.controlBorder, palette.primary] });
  const thumbX = progress.interpolate({ inputRange: [0, 1], outputRange: [TOGGLE_PAD, TOGGLE_W - TOGGLE_THUMB - TOGGLE_PAD] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={10}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View style={{ width: TOGGLE_W, height: TOGGLE_H, borderRadius: TOGGLE_H / 2, backgroundColor: trackColor, justifyContent: "center" }}>
        <Animated.View
          style={{
            width: TOGGLE_THUMB,
            height: TOGGLE_THUMB,
            borderRadius: TOGGLE_THUMB / 2,
            backgroundColor: palette.onPrimary,
            transform: [{ translateX: thumbX }],
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Initials avatar with a deterministic hue from the name (logo fallback). */
export function InitialsBadge({ name, size = 36 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const bg = `hsl(${hash}, 42%, 46%)`;
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
      <Text style={{ color: "#fff", fontSize: size * 0.38, fontFamily: "Inter_600SemiBold" }}>{initials}</Text>
    </View>
  );
}
