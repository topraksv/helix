/**
 * The composite layer of the design system: screens, cards, fields, pickers,
 * lists and state notices.
 *
 * The leaves — text roles, `Button`, `IconButton`, `FadeIn`, `Amount`, the
 * status marks — live in `./primitives` and are re-exported from here, so a
 * screen keeps one import and the calculator can take `Button` without closing
 * a cycle back through this module.
 */

import React, { useMemo, useRef, type ComponentProps, type ReactNode } from "react";
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
import { useScrollToTop, useSegments } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import type { LucideIcon } from "lucide-react-native";
import { DelayedLoading, LoadingIndicator } from "./loading-indicator";
import type { TrackedOperationState } from "./operation-guard";
import { tr } from "../i18n/tr";
import type { LiveQueryStatus } from "../data/live-state";
import { interactionBleed, interactionSurface } from "./interaction";
import {
  Amount,
  Body,
  Button,
  Divider,
  FadeIn,
  Row,
  Skeleton,
  useLedeAlignment,
} from "./primitives";
import { RowMotion } from "./list-motion";
import { circle, contentWidth, density, font, heroSurface, iconSize, radius, spacing, staggerDelay, type, type ContentWidth, useTheme } from "./theme";
import { shouldStackListActions, shouldStackPanelAction, shouldUseWideGutter } from "./responsive";
import { useContentWidth, useNavigationSpace } from "./viewport";
import { OperationFlow, type OperationFlowKind } from "./operation-flow";
import { KeyboardSafeScrollView } from "./keyboard-safe";
import { useKeyboardReachableScroller } from "./accessibility";
import { ScreenVisitContext, useEntranceProgress, useScreenVisitController } from "./motion-primitives";

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
  useLedeAlignment,
} from "./primitives";

export { Field, InlineEditRow, MoneyField, MonthStepper, Toggle, ToggleRow } from "./fields";
export { ChipPicker, ChoiceTile, Segmented, Select, SelectionGrid } from "./selection-controls";

/**
 * A screen arriving for the first time rises into place instead of fading: fading a whole page up from zero is the shape of a reload.
 * It rises once, on mount; replaying it per visit read as the page reloading. Per-element replays (`useDrawIn`, `FadeIn`) stay.
 */
function ScreenEntrance({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useEntranceProgress();
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

/** How far a screen rises as it arrives; 3pt read as nothing. */
const SCREEN_ARRIVAL_RISE = 14;

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
  readable = false,
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
  /**
   * A long read with no controls in it: makes the scroll region focusable on web so a keyboard can move it. Set only where true; elsewhere it is a stray tab stop.
   */
  readable?: boolean;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const maxWidth = contentWidth[widthName];
  const segments = useSegments();
  // The arrival event is not React state: changing it would render the whole page just to restart an entrance.
  const visitStore = useScreenVisitController();
  // The navigator's own hook resolves nested stacks and a listener that called preventDefault; outside a tab navigator it is a no-op.
  const ownScrollRef = useRef<ScrollView>(null);
  const activeScrollRef = scrollRef ?? ownScrollRef;
  useScrollToTop(activeScrollRef);
  // Opt-in: an effect in the most-used primitive would solve a problem few screens have; e2e/visual-a11y.spec.ts catches the next one.
  useKeyboardReachableScroller(activeScrollRef, readable);
  // A margin to read as a page: the phone gutter is the thumb's, a pointer-sized viewport gets a real one.
  const gutter = shouldUseWideGutter(width) ? spacing.xxl : spacing.lg;
  // The tab bar floats over its scene, so the last row would sit under it; a modal or stack scene needs only the safe-area inset.
  const { bottom: navBottom, inTabs } = useNavigationSpace();
  const bottomPad = inTabs ? navBottom : Math.max(insets.bottom, spacing.lg) + spacing.md;
  // Headerless full screens must clear the status bar / Dynamic Island; a stack header already reserves the inset, and adding it would double-pad.
  const needsTopInset = title != null || segments[0] === "(auth)" || segments[0] === "(onboarding)";

  const header =
    title != null ? (
      // Identified so a visual baseline can mask it: the greeting and date derive from the clock.
      <View testID="screen-header" style={{ marginBottom: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            // RN's `header` role carries no level: three levels, one meaning each (page, section, panel).
            aria-level={1}
            style={[type.title, { color: palette.textStrong, minWidth: 0, flexShrink: 1 }]}
          >
            {title}
          </Text>
          {/* The subtitle's line is held even when empty so a tab change does not move the title; the no-break space keeps it from collapsing on web. */}
          <Text
            aria-hidden={!subtitle}
            style={[type.small, { color: palette.textSecondary, marginTop: 2 }]}
          >
            {subtitle || " "}
          </Text>
        </View>
        {right}
      </View>
    ) : null;

  const inner: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: gutter },
    { paddingTop: needsTopInset ? Math.max(insets.top, spacing.lg) : spacing.lg },
    { paddingBottom: bottomPad },
    // Unconditional: below its cap the column simply fills, with no second layout mode.
    { width: "100%", maxWidth, alignSelf: "center" },
    // Lets a short page centre its own content; no effect once it is taller than the viewport.
    { flexGrow: 1 },
  ];

  // Navigation and keyboard insets have different owners: `bottomPad` is static, KeyboardSafeScrollView adds only the temporary keyboard room.
  if (!scroll) {
    return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
        {/* A tab arrival replays only this wrapper; Back stays in the same tab and keeps the settled scaffold. */}
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
    // The content takes the rail's space, not the tab scene: a scene-level inset also shortened the nested stack's header.
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {/* The scroll edge, only where the screen starts at the top of the window. `needsTopInset`, not `insets.top > 0`: under a stack header the strip hid the first 59pt of the form. */}
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
        {/* Carries the container's grow to the children, so one short block can centre. */}
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
   * Without this the card's own padding sits OUTSIDE every row's pressable, so
   * a hovered row lights a band that stops short of the card's top and bottom.
   * On a card holding one row that reads as a control smaller than the box it
   * lives in, while the same row inside a multi-row card looks correct. Any
   * card whose children are rows sets it.
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
      // `rows` gives the card's vertical padding to the rows, inside their pressables, so a hovered first or last row lights to the border (the card clips).
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

/** A row of labelled figures that stays a row; every money value uses the shared compact formatter at the large-number threshold. */
export function MetricStrip({
  items,
  align = "start",
  style,
  testID,
}: {
  /** One shape: money goes through the shared `Amount`; anything else is a node, left alone. */
  items: {
    label: string;
    /** Money. Rendered through the shared `Amount` display policy. */
    minor?: number;
    /** Colour for the figure; defaults to the app's neutral ink. */
    color?: string;
    /** Anything that is not money — a count, a badge. */
    node?: ReactNode;
  }[];
  /** Start reads as a continuation of the block above; centre suits labels long enough to wrap unevenly. */
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
          {/* One bottom edge for the figures: each fits its own column, and a smaller line box sits higher, so the row is as tall as the largest and they hang from its floor. */}
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

/** The square a panel's mark is drawn in. */
const PANEL_MARK = 36;

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
  const stackRight = Boolean(right) && shouldStackPanelAction(viewportWidth);
  const lede = useLedeAlignment(PANEL_MARK);
  const toneColor = palette[tone];
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
        {/* Keyed on the title: the one editor per settings screen switches between "add" and "editing X" in place, and the re-entrance is the sign it did. */}
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

export function EmptyState({
  icon: IconCmp,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  /** The way out of the empty state; it travels with the message when the block centres. */
  action?: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    // `flexGrow` with a centred main axis: no change on a phone, but on a desktop the message no longer sits against the header.
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

/**
 * The frame a data-backed screen shows before its rows exist: a component with children and screen props, not a fixed frame,
 * because the loading and ready frames must be allowed to differ (see `analytics.tsx`). The early return stays at the call site,
 * so the ready branch's JSX is never built out of data that is not there yet.
 */
export function DataGateScreen({
  status,
  retry,
  children,
  skeleton,
  ...screen
}: {
  status: LiveQueryStatus;
  retry: () => void;
  /** Chrome this screen needs while loading too — a title, a header block. */
  children?: ReactNode;
  /** The shape the screen will have once the data lands; without one the page is blank and then shifts, which the web-vitals budget refuses. */
  skeleton?: ReactNode;
} & Omit<ComponentProps<typeof Screen>, "children">) {
  return (
    <Screen {...screen}>
      {children}
      {status === "loading" && skeleton ? skeleton : <DataStateNotice status={status} retry={retry} />}
    </Screen>
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
  if (status === "ready") return null;
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

/** The whole screen while an account operation runs: signing out, freezing and deleting end the session on the same blank page, so it names which. */
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
  // The cascade belongs to the list's own arrival: applied every render it delayed a newly inserted row by the whole stagger budget.
  // The mount's membership is captured once and read, not a ref mutated during render (`react-hooks/refs`).
  const arrived = useMemo(
    () => new Set(items.map((item, index) => keyExtractor(item, index))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mount's membership is the whole point; recomputing it would restore the bug.
    [],
  );
  if (items.length === 0) return null;
  return (
    <Card style={style} padded={padded}>
      {header}
      {items.map((item, i) => (
        <RowMotion key={keyExtractor(item, i)}>
          {i > 0 ? <Divider flush /> : null}
          <FadeIn delay={arrived.has(keyExtractor(item, i)) ? staggerDelay(i, items.length) : 0}>{renderItem(item, i)}</FadeIn>
        </RowMotion>
      ))}
    </Card>
  );
}

/** The shape a list keeps while its rows are read: a gap the real card pushes open is a layout shift the web-vitals budget refuses. */
export function CardListSkeleton({
  rows = 3,
  style,
}: {
  rows?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card style={style}>
      {Array.from({ length: rows }, (_, row) => (
        <Row key={row} gap={spacing.md} style={{ alignItems: "center", paddingVertical: spacing.md - 2 }}>
          <Skeleton width={24} height={24} radius={radius.sm} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={type.body.fontSize} />
            <Skeleton width="40%" height={type.small.fontSize} />
          </View>
        </Row>
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
  // Measures the content column, not the window.
  const contentWidth = useContentWidth();
  const stackRight = Boolean(right && stackRightOnNarrow && shouldStackListActions(contentWidth));
  // Same rule as `PanelHeader`: the mark centres against its own text and stops travelling once that text is three lines long.
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

/** The fill reaches past the text: the negative margin borrows from the card's padding and the inset gives it back, so only the lit area grows. */
function PressableRow({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={(state) => ({
        ...interactionBleed(),
        ...interactionSurface(palette, state),
        borderRadius: radius.sm,
        transform: [{ translateY: state.pressed ? 1 : 0 }],
      })}
    >
      {children}
    </Pressable>
  );
}

/** A control and its hint as one block: the pull-up cancels part of the control's bottom margin, once instead of per screen. */
export function FieldNote({ children, note }: { children: ReactNode; note: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      {children}
      <Text style={[type.small, { color: palette.textSecondary, marginTop: -spacing.sm }]}>{note}</Text>
    </View>
  );
}
