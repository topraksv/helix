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
import {
  Amount,
  Body,
  Button,
  Divider,
  FadeIn,
  Row,
  useLedeAlignment,
} from "./primitives";
import { circle, contentWidth, density, font, heroSurface, iconSize, radius, spacing, staggerDelay, type, type ContentWidth, useTheme } from "./theme";
import { shouldStackListActions, shouldUseWideGutter } from "./responsive";
import { useContentWidth, useNavigationSpace } from "./viewport";
import { OperationFlow, type OperationFlowKind } from "./operation-flow";
import { useScreenVisit } from "./motion-primitives";

export {
  Amount,
  Badge,
  Body,
  Button,
  controlStateStyle,
  DisclosureChevron,
  Divider,
  FadeIn,
  Heading,
  IconButton,
  InitialsBadge,
  Label,
  Row,
  SegmentBar,
  Spread,
  STATUS_W,
  Title,
} from "./primitives";

export { Field, MoneyField, MonthStepper, Toggle } from "./fields";
export { ChipPicker, ChoiceTile, Segmented, Select, SelectionGrid } from "./selection-controls";

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
  const { width } = useWindowDimensions();
  const maxWidth = contentWidth[widthName];
  const segments = useSegments();
  const visit = useScreenVisit();
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
  // stops UIKit adding to it. The scroller dismisses the keyboard on a real
  // drag instead of changing its inset; this is how an iOS decimal-pad form
  // exposes a save action below the fold without reviving either failed inset
  // mechanism.
  if (!scroll) {
    return (
      // The rail's space is taken here, by the content, and not by the tab scene:
    // a scene-level inset also shortened the nested stack's header, which is
    // chrome that belongs to the whole window.
    <View style={{ flex: 1, backgroundColor: palette.background, paddingLeft: navLeft }}>
        {/* The owner chose consistent replay across every route. The token
            restarts only this animated wrapper; children keep their state, so
            returning to a partially completed form does not reset its draft. */}
        <FadeIn testID="screen-entrance" replayToken={visit} style={[{ flex: 1 }, inner]}>
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
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        automaticallyAdjustContentInsets={false}
      >
        {/* Carries the container's grow through to the children, so a screen
            with one short block can centre it rather than stack it at the top
            of an empty page. */}
        <FadeIn testID="screen-entrance" replayToken={visit} style={{ flexGrow: 1 }}>
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
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { palette } = useTheme();
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
        <View key={item.label} style={{ flex: 1, flexBasis: 0, minWidth: 0, paddingTop: spacing.sm }}>
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
                style={{ textAlign: "left" }}
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
  const stackRight = Boolean(right) && viewportWidth < 360;
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
      <Text accessibilityRole="header" style={[type.heading, { color: palette.text, textAlign: "center" }]}>{title}</Text>
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
      <View style={{ flex: 1, minWidth: 0 }} onLayout={lede.onBlockLayout}>
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
      {stackRight ? null : <View style={lede.blockStyle}>{right}</View>}
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
