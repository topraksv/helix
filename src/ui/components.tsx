/** Shared accessible UI primitives for native and web. */

import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
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
import { useScrollToTop } from "@react-navigation/native";
import { AlertCircle, Calculator as CalculatorIcon, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Minus, Plus, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { formatMinor, formatMinorCompact, formatMoneyInputLive, parseAmountExpression } from "../domain/money";
import { INPUT_LIMITS } from "../domain/input";
import { initialsBadgeColor } from "./badge-color";
import { DelayedLoading, DelayedLoadingIndicator, LoadingIndicator } from "./loading-indicator";
import type { TrackedOperationState } from "./operation-guard";
import { addMonthsToKey, type MonthKey } from "../domain/dates";
import { monthLabel, tr } from "../i18n/tr";
import type { LiveQueryStatus } from "../data/live-state";
import { haptic, selectionTap, selectionTapIfChanged, type HapticKind } from "./haptics";
import {
  borderWidth,
  contentWidth,
  controlSize,
  density,
  font,
  generatedBadgeForeground,
  heroSurface,
  iconSize,
  motion,
  radius,
  segmentedMaxWidth,
  spacing,
  stateOpacity,
  toggleSize,
  toggleThumbShadow,
  themeShadow,
  type,
  useTheme,
  type ContentWidth,
  type Palette,
} from "./theme";
import { shouldBoundIntrinsicControls, shouldStackListActions, shouldUseWideGutter } from "./responsive";
import { useContentWidth, useMeasuredWidth, useNavigationSpace } from "./viewport";
import { useReducedMotion } from "./motion";
import { modalAnimationType } from "./modal-motion";
import { useModalAccessibility } from "./accessibility";
import { initialAmountFontSize, nextAmountFontSize, type AmountScale } from "./amount-layout";
import { filterSelectionOptions, type SelectionOption } from "./selection";
import { OperationFlow, type OperationFlowKind } from "./operation-flow";
import { examplePlaceholder, numericPlaceholderColor } from "./input-placeholder";

/**
 * The shared look of every control that accepts a value: text fields, selects
 * and the date trigger. Exported because the date trigger lives in
 * `calendar.tsx` and had grown its own `surfaceAlt` fill, which is why one
 * field on an investment form was grey while the two beside it were not.
 */
export function controlStateStyle(palette: Palette, active: boolean, error = false) {
  return {
    backgroundColor: palette.surface,
    borderWidth: active || error ? borderWidth.control : StyleSheet.hairlineWidth,
    borderColor: error ? palette.error : active ? palette.focus : palette.controlBorder,
  };
}

/** Shared reduced-motion-aware entrance. */
export function FadeIn({
  children,
  delay = 0,
  style,
  accessibilityViewIsModal,
  accessibilityRole,
  accessibilityLiveRegion,
}: {
  children: ReactNode;
  delay?: number;
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
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Screen scaffold with safe areas and bounded wide-screen content. */
export function Screen({
  children,
  scroll = true,
  scrollEnabled = true,
  padded = true,
  title,
  subtitle,
  right,
  leading,
  width: widthName = "form",
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
  /**
   * How much width this screen's information structure earns. Named, not
   * numeric, so two adjacent surfaces cannot drift apart — see `contentWidth`.
   */
  width?: ContentWidth;
  /** Access to the vertical scroller for explicit workflow navigation. */
  scrollRef?: React.RefObject<ScrollView | null>;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = contentWidth[widthName];
  const segments = useSegments();
  // Pressing the tab you are already on returns that screen to the top. The
  // navigator's own hook is used rather than a listener here because it also
  // resolves the cases a hand-rolled one gets wrong: nested stacks, whether
  // this screen is the stack's first, and a listener that called
  // preventDefault. Screens outside a tab navigator are a no-op.
  const ownScrollRef = useRef<ScrollView>(null);
  const activeScrollRef = scrollRef ?? ownScrollRef;
  useScrollToTop(activeScrollRef);
  // A screen that fills its column still needs a margin to read as a page
  // rather than as content pressed against the window. The phone gutter is the
  // one the thumb expects; a pointer-sized viewport gets a real one.
  const gutter = shouldUseWideGutter(width) ? spacing.xxl : spacing.lg;
  // The tab bar floats over its scene, so the navigator no longer reserves its
  // height — the last row would otherwise sit under it. `tabBarClearance` is
  // the single source for that space; a modal or stack scene has no bar over it
  // and only needs the safe-area inset.
  // One owner for where navigation is — the same hook every layout rule reads.
  // Only the bottom clearance is applied here: the tab SCENE owns the rail's
  // left inset, so a nested stack's header is inset by the same rule as the
  // screen under it.
  const { bottom: navBottom, left: navLeft, inTabs } = useNavigationSpace();
  const bottomPad = inTabs ? navBottom : Math.max(insets.bottom, spacing.lg) + spacing.md;
  // Content must clear the status bar / Dynamic Island on headerless full
  // screens. Titled screens already inset the top; the auth + onboarding
  // screens run with `headerShown: false` and no title, so they need it too
  // (otherwise the welcome header slid under the Dynamic Island). Modal/stack
  // screens keep the flat pad — their native header already reserves the inset,
  // so adding it here would double-pad them.
  const needsTopInset = title != null || segments[0] === "(auth)" || segments[0] === "(onboarding)";

  const header =
    title != null ? (
      // Identified so a visual baseline can mask it: the dashboard's title is
      // a greeting and its subtitle today's date, both derived from the clock.
      // Baking either into a screenshot makes the suite fail by the hour.
      <View testID="screen-header" style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            style={[type.title, { color: palette.textStrong, minWidth: 0, flexShrink: 1 }]}
          >
            {title}
          </Text>
          {subtitle ? <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    ) : null;

  const inner: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: gutter },
    { paddingTop: needsTopInset ? Math.max(insets.top, spacing.lg) : spacing.lg },
    { paddingBottom: bottomPad },
    // Unconditional: below its cap the column simply fills, so there is no
    // second layout mode to reason about and no threshold to drift.
    { width: "100%", maxWidth, alignSelf: "center" },
    // Lets a short page distribute its own height instead of stacking against
    // the header — an empty state can then centre itself in what is left. It
    // changes nothing once the content is taller than the viewport.
    { flexGrow: 1 },
  ];

  // Nothing here adjusts a content inset, and that is the point.
  //
  // Two attempts at keyboard avoidance both made things worse.
  // `KeyboardAvoidingView` with `behavior="padding"` measured the keyboard in
  // window coordinates while a stack screen starts below the native header, so
  // it over-padded by the header height and collapsed the content. Replacing it
  // with `automaticallyAdjustKeyboardInsets` handed the same job to UIKit, and
  // UIKit's bottom inset survived an app switch without being taken back: the
  // scrollable area grew every time the app returned from the background, which
  // is the "scrolls downwards forever" the owner reported.
  //
  // So the padding is ours and only ours: `contentContainerStyle` already
  // carries the safe-area space, and `automaticallyAdjustContentInsets={false}`
  // stops UIKit adding to it. A focused field near the bottom of a long form
  // can therefore sit under the keyboard — recorded as an open item rather than
  // patched with a third mechanism in the same breath as removing the second.
  if (!scroll) {
    return (
      // The rail's space is taken here, by the content, and not by the tab scene:
    // a scene-level inset also shortened the nested stack's header, which is
    // chrome that belongs to the whole window.
    <View style={{ flex: 1, backgroundColor: palette.background, paddingLeft: navLeft }}>
        <FadeIn style={[{ flex: 1 }, inner]}>
          {header}
          {children}
        </FadeIn>
      </View>
    );
  }
  return (
    // The rail's space is taken here, by the content, and not by the tab scene:
    // a scene-level inset also shortened the nested stack's header, which is
    // chrome that belongs to the whole window.
    <View style={{ flex: 1, backgroundColor: palette.background, paddingLeft: navLeft }}>
      {/* The scroll edge — only where this screen really does start at the top
          of the window. Content passes under the status bar there, and with
          nothing painted over that band a settings row's label ran straight
          through the clock.
          `needsTopInset` is the condition, not `insets.top > 0`: a screen under
          a stack header begins below it, and the window's inset is still ~59pt,
          so the strip painted an opaque band over the first 59pt of every form
          — which is the "Tutar ve işlem türü is half hidden" the owner saw on
          Yeni İşlem and on every editor like it. */}
      {needsTopInset && insets.top > 0 ? (
        <View
          pointerEvents="none"
          accessible={false}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: palette.background, zIndex: 2 }}
        />
      ) : null}
      <ScrollView
        ref={activeScrollRef}
        contentContainerStyle={inner}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        automaticallyAdjustContentInsets={false}
      >
        {/* Carries the container's grow through to the children, so a screen
            with one short block can centre it rather than stack it at the top
            of an empty page. */}
        <FadeIn style={{ flexGrow: 1 }}>
          {header}
          {children}
        </FadeIn>
      </ScrollView>
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  onLayout,
  padded = true,
  tone,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  padded?: boolean;
  tone?: "success" | "warning" | "error";
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { palette } = useTheme();
  const toneColor = tone ? palette[tone] : null;
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: toneColor ? toneColor + "14" : palette.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: toneColor ? toneColor + "66" : palette.border + "70",
      borderRadius: radius.lg,
      padding: padded ? density.list.cardPadding : 0,
      marginBottom: spacing.md,
      overflow: "hidden",
      borderCurve: "continuous",
    },
  ];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        onPress={onPress}
        onLayout={onLayout}
        style={({ pressed }) => [base, style, pressed && { backgroundColor: palette.surfaceHover }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View testID={testID} style={[base, style]} onLayout={onLayout}>{children}</View>;
}

/** Quiet balance instrument. The value, not decoration, carries the hierarchy. */
export function HeroCard({ children, style, onLayout }: { children: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { palette, scheme } = useTheme();
  return (
    <View
      onLayout={onLayout}
      style={[
        {
          backgroundColor: heroSurface(palette, scheme).fill,
          borderRadius: radius.lg,
          padding: density.dashboard.cardPadding,
          marginBottom: spacing.md,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: palette.primary + "72",
          borderTopWidth: 3,
          borderTopColor: palette.primary,
          borderCurve: "continuous",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Shared, unboxed metric rail. The values stay in a predictable row while
 * surrounding screens decide whether the rail belongs to a hero, chart or
 * portfolio surface. */
/**
 * A row of labelled figures that stays a row.
 *
 * It used to give each column a 112px basis and let the row wrap, so on a phone
 * "Gelir" and "Çıkış" sat on one line and "Net değişim" dropped to a second —
 * three peers reading as two-then-one. They share the row now, and a column too
 * narrow for a full figure asks its value to render compactly (₺1,2 M) rather
 * than shrinking the type until it cannot be read.
 */
export function MetricStrip({
  items,
  style,
  testID,
}: {
  items: { label: string; value: ReactNode | ((compact: boolean) => ReactNode) }[];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { palette } = useTheme();
  const [stripWidth, onStripLayout] = useMeasuredWidth(0);
  // Measured, because the column is what has to hold the figure — not the
  // window, which says nothing about how many columns share this card.
  const columnWidth = stripWidth > 0 ? stripWidth / Math.max(items.length, 1) : 0;
  // 140, not 116: a year of a real ledger reaches "₺868.952,23", and the
  // threshold has to clear the widest figure these strips carry rather than the
  // narrowest. Below it the value renders as ₺868,9 B and keeps its own line.
  const compactValues = columnWidth > 0 && columnWidth < 140;
  return (
    <View
      testID={testID}
      onLayout={onStripLayout}
      style={[
        {
          flexDirection: "row",
          flexWrap: "nowrap",
          gap: spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.border,
          marginTop: spacing.lg,
        },
        style,
      ]}
    >
      {items.map((item) => (
        <View key={item.label} style={{ flex: 1, flexBasis: 0, minWidth: 0, paddingTop: spacing.sm }}>
          <Text style={[type.small, { color: palette.textSecondary }]}>{item.label}</Text>
          <View style={{ marginTop: 2 }}>
            {typeof item.value === "function" ? item.value(compactValues) : item.value}
          </View>
        </View>
      ))}
    </View>
  );
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
export function SectionHeader({
  children,
  description,
  right,
}: {
  children: ReactNode;
  description?: string;
  right?: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: spacing.sm, marginTop: density.list.sectionGap }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View accessible={false} style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: palette.primary }} />
        <Text
          accessibilityRole="header"
          style={[
            type.heading,
            {
              color: palette.textStrong,
              fontSize: 16,
              flex: 1,
              minWidth: 0,
            },
          ]}
        >
          {children}
        </Text>
        {right}
      </View>
      {description ? (
        <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{description}</Text>
      ) : null}
    </View>
  );
}

/** Compact title and explanation inside a functional card or pane. */
export function PanelHeader({
  icon: IconCmp,
  title,
  description,
  right,
  tone = "primary",
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  right?: ReactNode;
  tone?: "primary" | "secondary" | "warning" | "error" | "success";
}) {
  const { palette } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const stackRight = Boolean(right) && viewportWidth < 360;
  const toneColor = tone === "warning"
    ? palette.warning
    : tone === "error"
      ? palette.error
      : tone === "success"
        ? palette.success
        : tone === "secondary"
          ? palette.secondary
          : palette.primary;
  return (
    <View style={{ gap: stackRight ? spacing.xs : spacing.md, marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: description ? "flex-start" : "center", gap: spacing.md }}>
        <View
          accessible={false}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone === "primary" ? palette.primarySoft : toneColor + "18",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: toneColor + "72",
          }}
        >
          <IconCmp accessible={false} size={17} color={tone === "primary" ? palette.accentText : toneColor} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={[type.body, { color: palette.textStrong, fontFamily: font.semibold }]}>
            {title}
          </Text>
          {description ? (
            <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{description}</Text>
          ) : null}
        </View>
        {!stackRight ? right : null}
      </View>
      {stackRight ? <View style={{ marginLeft: 48 }}>{right}</View> : null}
    </View>
  );
}

/** Signed money text: red for negatives, tabular figures. */
export function Amount({
  minor,
  currency = "TRY",
  large,
  hero,
  colorized = true,
  color,
  compact = false,
  style,
}: {
  minor: number;
  currency?: string;
  large?: boolean;
  hero?: boolean;
  colorized?: boolean;
  color?: string;
  /** Render as ₺1,2 M when the column cannot hold the exact figure. */
  compact?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const { palette } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const resolved = color ?? (colorized && minor < 0 ? palette.negativeText : palette.text);
  const formatted = compact ? formatMinorCompact(minor, currency) : formatMinor(minor, currency);
  const scale: AmountScale = hero ? "hero" : large ? "large" : "regular";
  // Width/font-scale changes start a fresh fit pass so rotation and Dynamic
  // Type can shrink or grow without opting out of system font scaling.
  const fitKey = `${formatted}|${scale}|${width}|${fontScale}`;
  const initialSize = initialAmountFontSize(scale);
  const [fit, setFit] = useState({ key: fitKey, size: initialSize });
  const fittedSize = fit.key === fitKey ? fit.size : initialSize;
  const shrinkToNextStep = () => {
    const next = nextAmountFontSize(scale, fittedSize);
    if (next !== fittedSize) setFit({ key: fitKey, size: next });
  };
  return (
    <Text
      selectable
      accessibilityLabel={formatted}
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
  haptic: hapticKind = "none",
  accessibilityHint,
  expanded,
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
      hitSlop={small ? 6 : undefined}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={({ pressed }) => [
        {
          backgroundColor: pressed && !visuallyDisabled ? pressedBackground : colors.background,
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
          borderColor: palette.controlBorder,
          opacity: pressed && variant === "danger" ? stateOpacity.pressed : 1,
          transform: [{ translateY: pressed && !visuallyDisabled ? 1 : 0 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel={label} color={colors.foreground} />
      ) : (
        <>
          {IconCmp ? <IconCmp accessible={false} size={small ? iconSize.compact : iconSize.control} color={colors.foreground} strokeWidth={2.2} /> : null}
          <Text
            style={[small ? type.buttonCompact : type.button, { color: colors.foreground, textAlign: "center", flexShrink: 1 }]}
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
      hitSlop={6}
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
      {({ pressed }) => (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius.sm,
            backgroundColor: tone === "primary" ? palette.primarySoft : pressed ? palette.surfaceHover : palette.surface,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border + "90",
          }}
        >
          <IconCmp accessible={false} size={iconSizeValue ?? Math.round(size * 0.5)} color={color} strokeWidth={2.2} />
        </View>
      )}
    </Pressable>
  );
}

/** Bounded month navigator. */
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
      <IconButton icon={ChevronLeft} label={tr.common.previous} haptic="selection" disabled={!canPrev} onPress={() => onChange(addMonthsToKey(value, -1))} />
      <Heading style={{ marginVertical: 0 }}>{monthLabel(value)}</Heading>
      <IconButton icon={ChevronRight} label={tr.common.next} haptic="selection" disabled={!canNext} onPress={() => onChange(addMonthsToKey(value, 1))} />
    </Spread>
  );
}

const fieldAccessoryStyle = {
  position: "absolute",
  right: 0,
  top: 0,
  bottom: 0,
  width: controlSize.inputAccessoryWidth,
  alignItems: "center",
  justifyContent: "center",
} as const;

/** One live-region contract for validation errors across shared fields. */
function FieldError({ message }: { message?: string | null }) {
  const { palette } = useTheme();
  if (!message) return null;
  return (
    <FadeIn
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, marginTop: spacing.xs }}
    >
      <AlertCircle accessible={false} size={14} color={palette.error} style={{ marginTop: 1 }} />
      <Text style={[type.small, { color: palette.errorText, flex: 1 }]}>{message}</Text>
    </FadeIn>
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
  const numericPlaceholder = props.keyboardType === "number-pad"
    || props.keyboardType === "numeric"
    || props.keyboardType === "decimal-pad"
    || props.inputMode === "numeric"
    || props.inputMode === "decimal";
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
      {label ? <Label nativeID={labelId}>{label}</Label> : null}
      <View>
        <TextInput
          {...props}
          placeholder={examplePlaceholder(props.placeholder)}
          placeholderTextColor={numericPlaceholder ? numericPlaceholderColor(palette.textSecondary) : palette.textSecondary}
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
              ...controlStateStyle(palette, focused, Boolean(error)),
              color: props.editable === false ? palette.textSecondary : palette.text,
              ...(props.editable === false ? { borderColor: palette.border } : null),
              borderRadius: radius.sm,
              paddingHorizontal: spacing.md,
              paddingRight: secure ? controlSize.inputAccessoryInset : spacing.md,
              minHeight: controlSize.regular,
              ...type.field,
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
            // The icon is 18px and `hitSlop` does not enlarge the DOM box on
            // web, which left an 18px-wide target (WCAG 2.2 SC 2.5.8 asks for
            // 24). The box now fills the input's reserved 44px right padding
            // with the icon centred, so the mark does not visibly move.
            style={fieldAccessoryStyle}
          >
            {hidden ? <Eye accessible={false} size={iconSize.accessory} color={palette.textSecondary} /> : <EyeOff accessible={false} size={iconSize.accessory} color={palette.textSecondary} />}
          </Pressable>
        ) : null}
      </View>
      <FieldError message={error} />
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
  inline = false,
  error,
}: {
  label?: string;
  value: string;
  onChangeMinor: (raw: string, minor: number | null) => void;
  placeholder?: string;
  expression?: boolean;
  disabled?: boolean;
  /** Screen-reader label when a nearby visible section heading labels the field. */
  accessibilityLabel?: string;
  /** Keeps repeated amount rows compact without reducing the input target. */
  inline?: boolean;
  /** Domain validation message shown in addition to the input parser's own error. */
  error?: string | null;
}) {
  const { palette } = useTheme();
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const [focused, setFocused] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const calculatorTriggerRef = useRef<View>(null);
  const display = formatMoneyInputLive(value);
  const minor = value.trim() === "" ? null : parseAmountExpression(display);
  const invalid = value.trim() !== "" && minor === null;
  const resolvedError = invalid ? tr.common.amountLimit : error;
  return (
    <View style={{ marginBottom: inline ? spacing.sm : spacing.md }}>
      <View style={inline ? { flexDirection: "row", alignItems: "center", gap: spacing.sm } : undefined}>
        {label ? (
          <View style={inline ? { flex: 1, minWidth: 0 } : undefined}>
            <Label nativeID={labelId} style={inline ? { marginBottom: 0 } : undefined}>{label}</Label>
          </View>
        ) : null}
        <View
          style={inline
            ? {
                // Repeated amount rows need their descriptive label more than
                // a half-width amount box. TRY entry is bounded and the
                // native TextInput scrolls its value, so keep that control
                // predictable while returning the remaining width to context.
                width: "42%",
                maxWidth: 156,
                minWidth: 120,
                flexShrink: 1,
              }
            : undefined}
        >
          <TextInput
            value={display}
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityLabelledBy={label ? labelId : undefined}
            accessibilityHint={resolvedError ? tr.a11y.fieldError(resolvedError) : undefined}
            accessibilityState={{ disabled }}
            maxLength={INPUT_LIMITS.money}
            editable={!disabled}
            onChangeText={(raw) => {
              const formatted = formatMoneyInputLive(raw);
              onChangeMinor(formatted, formatted.trim() === "" ? null : parseAmountExpression(formatted));
            }}
            keyboardType={expression ? "numbers-and-punctuation" : "decimal-pad"}
            inputMode={expression ? "text" : "decimal"}
            placeholder={examplePlaceholder(placeholder)}
            placeholderTextColor={numericPlaceholderColor(palette.textSecondary)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              ...controlStateStyle(palette, focused, Boolean(resolvedError)),
              color: resolvedError ? palette.errorText : disabled ? palette.textSecondary : palette.text,
              borderRadius: radius.sm,
              paddingHorizontal: spacing.md,
              paddingRight: controlSize.inputAccessoryInset,
              minHeight: controlSize.regular,
              ...type.moneyInput,
              ...(disabled ? { borderColor: palette.border } : null),
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
              // The icon is 18px and `hitSlop` does not enlarge the DOM box on
              // web, which left an 18px-wide target (WCAG 2.2 SC 2.5.8 asks for
              // 24). The box now fills the input's reserved 44px right padding
              // with the icon centred, so the mark does not visibly move.
              style={fieldAccessoryStyle}
            >
              <CalculatorIcon accessible={false} size={iconSize.accessory} color={palette.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
      <FieldError message={resolvedError} />
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

/**
 * Deferred require for the calculator modal.
 *
 * This does NOT remove the `components ⇄ calculator` cycle — `madge --circular`
 * still reports it, because `calculator.tsx` statically imports `Button` and
 * `FadeIn` from here. What it removes is the STATIC back-edge at module scope:
 * `components.tsx` has no top-level reference to `calculator.tsx`, so whichever
 * module loads first finishes initializing before the other body runs and
 * neither order can observe a TDZ hole.
 *
 * The cycle is retained deliberately. Breaking it means moving
 * `FadeIn` and `Button` into a leaf module — a wide edit to a 1300-line shared
 * file whose only gains are a clean `madge` run and one fewer eslint
 * suppression. `require()` is synchronous: Metro cannot split on it, so
 * `calculator.tsx` ships in the same bundle either way. This defers module
 * EVALUATION, not bundling.
 */
function LazyCalculatorModal(props: { onClose: () => void; onResult: (major: number) => void; returnFocusRef?: React.RefObject<View | null> }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CalculatorModal } = require("./calculator") as typeof import("./calculator");
  return <CalculatorModal {...props} />;
}

/** Width of a select row's icon column, so every label starts at one x. */
const SELECT_ICON_W = 22;
type SelectOptionIcon = string | LucideIcon | React.ReactElement;

function SelectOptionMark({ icon, color }: { icon: SelectOptionIcon; color: string }) {
  if (typeof icon === "string") {
    return (
      <Text accessible={false} aria-hidden style={[type.body, { width: SELECT_ICON_W, textAlign: "center" }]}>
        {icon}
      </Text>
    );
  }
  if (React.isValidElement(icon)) {
    return <View accessible={false} style={{ width: SELECT_ICON_W, alignItems: "center" }}>{icon}</View>;
  }
  const Icon = icon;
  return (
    <View accessible={false} style={{ width: SELECT_ICON_W, alignItems: "center" }}>
      <Icon size={iconSize.control} color={color} strokeWidth={2} />
    </View>
  );
}

/** Dropdown select: field-styled trigger opening a modal option list. */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  onCreate,
  selectedOption,
  trigger,
}: {
  label?: string;
  /**
   * `icon` is separate from `label` on purpose. Packing an emoji into the
   * label string left every name starting at a different x — emoji advance
   * widths differ — so a list of categories read as a ragged left edge. Its
   * own fixed column makes the names line up.
   */
  options: { value: T; label: string; icon?: SelectOptionIcon }[];
  value: T | null;
  onChange: (v: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * A create action pinned under the options.
   *
   * An empty list used to be handled by standing a "manage payment sources"
   * button beside the field, which said the right thing in the wrong place —
   * you learn you have nothing to pick only after opening the picker. Living
   * here it is also there when the list is NOT empty, which is when "none of
   * these" actually happens.
   */
  onCreate?: { label: string; run: () => void };
  /** A value chosen through the pinned create action can remain visible in the
   * trigger without becoming a duplicate ordinary option in the list. */
  selectedOption?: { value: T; label: string; icon?: SelectOptionIcon };
  /**
   * Render the control that opens the list. A caller whose control already
   * exists in another shape — a chip in a row of chips — uses this instead of
   * standing a second field next to it, and the modal, its focus trap and its
   * keyboard behaviour stay here rather than being written again.
   */
  trigger?: (open: () => void, selected: string | null) => ReactNode;
}) {
  const { palette, scheme } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const modalTitleRef = useModalAccessibility(open, triggerRef);
  const current = options.find((o) => o.value === value)
    ?? (selectedOption?.value === value ? selectedOption : undefined);
  const modalVerticalInset = width < 640 ? spacing.lg : spacing.lg * 2;
  const modalMaxHeight = Math.max(0, Math.min(width < 640 ? 560 : 460, height - modalVerticalInset));
  const optionsModal = (
          <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={() => setOpen(false)}>
            <Pressable
              accessible={false}
              tabIndex={-1}
              style={{
                flex: 1,
                backgroundColor: palette.scrim,
                justifyContent: width < 640 ? "flex-end" : "center",
                paddingHorizontal: width < 640 ? spacing.sm : spacing.lg,
                paddingTop: spacing.lg,
                paddingBottom: width < 640 ? 0 : spacing.lg,
              }}
              onPress={() => setOpen(false)}
            >
              <Pressable
                accessible={false}
                tabIndex={-1}
                accessibilityViewIsModal
                onPress={() => {}}
                style={{ alignSelf: "center", width: "100%", maxWidth: width < 640 ? 520 : 400 }}
              >
                <FadeIn
                  style={[
                    {
                      backgroundColor: palette.surface,
                      borderTopLeftRadius: radius.xl,
                      borderTopRightRadius: radius.xl,
                      borderBottomLeftRadius: width < 640 ? 0 : radius.xl,
                      borderBottomRightRadius: width < 640 ? 0 : radius.xl,
                      maxHeight: modalMaxHeight,
                      overflow: "hidden",
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: palette.border + "90",
                    },
                    scheme === "light" && themeShadow.overlay(palette),
                  ]}
                >
                  {width < 640 ? (
                    <View accessible={false} style={{ alignItems: "center", paddingTop: spacing.sm }}>
                      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: palette.surfaceStrong }} />
                    </View>
                  ) : null}
                  <View ref={modalTitleRef} accessible accessibilityRole="header" tabIndex={-1}>
                    <Text style={[type.heading, { color: palette.textStrong, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
                      {label ?? tr.a11y.selectOption}
                    </Text>
                  </View>
                  <ScrollView
                    role="radiogroup"
                    accessibilityLabel={label ?? tr.a11y.selectOption}
                    style={{ flexShrink: 1 }}
                  >
                    {options.map((option, index) => {
                      const selected = option.value === value;
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole="radio"
                          aria-checked={selected}
                          accessibilityState={{ checked: selected, selected }}
                          onPress={() => {
                            selectionTapIfChanged(value, option.value);
                            onChange(option.value);
                            setOpen(false);
                          }}
                          style={({ pressed }) => [
                            {
                              paddingHorizontal: spacing.lg,
                              paddingVertical: spacing.md,
                              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                              borderTopColor: palette.border + "70",
                              backgroundColor: selected
                                ? palette.primarySoft
                                : pressed
                                  ? palette.surfaceHover
                                  : "transparent",
                            },
                          ]}
                        >
                          <Row gap={spacing.sm}>
                            {option.icon ? (
                              // Decorative: the mark repeats the adjacent name,
                              // so it stays out of the accessible option label.
                              <SelectOptionMark
                                icon={option.icon}
                                color={selected ? palette.primaryText : palette.textSecondary}
                              />
                            ) : null}
                            <Text
                              style={[
                                type.body,
                                {
                                  flex: 1,
                                  color: selected ? palette.primaryText : palette.text,
                                  fontFamily: selected ? font.semibold : font.regular,
                                },
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Row>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {onCreate ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={onCreate.label}
                      onPress={() => {
                        setOpen(false);
                        onCreate.run();
                      }}
                      style={({ pressed }) => ({
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.md,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.border,
                        backgroundColor: pressed ? palette.surfaceHover : palette.surface,
                      })}
                    >
                      <Row gap={spacing.sm}>
                        <Plus accessible={false} size={iconSize.control} color={palette.primary} style={{ width: SELECT_ICON_W }} />
                        <Text style={[type.body, { flex: 1, color: palette.primaryText, fontFamily: font.medium }]}>
                          {onCreate.label}
                        </Text>
                      </Row>
                    </Pressable>
                  ) : null}
                  {width < 640 && insets.bottom > 0 ? (
                    <View accessible={false} style={{ height: insets.bottom, backgroundColor: palette.surface }} />
                  ) : null}
                </FadeIn>
              </Pressable>
            </Pressable>
          </Modal>
  );

  if (trigger) {
    return (
      <>
        <View ref={triggerRef}>{trigger(() => setOpen(true), current?.label ?? null)}</View>
        {open ? optionsModal : null}
      </>
    );
  }
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Label>{label}</Label> : null}
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder ?? current?.label}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            ...controlStateStyle(palette, open),
            borderRadius: radius.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: controlSize.regular,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            ...(disabled ? { borderColor: palette.border } : null),
            ...(pressed && !disabled ? { backgroundColor: palette.surfaceHover } : null),
          },
        ]}
      >
        {current?.icon ? (
          <View style={{ marginRight: spacing.sm }}>
            <SelectOptionMark icon={current.icon} color={disabled ? palette.textSecondary : palette.text} />
          </View>
        ) : null}
        <Text
          style={[type.body, { color: disabled || !current ? palette.textSecondary : palette.text, flex: 1 }]}
        >
          {current?.label ?? placeholder ?? ""}
        </Text>
        <ChevronDown accessible={false} size={iconSize.control} color={palette.textSecondary} />
      </Pressable>
      {open ? optionsModal : null}
    </View>
  );
}

/**
 * Switches which view of the same data is shown — pie or bars, rows or
 * columns, this range or that one. It is NOT the control for a form value the
 * user will save; that is `ChipPicker`, and keeping the two apart is what
 * stops one screen from asking three identical questions three different ways.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  noMargin = false,
  disabled = false,
  fill = false,
  action,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  noMargin?: boolean;
  disabled?: boolean;
  /**
   * Span the container instead of stopping at the control's own width.
   *
   * For a strip that is a page's primary view switcher — the ledger's pivot —
   * one fixed position beats an intrinsic width: bounded, the same control sat
   * somewhere different on a phone, a tablet and a zoomed desktop.
   */
  fill?: boolean;
  /**
   * A companion toggle that belongs to the same strip — the ledger's reading
   * guide beside its pivot.
   *
   * It used to be an `IconButton` parked next to the control: a bordered 52pt
   * square beside a 44pt underlined strip, which is two control languages and
   * two heights on one row. Rendered as part of the strip it cannot drift from
   * it, and it keeps its own button role rather than pretending to be a fourth
   * choice.
   */
  action?: { icon: LucideIcon; label: string; active: boolean; onPress: () => void };
}) {
  const { palette } = useTheme();
  const bounded = shouldBoundIntrinsicControls(useContentWidth());
  return (
    <View
      role="radiogroup"
      style={{
        flexDirection: "row",
        // Bounded by its own options once the container stops being a bound —
        // see `shouldBoundIntrinsicControls`. A phone keeps the full-width
        // control it expects; capping there only left a ragged edge beside it.
        maxWidth: bounded && !fill
          ? segmentedMaxWidth(options.length) + (action ? controlSize.minimumTarget : 0)
          : undefined,
        backgroundColor: palette.surface,
        borderRadius: radius.sm,
        padding: 0,
        marginBottom: noMargin ? 0 : spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              selectionTapIfChanged(value, option.value);
              if (!disabled) onChange(option.value);
            }}
            accessibilityRole="radio"
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected, disabled }}
            style={[
              {
                flex: 1,
                minHeight: controlSize.minimumTarget,
                paddingVertical: spacing.sm,
                paddingHorizontal: 2,
                borderRadius: 0,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected && disabled ? palette.surfaceAlt : "transparent",
                borderBottomWidth: 3,
                borderBottomColor: selected
                  ? disabled
                    ? palette.controlBorder
                    : palette.primary
                  : "transparent",
              },
            ]}
          >
            <Text
              style={[
                type.label,
                {
                  color: disabled ? palette.textSecondary : selected ? palette.textStrong : palette.textSecondary,
                  fontFamily: font.semibold,
                  textAlign: "center",
                  width: "100%",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          aria-expanded={action.active}
          accessibilityState={{ expanded: action.active }}
          onPress={action.onPress}
          style={({ pressed }) => ({
            width: controlSize.minimumTarget,
            minHeight: controlSize.minimumTarget,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? palette.surfaceHover : "transparent",
            borderBottomWidth: 3,
            borderBottomColor: action.active ? palette.primary : "transparent",
          })}
        >
          <action.icon
            accessible={false}
            size={iconSize.accessory}
            color={action.active ? palette.primaryText : palette.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Simple chip-row picker (categories, sources, persons); `multi` toggles a set. */
/**
 * A wrapping grid of multi-select tiles: icon column, label, check when picked.
 *
 * Built for the computed-column buckets, then reused for the suggested-items
 * template — the two screens ask the same question ("which of these do you
 * want?") of the same kind of thing, so they read as one control instead of a
 * grid on one screen and a chip row on the other. `tone` only chooses the accent
 * pair; the geometry is identical in every use, which is the point.
 */
export function SelectionGrid({
  options,
  values,
  onToggle,
  tone = "plus",
  countLabel,
  readOnly = false,
  disabled = false,
  searchable = false,
  status = "ready",
  errorMessage,
  emptyMessage,
}: {
  options: SelectionOption[];
  values: string[];
  onToggle: (value: string) => void;
  tone?: "plus" | "minus";
  /** Optional pill above the grid, e.g. "3 selected". */
  countLabel?: string;
  /** Render the same tiles as a non-interactive summary. */
  readOnly?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  status?: "ready" | "loading" | "error";
  errorMessage?: string;
  emptyMessage?: string;
}) {
  const { palette } = useTheme();
  const contentWidth = useContentWidth();
  const [query, setQuery] = useState("");
  const selectedColor = tone === "plus" ? palette.primary : palette.negative;
  const selectedSoft = tone === "plus" ? palette.primarySoft : palette.negative + "18";
  const selectedInk = tone === "plus" ? palette.primaryText : palette.negativeText;
  const inactive = readOnly || disabled || status !== "ready";
  const filtered = filterSelectionOptions(options, query);

  if (status === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md }}>
        <DelayedLoadingIndicator size={6} label={tr.selection.loading} />
        <Body muted>{tr.selection.loading}</Body>
      </View>
    );
  }
  if (status === "error") {
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ backgroundColor: palette.error + "14", borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
        <Body style={{ color: palette.errorText }}>{errorMessage ?? tr.selection.error}</Body>
      </View>
    );
  }

  return (
    <View>
      {searchable && options.length > 0 ? (
        <Field
          label={tr.selection.searchLabel}
          value={query}
          onChangeText={setQuery}
          placeholder={tr.selection.searchPlaceholder}
          autoCapitalize="none"
          returnKeyType="search"
          editable={!inactive}
        />
      ) : null}
      {countLabel ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.xs }}>
          <View style={{ borderRadius: 999, backgroundColor: selectedSoft, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
            <Text style={[type.small, { color: selectedInk, fontFamily: font.semibold }]}>{countLabel}</Text>
          </View>
        </View>
      ) : null}
      {options.length === 0 || filtered.length === 0 ? (
        <View accessibilityLiveRegion="polite" style={{ backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
          <Body muted>{options.length === 0 ? (emptyMessage ?? tr.selection.empty) : tr.selection.noResults}</Body>
        </View>
      ) : (
        <View
          role="group"
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md }}
        >
          {filtered.map((option) => {
            const selected = values.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="checkbox"
                aria-checked={selected}
                accessibilityState={{ checked: selected, selected, disabled: inactive }}
                disabled={inactive}
                onPress={() => {
                  selectionTap();
                  onToggle(option.value);
                }}
                style={({ pressed }) => ({
                  flexBasis: contentWidth >= 720 ? "31%" : "47%",
                  flexGrow: 1,
                  minWidth: 0,
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: selected ? selectedColor : palette.border,
                  backgroundColor: pressed ? palette.surfaceHover : selected ? selectedSoft : palette.surfaceAlt,
                })}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 10,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: selected ? selectedColor : palette.surface,
                  }}
                >
                  {selected ? (
                    <Check accessible={false} size={15} color={tone === "plus" ? palette.onPrimary : palette.onDestructive} strokeWidth={2.4} />
                  ) : option.icon ? (
                    <Text accessible={false} aria-hidden style={{ fontSize: 14 }}>{option.icon}</Text>
                  ) : tone === "plus" ? (
                    <Plus accessible={false} size={14} color={palette.textSecondary} />
                  ) : (
                    <Minus accessible={false} size={14} color={palette.textSecondary} />
                  )}
                </View>
                <Text style={[type.small, { flex: 1, minWidth: 0, color: selected ? selectedInk : palette.text, fontFamily: font.semibold }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * The single-choice control for a value the user is about to SAVE.
 *
 * The app has exactly two of these and the split is by job, not by taste:
 * `ChipPicker` answers a form question (which cycle, which person, month or
 * day), `Segmented` switches which view of the same data you are looking at
 * (pie or bars, rows or columns). The transaction form used to show three
 * languages at once — icon tiles, chips and underlined tabs — for three
 * questions of the same kind.
 */
export function ChipPicker<T extends string>({
  options,
  value,
  onChange,
  multi,
  values,
  onToggle,
  compact = false,
}: {
  options: { value: T; label: string; disabled?: boolean; hint?: string }[];
  value?: T | null;
  onChange?: (v: T) => void;
  multi?: boolean;
  values?: T[];
  onToggle?: (v: T) => void;
  /**
   * Tighter side padding, for a row whose labels are one or two characters.
   * A month-day row is six numbers and the words "Ayın sonu": at the default
   * padding the six numbers cost more in padding than in text and pushed the
   * words onto a second line. The touch target keeps its full height and gains
   * hit slop to make up the width.
   */
  compact?: boolean;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? spacing.xs + 2 : spacing.sm, marginBottom: spacing.md }}>
      {options.map((option) => {
        const selected = multi ? (values ?? []).includes(option.value) : option.value === value;
        const unavailable = option.disabled === true;
        // Selecting a chip must not resize it. The border used to thicken and
        // the label used to gain weight on selection, so every chip after it in
        // this wrapping row moved — and a row that wraps could re-wrap, which is
        // how choosing "Ayın sonu" shifted the field underneath it. One border
        // weight and one font weight for both states; colour carries the choice,
        // three times over. Paying for the thicker border out of the padding was
        // tried first and measured 84px against 85: browsers snap a 1.5px border
        // to a whole device pixel and the padding it was traded against is not.
        return (
          <Pressable
            key={option.value}
            disabled={unavailable}
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
            accessibilityHint={unavailable ? option.hint : undefined}
            aria-checked={selected}
            accessibilityState={{ checked: selected, selected, disabled: unavailable }}
            hitSlop={compact ? 8 : 4}
            // One selection language. This row used to be fully rounded pills
            // while the same question asked as a grid — pick your columns, pick
            // your categories — was answered with bordered tiles, so two
            // controls doing the same job on adjacent screens looked unrelated.
            // The tile's shape, border and selected treatment win because they
            // survive a long label and read as chosen without relying on fill
            // alone; the pill's geometry and touch target are unchanged.
            style={({ pressed }) => ({
              paddingVertical: spacing.sm + 2,
              paddingHorizontal: compact ? spacing.sm + 2 : spacing.md + 2,
              borderRadius: radius.md,
              borderWidth: borderWidth.control,
              borderColor: selected ? palette.primary : palette.border,
              backgroundColor: pressed
                ? palette.surfaceHover
                : selected ? palette.primarySoft : palette.surfaceAlt,
              opacity: unavailable ? 0.45 : 1,
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
            })}
          >
            <Text
              style={[
                type.label,
                {
                  color: selected ? palette.primaryText : palette.text,
                  fontFamily: font.semibold,
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
export const STATUS_W = 88;

export function StatusPill({ label, color, foreground = color }: { label: string; color: string; foreground?: string }) {
  return (
    <View
      style={{
        width: STATUS_W,
        minHeight: controlSize.compact,
        borderRadius: radius.md,
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

export function EmptyState({
  icon: IconCmp,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  /** The way out of the empty state. Belongs to the message, so it travels
   *  with it when the block centres itself instead of being left at the foot
   *  of the page a screen-height away from the sentence it answers. */
  action?: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    // `flexGrow` with a centred main axis, not a fixed block: on a phone there
    // is no spare height and this is exactly the padded block it always was,
    // while on a 900px desktop viewport the same message used to sit against
    // the header with two thirds of the page empty beneath it.
    <View style={{ flexGrow: 1, justifyContent: "center", padding: spacing.xxl, alignItems: "center", gap: spacing.sm }}>
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
          <IconCmp accessible={false} size={26} color={palette.textSecondary} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
      {hint ? <Text style={[type.body, { color: palette.textSecondary, textAlign: "center" }]}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </View>
  );
}

/** Distinguishes first-load failure from a genuine empty account. */
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
      <DelayedLoading>
        <View
          accessibilityLiveRegion="polite"
          style={{ alignItems: "center", gap: spacing.sm, marginBottom: spacing.md, paddingVertical: spacing.md }}
        >
          <LoadingIndicator />
          <Body muted>{tr.dataState.loading}</Body>
        </View>
      </DelayedLoading>
    );
  }
  const stale = status === "stale";
  return (
    <FadeIn
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: (stale ? palette.warning : palette.error) + "14",
        borderColor: (stale ? palette.warning : palette.error) + "55",
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        gap: spacing.sm,
      }}
    >
      <TriangleAlert accessible={false} size={18} color={stale ? palette.warning : palette.error} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body>{stale ? tr.dataState.stale : tr.dataState.error}</Body>
        <View style={{ alignSelf: "flex-start", marginTop: spacing.sm }}>
          <Button size="sm" variant="secondary" label={tr.common.retry} onPress={retry} />
        </View>
      </View>
    </FadeIn>
  );
}

/** Delayed long-operation feedback with caller-owned progress and cancellation. */
export function OperationStatusNotice({
  state,
  label,
  onCancel,
}: {
  state: TrackedOperationState;
  label: string;
  /** Omit once an atomic commit starts because abort cannot roll it back. */
  onCancel?: () => void;
}) {
  const { palette } = useTheme();
  if (!state.active) return null;
  return (
    <DelayedLoading>
      <View
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: palette.surfaceAlt,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          padding: spacing.md,
          marginBottom: spacing.md,
          gap: spacing.sm,
        }}
      >
        <Row gap={spacing.md} style={{ alignItems: "center" }}>
          <LoadingIndicator progress={state.progress} label={label} />
          <View style={{ flex: 1 }}>
            <Body>{label}</Body>
            {state.progress ? (
              <Body muted style={{ marginTop: spacing.xs }}>
                {tr.operation.progress(state.progress.completed, state.progress.total)}
              </Body>
            ) : null}
          </View>
        </Row>
        <Body muted>{tr.operation.dataSafe}</Body>
        {onCancel ? (
          <View style={{ alignSelf: "flex-start" }}>
            <Button size="sm" variant="ghost" label={tr.common.cancel} onPress={onCancel} />
          </View>
        ) : null}
      </View>
    </DelayedLoading>
  );
}

/** The whole screen while the account's first data pull is still in flight. */
/**
 * The whole screen while an account operation runs.
 *
 * Signing out, freezing and deleting all end the session on this same blank
 * page, so it has to say which one is running — and it is the only thing on
 * that page, so a 360px bordered strip pinned in the middle of an empty window
 * reads as a placeholder rather than as the app working. It takes the page.
 */
export function WaitingNotice({ message, title, kind }: { message: string; title: string; kind: OperationFlowKind }) {
  return (
    <DelayedLoading>
      <View testID="waiting-notice" style={{ width: "100%", alignItems: "center", paddingHorizontal: spacing.lg }}>
        <OperationFlow kind={kind} title={title} label={message} presentation="waiting" />
      </View>
    </DelayedLoading>
  );
}

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border, marginVertical: spacing.sm }} />;
}

/** Card list with separators only between rows. */
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

/** Shared icon/title/accessory list row. */
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
  /** A plain string gets the row's caption styling; a node renders as given. */
  subtitle?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  /** Moves a wide action cluster below the label on phone-width viewports. */
  stackRightOnNarrow?: boolean;
}) {
  const { palette } = useTheme();
  // The row lays itself out inside the content column, so it measures that
  // column — not the window the rail also takes a share of.
  const contentWidth = useContentWidth();
  const stackRight = Boolean(right && stackRightOnNarrow && shouldStackListActions(contentWidth));
  const content = (
    <View style={{ paddingVertical: spacing.md - 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      {leading}
      {IconCmp ? (
        <View style={{ width: 24, height: controlSize.compact, alignItems: "flex-start", justifyContent: "center" }}>
          <IconCmp accessible={false} size={17} color={iconColor ?? palette.accentText} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { color: palette.text, fontFamily: font.medium, flexShrink: 1 }]}>
          {title}
        </Text>
        {typeof subtitle === "string" ? (
          <Text style={[type.small, { color: palette.textSecondary, marginTop: 1, flexShrink: 1 }]}>
            {subtitle}
          </Text>
        ) : subtitle ? (
          <View style={{ marginTop: 1 }}>{subtitle}</View>
        ) : null}
      </View>
      {stackRight ? null : right}
      {chevron ? <ChevronRight accessible={false} size={17} color={palette.textSecondary} /> : null}
      </View>
      {stackRight ? (
        <View style={{ marginTop: spacing.sm, marginLeft: IconCmp || leading ? 28 + spacing.md : 0, alignItems: "flex-end" }}>
          {right}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return <PressableRow onPress={onPress}>{content}</PressableRow>;
}

/** How far a row's pressed fill reaches past its own content, each side. */
const PRESS_BLEED = spacing.sm;

/**
 * List row wrapper with quiet, interruptible tonal press feedback.
 *
 * The fill reaches past the text on both sides. Painted on the bare content
 * box it started exactly at the first glyph, so holding a settings row lit a
 * rectangle that looked cropped against its own card — the row read as
 * highlighted only where it had words. The negative margin borrows from the
 * card's own padding and the matching inset gives it straight back, so nothing
 * moves and only the lit area grows.
 */
function PressableRow({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: -PRESS_BLEED,
        paddingHorizontal: PRESS_BLEED,
        backgroundColor: pressed ? palette.surfaceHover : "transparent",
        borderRadius: radius.sm,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      {children}
    </Pressable>
  );
}

/** Cross-platform toggle with one theme-aware geometry. */
const TOGGLE_W = toggleSize.width;
const TOGGLE_H = toggleSize.height;
const TOGGLE_PAD = toggleSize.padding;
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
    const animation = Animated.spring(progress, { toValue: value ? 1 : 0, useNativeDriver: false, ...motion.spring.toggle });
    animation.start();
    return () => animation.stop();
  }, [value, progress, reducedMotion]);
  // On is the filled state. It used to be the pale one while off was the
  // darker `surfaceStrong`, so a settings list read back inverted: the switches
  // that were OFF looked heavier than the ones that were ON. The brand fill is
  // 5.3–7.2:1 against every surface it sits on, so the on state carries itself;
  // the off state stays a quiet neutral and keeps the hairline that gives it a
  // shape at all.
  const trackColor = disabled
    ? palette.surfaceAlt
    : progress.interpolate({ inputRange: [0, 1], outputRange: [palette.surfaceAlt, palette.primary] });
  const thumbX = progress.interpolate({ inputRange: [0, 1], outputRange: [TOGGLE_PAD, TOGGLE_W - TOGGLE_THUMB - TOGGLE_PAD] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      aria-checked={value}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={10}
      disabled={disabled}
      onPress={() => {
        selectionTap();
        onValueChange(!value);
      }}
      // The track is 28pt tall by design. Padding — not `hitSlop`, which the
      // web ignores — gives the control the platform's minimum height without
      // moving the track a pixel.
      style={{
        minHeight: controlSize.minimumTarget,
        justifyContent: "center",
        paddingHorizontal: (controlSize.minimumTarget - TOGGLE_W) / 2 > 0 ? (controlSize.minimumTarget - TOGGLE_W) / 2 : 0,
      }}
    >
      {/* The off fill is a low-contrast warm neutral (1.1–1.3:1 against the
          app's surfaces), so the boundary is what gives it a shape at all —
          on the refund row, whose background was the same token, the switch
          once disappeared outright. The on fill needs no such help, and a
          hairline in `controlBorder` would sit at 1.2:1 on it, so the on state
          edges itself. */}
      <Animated.View
        style={{
          width: TOGGLE_W,
          height: TOGGLE_H,
          borderRadius: TOGGLE_H / 2,
          backgroundColor: trackColor,
          borderWidth: borderWidth.toggle,
          borderColor: value && !disabled ? palette.primaryStrong : palette.controlBorder,
          justifyContent: "center",
        }}
      >
        <View
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            left: 7,
            right: 7,
            top: 0,
            bottom: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Check size={11} color={value && !disabled ? palette.onPrimary : "transparent"} strokeWidth={3} />
          <Minus size={11} color={!value && !disabled ? palette.textSecondary : "transparent"} strokeWidth={3} />
        </View>
        {/* The thumb carries the tab bar's material language — a crisp hairline
            edge over the shadow, so it reads as a lens sitting on the track
            rather than a flat dot. The TRACK deliberately stays opaque: its two
            fills are what `theme-contrast.test.ts` measures, and letting the
            row behind show through is how this control once vanished
            completely on the refund row. */}
        <Animated.View
          style={{
            width: TOGGLE_THUMB,
            height: TOGGLE_THUMB,
            borderRadius: TOGGLE_THUMB / 2,
            backgroundColor: disabled ? palette.textSecondary : value ? palette.onPrimary : palette.textSecondary,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.surfaceTranslucent,
            transform: [{ translateX: thumbX }],
            ...toggleThumbShadow,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Initials avatar with a deterministic hue from the name (logo fallback). */
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
