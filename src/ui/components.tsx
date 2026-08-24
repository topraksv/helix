/**
 * The composite layer of the design system: screens, cards, fields, pickers,
 * lists and state notices.
 *
 * The leaves — text roles, `Button`, `IconButton`, `FadeIn`, `Amount`, the
 * status marks — live in `./primitives` and are re-exported from here, so a
 * screen keeps one import and the calculator can take `Button` without closing
 * a cycle back through this module.
 */



import React, { useRef, type ReactNode } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSegments } from "expo-router";
import { useScrollToTop } from "@react-navigation/native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import type { LucideIcon } from "lucide-react-native";
import { DelayedLoading, LoadingIndicator } from "./loading-indicator";
import type { TrackedOperationState } from "./operation-guard";
import { tr } from "../i18n/tr";
import type { LiveQueryStatus } from "../data/live-state";
import { interactionSurface } from "./interaction";
import { useReducedMotion } from "./motion";
import {
  Amount,
  Body,
  Button,
  Divider,
  FadeIn,
  Row,
  useLedeAlignment,
} from "./primitives";
import { circle, contentWidth, density, font, heroSurface, iconSize, motion, radius, spacing, staggerDelay, type, type ContentWidth, useTheme } from "./theme";
import { shouldStackListActions, shouldStackPanelAction, shouldUseWideGutter } from "./responsive";
import { useContentWidth, useNavigationSpace } from "./viewport";
import { OperationFlow, type OperationFlowKind } from "./operation-flow";
import { KeyboardSafeScrollView } from "./keyboard-safe";
import { ScreenVisitContext, useScreenVisitController } from "./motion-primitives";

export {
  Amount,
  Badge,
  Body,
  Button,
  controlStateStyle,
  DisclosureChevron,
  Divider,
  Eyebrow,
  FadeIn,
  Heading,
  IconButton,
  InitialsBadge,
  InlineDisclosure,
  Label,
  Row,
  SegmentBar,
  Skeleton,
  Spread,
  STATUS_W,
  Title,
} from "./primitives";

export { Field, MoneyField, MonthStepper, Toggle } from "./fields";
export { ChipPicker, ChoiceTile, Segmented, Select, SelectionGrid } from "./selection-controls";

/**
 * A screen arriving for the FIRST time, said with movement instead of opacity.
 *
 * Fading a whole page up from zero is what reads as a refresh: for a few
 * frames the window is empty and then the entire document paints at once,
 * which is exactly the shape of a reload. So the page never changes opacity;
 * it rises into place, which is motion a reload cannot produce.
 *
 * It rises ONCE, on mount, and never again. Replaying it per visit is what
 * three rounds of "girip çıkınca ekran tık diye yenileniyor" were about, and
 * this was the whole of it: measured on the dashboard, every back-navigation
 * AND every tab switch moved the entire 758-node page to +14pt and sprang it
 * back over 21 frames. Nothing was remounting and nothing was refetching —
 * the node count was identical before, during and after — so the only thing
 * a reader could be reacting to was the page itself moving under them. A
 * whole-page motion cannot say "this screen is alive" without also saying
 * "this screen just reloaded", because those look the same.
 *
 * Arriving somewhere new still moves: a pushed screen mounts, so it animates.
 * Coming back to a screen that never went away does not, because nothing
 * about it is new. What replays instead is per-element and local — `useDrawIn`
 * redraws a chart, `FadeIn` with a `replayToken` restages a list — and those
 * still hang off the visit counter. Those are the animations the owner asked
 * to keep; this was the one they asked to stop.
 *
 * It is also the cheapest frame on the web build: `useNativeDriver` is false
 * there, so this was a JS-driven transform of a wrapper holding the entire
 * page, recomputed every frame of every navigation.
 */
function ScreenEntrance({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reducedMotion = useReducedMotion();
  // Starts where it will be drawn, so the first painted frame is already
  // correct. Seeding at rest and moving it in an effect showed one frame at
  // the settled position before the offset applied, which is a flicker.
  const [progress] = React.useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  React.useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: Platform.OS !== "web",
      ...motion.spring.entrance,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return (
    <Animated.View
      testID="screen-entrance"
      style={[
        { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_ARRIVAL_RISE, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * How far a screen rises as it arrives.
 *
 * Large enough to be unmistakably motion at a glance — 3pt was tried and read
 * as nothing — and small enough that it never uncovers the edge of the
 * scroller or looks like a page transition.
 */
const SCREEN_ARRIVAL_RISE = 14;

/**
 * The shared look of every control that accepts a value: text fields, selects
 * and the date trigger. Exported because the date trigger lives in
 * `calendar.tsx` and had grown its own `surfaceAlt` fill, which is why one
 * field on an investment form was grey while the two beside it were not.
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
  const { width, height } = useWindowDimensions();
  const maxWidth = contentWidth[widthName];
  const segments = useSegments();
  // The navigator's arrival event must not be React state owned by Screen:
  // changing it would render the entire page just to restart an entrance.
  const visitStore = useScreenVisitController();
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
            // The whole app announced every heading at level 1 — nine of them
            // on Settings alone — because React Native's `header` role carries
            // no level and nothing supplied one. Heading-to-heading jumping is
            // how a screen reader user navigates a long page, and with one
            // flat level it tells them nothing. Three levels, one meaning
            // each: the page, its sections, the panels inside them.
            aria-level={1}
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

  // Navigation and keyboard insets have different owners. `bottomPad` remains
  // our static safe-area/tab-bar contract; KeyboardSafeScrollView adds only the
  // temporary keyboard room and follows its native animation. This avoids the
  // old UIKit inset accumulation that grew a screen after every app switch.
  if (!scroll) {
    return (
      // The rail's space is taken here, by the content, and not by the tab scene:
    // a scene-level inset also shortened the nested stack's header, which is
    // chrome that belongs to the whole window.
    <View style={{ flex: 1, backgroundColor: palette.background, paddingLeft: navLeft }}>
        {/* A tab arrival replays only this wrapper; child state stays mounted.
            A Back navigation remains inside the same tab and therefore keeps
            the settled scaffold instead of making a completed form look reset. */}
        <ScreenVisitContext.Provider value={visitStore}>
          <ScreenEntrance style={[{ flex: 1 }, inner]}>
            {header}
            {children}
          </ScreenEntrance>
        </ScreenVisitContext.Provider>
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
      <KeyboardSafeScrollView
        ref={activeScrollRef}
        contentContainerStyle={inner}
        bottomOffset={Math.min(160, Math.round(height * 0.24))}
        extraKeyboardSpace={bottomPad}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        automaticallyAdjustContentInsets={false}
      >
        {/* Carries the container's grow through to the children, so a screen
            with one short block can centre it rather than stack it at the top
            of an empty page. */}
        <ScreenVisitContext.Provider value={visitStore}>
          <ScreenEntrance style={{ flexGrow: 1 }}>
            {header}
            {children}
          </ScreenEntrance>
        </ScreenVisitContext.Provider>
      </KeyboardSafeScrollView>
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  onLayout,
  padded = true,
  rows = false,
  tone,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  padded?: boolean;
  /**
   * The children are `ListRow`s, which carry their own vertical padding and
   * bleed their fill to the card's edges.
   *
   * Without this the card's own 13px sat OUTSIDE every row's pressable, so a
   * hovered row lit a band that stopped short of the card top and bottom. On a
   * card holding one row — Bakiye Düzeltme, Tanıtım Turu — that reads as a
   * control smaller than the box it lives in, while the same row inside a
   * multi-row card looked correct. One rule for both.
   */
  rows?: boolean;
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
      paddingHorizontal: padded ? density.list.cardPadding : 0,
      // Rows own the vertical space so their fill can reach the card's edge;
      // the card still clips (`overflow: hidden`), so the horizontal bleed
      // lands exactly on the border rather than past it.
      paddingVertical: rows ? 0 : padded ? density.list.cardPadding : 0,
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
        style={(state) => [
          base,
          style,
          interactionSurface(palette, state),
          state.pressed && { transform: [{ translateY: 1 }] },
        ]}
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
 * three peers reading as two-then-one. They share the row now, and every money
 * value uses the global compact formatter once it reaches the large-number
 * threshold, rather than asking each strip to decide its own unit.
 */
export function MetricStrip({
  items,
  align = "start",
  style,
  testID,
}: {
  /**
   * One shape, not two.
   *
   * `value` used to be `ReactNode | ((compact: boolean) => ReactNode)`, so
   * every call site had to know which of the two forms it was writing and six
   * of the nine picked the function only to forward one boolean. A metric is
   * either an amount — which the shared `Amount` primitive formats and fits —
   * or something that is not money, which is given as a node and left alone.
   */
  items: {
    label: string;
    /** Money. Rendered through the shared `Amount` display policy. */
    minor?: number;
    /** Colour for the figure; defaults to the app's neutral ink. */
    color?: string;
    /** Anything that is not money — a count, a badge. */
    node?: ReactNode;
  }[];
  /**
   * How each column's label and figure sit inside their equal share.
   *
   * Left is right when the strip reads as a continuation of the block above
   * it. Centred is right when the labels are long enough to wrap unevenly —
   * three columns of ragged left-aligned text read as a layout accident,
   * where the same columns centred read as a deliberate row of figures.
   */
  align?: "start" | "center";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { palette } = useTheme();
  const centered = align === "center";
  return (
    <View
      testID={testID}
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
        <View key={item.label} style={{ flex: 1, flexBasis: 0, minWidth: 0, paddingTop: spacing.sm, alignItems: centered ? "center" : "stretch" }}>
          <Text
            style={[
              type.small,
              {
                color: palette.textSecondary,
                // A short label such as "Aktif ürünler" used to leave its
                // value one line higher than the two-line money labels beside
                // it. Reserve the shared two-line label slot so every metric
                // reaches the same value floor at phone widths.
                minHeight: Math.round(type.small.fontSize * 2.2),
                lineHeight: type.small.fontSize * 1.1,
                textAlign: centered ? "center" : "left",
              },
            ]}
          >
            {item.label}
          </Text>
          {/* One bottom edge for all three figures. Each one fits itself to its
              own column, so a long amount beside a short one ends up a step
              smaller — and a smaller line box sits higher, which is the "not
              quite on the same line" the owner saw with three columns of
              filtered totals. The row is as tall as the largest figure and they
              hang from its floor. */}
          <View style={{ marginTop: 2, minHeight: Math.round(type.amount.fontSize * 1.4), justifyContent: "flex-end" }}>
            {item.minor != null ? (
              <Amount
                minor={item.minor}
                colorized={false}
                color={item.color ?? palette.textStrong}
                style={{ textAlign: centered ? "center" : "left" }}
              />
            ) : item.node}
          </View>
        </View>
      ))}
    </View>
  );
}

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
          aria-level={2}
          style={[
            type.heading,
            {
              color: palette.textStrong,
              fontSize: type.sectionTitle.fontSize,
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
/** The square a panel's mark is drawn in. */
const PANEL_MARK = 36;

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
  const stackRight = Boolean(right) && shouldStackPanelAction(viewportWidth);
  const lede = useLedeAlignment(PANEL_MARK);
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
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          accessible={false}
          style={{
            width: PANEL_MARK,
            height: PANEL_MARK,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone === "primary" ? palette.primarySoft : toneColor + "18",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: toneColor + "72",
            ...lede.markStyle,
          }}
        >
          <IconCmp accessible={false} size={17} color={tone === "primary" ? palette.accentText : toneColor} strokeWidth={2} />
        </View>
        {/* Keyed on the title, so the entrance re-runs whenever the panel
            changes subject. This is the one editor in each settings screen and
            it switches between "add" and "editing X" in place — without the
            re-entrance, the only sign that pressing edit did anything was one
            word changing several lines above the button that was pressed. */}
        <FadeIn key={title} style={{ flex: 1, minWidth: 0 }}>
          <View onLayout={lede.onBlockLayout}>
            <Text
              accessibilityRole="header"
              aria-level={3}
              onLayout={lede.onLineLayout}
              style={[type.body, { color: palette.textStrong, fontFamily: font.semibold }]}
            >
              {title}
            </Text>
            {description ? (
              <Text style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}>{description}</Text>
            ) : null}
          </View>
        </FadeIn>
        {!stackRight ? right : null}
      </View>
      {stackRight ? <View style={{ marginLeft: PANEL_MARK + spacing.md }}>{right}</View> : null}
    </View>
  );
}

/** Signed money text: red for negatives, tabular figures. */
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
    <FadeIn style={{ flexGrow: 1, justifyContent: "center", padding: spacing.xxl, alignItems: "center", gap: spacing.sm }}>
      {IconCmp ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: circle(56),
            backgroundColor: palette.surfaceAlt,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: spacing.xs,
          }}
        >
          <IconCmp accessible={false} size={26} color={palette.textSecondary} strokeWidth={1.8} />
        </View>
      ) : null}
      <Text accessibilityRole="header" aria-level={2} style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
      {hint ? <Text style={[type.body, { color: palette.textSecondary, textAlign: "center" }]}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </FadeIn>
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
          <FadeIn delay={staggerDelay(i, items.length)}>{renderItem(item, i)}</FadeIn>
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
  // Same rule as `PanelHeader`: the mark centres against its own text and
  // stops travelling once that text is three lines long.
  const lede = useLedeAlignment(iconSize.control);
  const content = (
    <View style={{ paddingVertical: spacing.md - 2 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
      {leading}
      {IconCmp ? (
        <View style={{ width: 24, alignItems: "flex-start", ...lede.markStyle }}>
          <IconCmp accessible={false} size={iconSize.control} color={iconColor ?? palette.accentText} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, ...lede.textStyle }} onLayout={lede.onBlockLayout}>
        <Text onLayout={lede.onLineLayout} style={[type.body, { color: palette.text, fontFamily: font.medium, flexShrink: 1 }]}>
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
      {stackRight ? null : <View onLayout={lede.onTrailingLayout} style={lede.blockStyle}>{right}</View>}
      {chevron ? (
        <View style={lede.blockStyle}>
          <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} />
        </View>
      ) : null}
      </View>
      {stackRight ? (
        <View style={{ marginTop: spacing.sm, marginLeft: IconCmp || leading ? 24 + spacing.md : 0, alignItems: "flex-end" }}>
          {right}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return <PressableRow onPress={onPress}>{content}</PressableRow>;
}

/**
 * How far a row's fill reaches past its own content, each side.
 *
 * Exactly the card's own padding, so a hovered row lights the card from edge to
 * edge. At `spacing.sm` it stopped 4px short of that edge on both sides, which
 * does not read as a decision — it reads as a fill that missed.
 */
const PRESS_BLEED = density.list.cardPadding;

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
      style={(state) => ({
        marginHorizontal: -PRESS_BLEED,
        paddingHorizontal: PRESS_BLEED,
        ...interactionSurface(palette, state),
        borderRadius: radius.sm,
        transform: [{ translateY: state.pressed ? 1 : 0 }],
      })}
    >
      {children}
    </Pressable>
  );
}

/** Cross-platform toggle with one theme-aware geometry. */

/**
 * A control and the sentence that belongs to it, as one block.
 *
 * A control carries its own bottom margin, so a hint placed after it sits a
 * full step away and reads as the next thing rather than as part of this one.
 * The pull-up cancels part of that margin — which is fine, and was already
 * being done, but it was being done inline on each screen with a different
 * number each time. One definition, one gap, and the block below it keeps the
 * form's normal rhythm.
 */
export function FieldNote({ children, note }: { children: ReactNode; note: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {children}
      <Text style={[type.small, { color: palette.textSecondary, marginTop: -spacing.sm }]}>{note}</Text>
    </View>
  );
}
