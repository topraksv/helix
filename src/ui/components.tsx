/**
 * Shared UI primitives — the design system's single implementation point.
 * Accessible touch targets (min 44pt), TR money formatting, identical
 * rendering on iOS and web. Typeface: Inter; icons: lucide.
 */

import React, { useEffect, useRef, useState, type ReactNode } from "react";
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
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSegments } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Calculator as CalculatorIcon, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, type LucideIcon } from "lucide-react-native";
import { formatMinor, formatMoneyInputLive, parseAmountExpression } from "../domain/money";
import { addMonthsToKey, type MonthKey } from "../domain/dates";
import { monthLabel, tr } from "../i18n/tr";
import { lightTap, selectionTap } from "./haptics";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Springy press feedback used by tappable primitives — a small, quick scale-in
 * on press and a gentle settle back, giving surfaces a native-iOS liveliness
 * without attention-grabbing motion. Returns a stable animated scale value.
 */
function useSpringPress(pressedScale = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  // Interruptible by construction: each press starts a fresh spring from the
  // current (possibly mid-flight) value, so reversing never glitches.
  const onPressIn = () => Animated.spring(scale, { toValue: pressedScale, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 36, bounciness: 9 }).start();
  return { scale, onPressIn, onPressOut };
}

/**
 * Motion system: one iOS-flavored entrance used everywhere — quick fade with
 * a soft rise (220ms, decelerating). Consistent across web and native, never
 * attention-grabbing.
 */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
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
  }, [progress, delay]);
  return (
    <Animated.View
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
          <Text style={[type.title, { color: palette.text }]}>{title}</Text>
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
      <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>
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
  return <Text style={[type.title, { color: palette.text, marginBottom: spacing.md }]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const { palette } = useTheme();
  return <Text style={[type.heading, { color: palette.text, marginVertical: spacing.sm }, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { palette } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[type.body, { color: muted ? palette.textMuted : palette.text }, style]}>
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
}: {
  minor: number;
  currency?: string;
  large?: boolean;
  colorized?: boolean;
  color?: string;
}) {
  const { palette } = useTheme();
  const resolved = color ?? (colorized && minor < 0 ? palette.negative : palette.text);
  return <Text style={[large ? type.amountLg : type.amount, { color: resolved }]}>{formatMinor(minor, currency)}</Text>;
}

export function Row({ children, style, gap = spacing.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Spread({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon: IconCmp,
  size = "md",
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  size?: "md" | "sm";
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
        ? "#FFFFFF"
        : variant === "ghost"
          ? palette.primary
          : palette.text;
  const small = size === "sm";
  const press = useSpringPress(0.97);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      // A small button's visual height stays compact (36) to fit inline rows,
      // but hitSlop lifts its effective touch target to the ~44pt minimum.
      hitSlop={small ? 8 : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        lightTap();
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
        <ActivityIndicator color={color} />
      ) : (
        <>
          {IconCmp ? <IconCmp size={small ? 15 : 17} color={color} strokeWidth={2.2} /> : null}
          <Text
            style={[type.label, { color, fontSize: small ? 13 : 15, textAlign: "center" }]}
            // Web ignores adjustsFontSizeToFit, so a hard line cap would
            // ellipsize; let the label wrap there instead (never hide text).
            numberOfLines={Platform.OS === "web" ? undefined : 1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
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
}: {
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
  size?: number;
  label?: string;
}) {
  const { palette } = useTheme();
  const color = tone === "danger" ? palette.negative : tone === "primary" ? palette.primary : palette.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        lightTap();
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
      <IconCmp size={size * 0.5} color={color} strokeWidth={2.2} />
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
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure === true);
  return (
    <View style={{ marginBottom: noMargin ? 0 : spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <View>
        <TextInput
          placeholderTextColor={palette.textMuted}
          {...props}
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
              borderColor: error ? palette.negative : focused ? palette.focus : "transparent",
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
            onPress={() => setHidden(!hidden)}
            hitSlop={8}
            style={{ position: "absolute", right: spacing.md, top: 0, bottom: 0, justifyContent: "center" }}
          >
            {hidden ? <Eye size={18} color={palette.textMuted} /> : <EyeOff size={18} color={palette.textMuted} />}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={[type.small, { color: palette.negative, marginTop: spacing.xs }]}>{error}</Text> : null}
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
}: {
  label?: string;
  value: string;
  onChangeMinor: (raw: string, minor: number | null) => void;
  placeholder?: string;
  expression?: boolean;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const [focused, setFocused] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  // Display is the live-grouped form; parsing accepts single amounts and sums
  // ("400+500"), grouped or ungrouped, so an initial "15000,00" shows as
  // "15.000,00" and a typed sum evaluates.
  const display = formatMoneyInputLive(value);
  const minor = value.trim() === "" ? null : parseAmountExpression(display);
  const invalid = value.trim() !== "" && minor === null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <View>
        <TextInput
          value={display}
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
            color: invalid ? palette.negative : disabled ? palette.textMuted : palette.text,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: invalid ? palette.negative : focused ? palette.focus : "transparent",
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
            accessibilityRole="button"
            onPress={() => setCalcOpen(true)}
            hitSlop={8}
            style={{ position: "absolute", right: spacing.md, top: 0, bottom: 0, justifyContent: "center" }}
          >
            <CalculatorIcon size={18} color={palette.textMuted} />
          </Pressable>
        )}
      </View>
      {calcOpen ? (
        <LazyCalculatorModal
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
function LazyCalculatorModal(props: { onClose: () => void; onResult: (major: number) => void }) {
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
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            backgroundColor: palette.surfaceAlt,
            borderRadius: radius.sm,
            borderWidth: 1.5,
            borderColor: open ? palette.focus : "transparent",
            paddingHorizontal: spacing.md,
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
          numberOfLines={Platform.OS === "web" ? undefined : 1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {current?.label ?? placeholder ?? ""}
        </Text>
        <ChevronDown size={17} color={palette.textMuted} />
      </Pressable>
      {open ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", justifyContent: "center", padding: spacing.lg }}
            onPress={() => setOpen(false)}
          >
            <Pressable onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 380 }}>
              <FadeIn
                style={[
                  { backgroundColor: palette.surface, borderRadius: radius.lg, paddingVertical: spacing.sm, maxHeight: 420 },
                  scheme === "light" && cardShadow,
                ]}
              >
                <ScrollView>
                  {options.map((option) => {
                    const selected = option.value === value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
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
                            { color: selected ? palette.primary : palette.text, fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular" },
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
              selectionTap();
              onChange(option.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[
              {
                flex: 1,
                paddingVertical: spacing.sm + 2,
                borderRadius: radius.sm - 1,
                alignItems: "center",
                backgroundColor: selected ? palette.surface : "transparent",
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
              // Web ignores adjustsFontSizeToFit — wrap rather than ellipsize.
              numberOfLines={Platform.OS === "web" ? undefined : 1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
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
              selectionTap();
              if (multi) onToggle?.(option.value);
              else onChange?.(option.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            hitSlop={4}
            style={{
              paddingVertical: spacing.sm + 2,
              paddingHorizontal: spacing.md + 2,
              borderRadius: radius.full,
              borderWidth: 1.5,
              borderColor: selected ? palette.primary : palette.border,
              backgroundColor: selected ? palette.primarySoft : palette.surface,
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <Text
              style={[
                type.label,
                {
                  color: selected ? palette.primary : palette.text,
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
    positive: { bg: palette.positive + "1F", fg: palette.positive },
    negative: { bg: palette.negative + "1F", fg: palette.negative },
    warning: { bg: palette.warning + "1F", fg: palette.warning },
    primary: { bg: palette.primarySoft, fg: palette.primary },
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
export function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        width: STATUS_W,
        height: 36,
        borderRadius: radius.sm + 2,
        backgroundColor: color + "1F",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.xs,
      }}
    >
      <Text
        style={[type.label, { color, fontSize: 13, textAlign: "center" }]}
        // Never ellipsize (app-wide rule): shrink to fit on native; web
        // ignores adjustsFontSizeToFit, so let the label wrap there instead.
        numberOfLines={Platform.OS === "web" ? undefined : 1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
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
          <IconCmp size={26} color={palette.textMuted} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
      {hint ? <Text style={[type.body, { color: palette.textMuted, textAlign: "center" }]}>{hint}</Text> : null}
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
  titleLines,
  subtitle,
  right,
  onPress,
  chevron = false,
}: {
  icon?: LucideIcon;
  iconColor?: string;
  leading?: ReactNode;
  title: string;
  /** Optional hard cap on title lines. Undefined = wrap fully (never
   *  ellipsize — the app-wide rule is that no text is hidden behind "…"). */
  titleLines?: number;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const { palette } = useTheme();
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md - 2 }}>
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
          <IconCmp size={18} color={iconColor ?? palette.primary} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: palette.text, fontFamily: "Inter_500Medium" }]} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.small, { color: palette.textMuted, marginTop: 1 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <ChevronRight size={17} color={palette.textMuted} /> : null}
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
export function Toggle({ value, onValueChange, disabled }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const { palette } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(progress, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 20, bounciness: 6 }).start();
  }, [value, progress]);
  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [palette.border, palette.primary] });
  const thumbX = progress.interpolate({ inputRange: [0, 1], outputRange: [TOGGLE_PAD, TOGGLE_W - TOGGLE_THUMB - TOGGLE_PAD] });
  return (
    <Pressable
      accessibilityRole="switch"
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
            backgroundColor: "#ffffff",
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
