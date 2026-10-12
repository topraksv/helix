/** One bounded bar along the bottom at every width; translucent unless Reduce Transparency. Press and scrub go through the navigator's `tabPress`, so listeners can cancel. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Keyboard, PanResponder, Platform, Pressable, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion, useReduceTransparency } from "./motion";
import { shouldUseCompactNavigationMaterial, tabLabelsFit, tooWide } from "./responsive";
import { font, maxFontScale, motion, NAV_GLASS, navigationMaterial, radius, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, themeShadow, type, useTheme } from "./theme";

/** The bar's own inset. The selection slides inside it, not over its edge. */
const BAR_PADDING = 2;
/** The bar's outline; the columns share what lies inside it and the padding. */
const BAR_BORDER = 1;
const EDGE = BAR_BORDER + BAR_PADDING;

/** How far a finger travels before the bar treats it as a scrub and not a tap. */
const DRAG_CLAIM_DISTANCE = 24;
/** How much more horizontal than vertical that travel has to be. */
const DRAG_HORIZONTAL_BIAS = 1.5;
/**
 * The width a label's glyphs really need, and whether they had to wrap.
 *
 * Measured over the text content rather than the element, because the element
 * is a block box the column has already sized: every box-level answer
 * (`scrollWidth`, `getClientRects`) is the column's width, not the label's.
 */
function measureLabelText(node: HTMLElement | null): { width: number; wrapped: boolean } {
  if (!node || typeof document === "undefined" || typeof document.createRange !== "function") {
    return { width: 0, wrapped: false };
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    let width = 0;
    for (let i = 0; i < rects.length; i += 1) width = Math.max(width, rects[i]?.width ?? 0);
    return { width: Math.ceil(width), wrapped: rects.length > 1 };
  } catch {
    // A detached or unmeasurable node reads as "not measured yet", which the
    // fit rule already treats as fitting.
    return { width: 0, wrapped: false };
  }
}

/**
 * Android only: there the floating bar rides up over the keyboard, since
 * `tabBarHideOnKeyboard` is read by the navigator's own bar alone. iOS draws
 * the keyboard over it, and the web has no keyboard event.
 */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  const { width } = useWindowDimensions();
  const reduceTransparency = useReduceTransparency();
  const reducedMotion = useReducedMotion();
  const isWeb = Platform.OS === "web";
  const glass = !reduceTransparency;
  const webMaterial = isWeb
    ? ({
        backdropFilter: glass ? NAV_GLASS.blur : "none",
        WebkitBackdropFilter: glass ? NAV_GLASS.blur : "none",
      } as unknown as ViewStyle)
    : null;
  const materialFill = navigationMaterial(palette.surface, { glass, isWeb, compact: shouldUseCompactNavigationMaterial(width) });

  // Dragging across the bar scrubs through the tabs. The geometry and the
  // current index are read from refs so the responder can be created once:
  // rebuilding it per render would drop an in-flight gesture.
  const barRef = useRef<View>(null);
  const barBox = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const latest = useRef({ routes: state.routes, index: state.index });
  latest.current = { routes: state.routes, index: state.index };

  const goToIndex = (index: number) => {
    const { routes, index: current } = latest.current;
    const route = routes[index];
    if (!route || index === current) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  // Dragging across the bar scrubs through the tabs, so the box is measured in
  // window coordinates.
  const measureBar = () => {
    barRef.current?.measureInWindow((x, y, width, height) => {
      barBox.current = { x, y, width, height };
    });
  };

  const [barWidth, setBarWidth] = useState(0);
  /** Labels drop once the measured label no longer fits; iOS fontScale follows Display Zoom, not Dynamic Type, so it cannot be the trigger. */
  // Each label's latest width, remembered with the bar width it was measured at,
  // so a new bar width reads as "not measured yet". A report replaces, never
  // raises, and a dropped label stays mounted unseen: shrinking the text lowers
  // the widest and the labels come back.
  const [measured, setMeasured] = useState<{ barWidth: number; widths: Record<string, number> }>({ barWidth: 0, widths: {} });
  const slotWidth = state.routes.length > 0 && barWidth > 0
    ? (barWidth - EDGE * 2) / state.routes.length
    : 0;
  const selection = useRef(new Animated.Value(state.index)).current;
  useEffect(() => {
    if (reducedMotion) {
      selection.setValue(state.index);
      return;
    }
    const animation = Animated.spring(selection, {
      toValue: state.index,
      useNativeDriver: Platform.OS !== "web",
      ...motion.spring.entrance,
    });
    animation.start();
    return () => animation.stop();
  }, [state.index, selection, reducedMotion]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // A deliberate horizontal drag only, so a tap reaches the Pressable and a scroll stays the page's.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > DRAG_CLAIM_DISTANCE
          && Math.abs(gesture.dx) > Math.abs(gesture.dy) * DRAG_HORIZONTAL_BIAS,
        onPanResponderMove: (_event, gesture) => {
          const { x, width } = barBox.current;
          const count = latest.current.routes.length;
          if (width <= 0 || count === 0) return;
          const slot = Math.floor((gesture.moveX - x - EDGE) / ((width - EDGE * 2) / count));
          goToIndex(Math.min(Math.max(slot, 0), count - 1));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once on purpose; live values come from refs
    [],
  );

  // An outline over a translucent fill: it is what gives the bar an edge on a near-black page.
  const material: ViewStyle = {
    backgroundColor: materialFill,
    borderWidth: BAR_BORDER,
    borderColor: palette.border + (scheme === "dark" ? "" : "70"),
    ...webMaterial,
    ...themeShadow.overlay(palette),
  };

  // Derived, not stored: the label lays itself out before the bar has reported
  // its width, so the decision is taken in render against whatever is known.
  const labelWidth = measured.barWidth === barWidth ? Math.max(0, ...Object.values(measured.widths)) : 0;
  const labelsFit = tabLabelsFit(labelWidth, slotWidth);
  // One stable callback per label: a new identity re-runs the synchronous layout read on every render.
  const reportLabel = useCallback((key: string, width: number) =>
    setMeasured((seen) => {
      const known = seen.barWidth === barWidth ? seen.widths : {};
      return known[key] === width ? seen : { barWidth, widths: { ...known, [key]: width } };
    }), [barWidth]);

  const destinations = state.routes.map((route, index) => {
    const options = descriptors[route.key]?.options ?? {};
    const focused = state.index === index;
    // accentText: the ink proved against primarySoft, so the selected tab reads by weight and fill.
    const color = focused ? palette.accentText : palette.textSecondary;
    const label = options.tabBarLabel ?? options.title ?? route.name;

    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        // `aria-selected`, not `accessibilityState`: react-native-web does not translate the latter for this role.
        aria-selected={focused}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        onPress={() => {
          // Navigate only if no listener cancelled tabPress, or popToTopOnBlur and the haptic are lost.
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        }}
        // Fill and outline belong to the travelling selection below; a tab owns
        // only its own ink, its weight and its answer to a press.
        style={({ pressed }) => ({
          flex: 1,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          borderRadius: radius.sm,
          opacity: pressed ? stateOpacity.pressed : 1,
        })}
      >
        <View
          accessible={false}
          style={{
            width: 30,
            height: 28,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.sm,
          }}
        >
          {options.tabBarIcon?.({ focused, color, size: 22 })}
        </View>
        <TabLabel
          // Keyed on the bar width: a mounted native label does not re-layout
          // when only its column changed, so it would never report again.
          key={`${route.key}:${barWidth}`}
          id={route.key}
          label={typeof label === "string" ? label : route.name}
          focused={focused}
          hidden={!labelsFit}
          slotWidth={slotWidth}
          onMeasure={reportLabel}
        />
      </Pressable>
    );
  });

  if (keyboardShown) return null;
  return (
    // Two views: an absolute element with left and right ignores maxWidth.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: TAB_BAR.sideInset,
        right: TAB_BAR.sideInset,
        // Above the home indicator rather than around it, which is what keeps
        // the bar's own padding symmetrical.
        bottom: tabBarBottomOffset(insets.bottom),
        alignItems: "center",
      }}
    >
    <View
      ref={barRef}
      accessibilityRole="tablist"
      onLayout={(event) => {
        setBarWidth(event.nativeEvent.layout.width);
        measureBar();
      }}
      {...pan.panHandlers}
      style={{
        width: "100%",
        maxWidth: TAB_BAR.maxWidth,
        height: tabBarHeight(isWeb),
        padding: BAR_PADDING,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.xl,
        borderCurve: "continuous",
        ...material,
      }}
    >
      {slotWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          style={{
            position: "absolute",
            top: BAR_PADDING,
            bottom: BAR_PADDING,
            left: BAR_PADDING,
            width: slotWidth,
            borderRadius: radius.lg,
            backgroundColor: palette.primarySoft,
            borderWidth: 1,
            borderColor: palette.primary,
            borderBottomWidth: 2,
            transform: [{ translateX: Animated.multiply(selection, slotWidth) }],
          }}
        />
      ) : null}
      <View
        pointerEvents="none"
        accessible={false}
        style={{
          position: "absolute",
          top: 1,
          left: 18,
          right: 18,
          height: 1,
          backgroundColor: palette.textStrong + (glass ? "18" : "0D"),
        }}
      />
      {destinations}
    </View>
    </View>
  );
}

/** One label, measured after layout; web reads the DOM in a layout effect because react-native-web dispatches no onTextLayout. */
function TabLabel({ id, label, focused, hidden, slotWidth, onMeasure }: {
  id: string;
  label: string;
  focused: boolean;
  /** Out of the layout and unseen, still measuring, so it can come back. */
  hidden: boolean;
  slotWidth: number;
  onMeasure: (id: string, width: number) => void;
}) {
  const { palette } = useTheme();
  const ref = useRef<Text>(null);
  useLayoutEffect(() => {
    const measured = measureLabelText(ref.current as unknown as HTMLElement | null);
    if (measured.width > 0) onMeasure(id, measured.wrapped ? tooWide(slotWidth) : measured.width);
  }, [id, label, slotWidth, onMeasure]);
  return (
    <Text
      ref={ref}
      aria-hidden={hidden}
      maxFontSizeMultiplier={maxFontScale.measuredBox}
      // A label that wrapped is the clearest evidence it does not fit.
      onTextLayout={(event) => {
        const lines = event.nativeEvent.lines;
        const widest = Math.max(...lines.map((line) => line.width), 0);
        onMeasure(id, lines.length > 1 ? tooWide(slotWidth) : Math.ceil(widest));
      }}
      style={{
        fontFamily: focused ? font.semibold : font.medium,
        fontSize: type.caption.fontSize,
        // No `lineHeight`: a fixed line box clips scaled Turkish descenders.
        textAlign: "center",
        color: focused ? palette.textStrong : palette.textSecondary,
        ...(hidden ? { position: "absolute" as const, opacity: 0 } : null),
      }}
    >
      {label}
    </Text>
  );
}
