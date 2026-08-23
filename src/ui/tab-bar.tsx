/**
 * The app's navigation surface: one bounded bar along the bottom, at every
 * width.
 *
 * A left rail was tried at desktop widths and removed by the owner: taking a
 * column out of the window pushed every page's content off centre, and the same
 * app then had two navigations to learn. One bar, one position, one habit — the
 * bottom edge a held hand reaches, and a bounded width so five destinations do
 * not spread across a monitor.
 *
 * Native platforms use a light translucent material; web adds the browser's
 * backdrop blur when available and falls back to the same tinted surface.
 * Reduce Transparency always selects the opaque fallback.
 *
 * The native material stays dependency-free so it can ship with the current
 * runtime; web's CSS blur is an optional enhancement, never a requirement for
 * contrast or navigation.
 *
 * Metrics live in the shared `TAB_BAR` tokens and reach every
 * consumer through `navigationInset`, so `Screen` and the undo snackbar cannot
 * drift from where navigation really is. The press behaviour reproduces the
 * library's own `tabPress` contract — a screen listener may still cancel
 * navigation, which is what keeps `popToTopOnBlur` and the selection haptic
 * working.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { selectionTap } from "./haptics";
import { useReducedMotion, useReduceTransparency } from "./motion";
import { shouldUseCompactNavigationMaterial, tabLabelsFit, tooWide } from "./responsive";
import { font, maxFontScale, motion, NAV_GLASS, navigationMaterial, radius, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, themeShadow, type, useTheme } from "./theme";

/** The bar's own inset. The selection slides inside it, not over its edge. */
const BAR_PADDING = 2;

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

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette, scheme } = useTheme();
  const insets = useSafeAreaInsets();
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
    if (!event.defaultPrevented) {
      // Crossing into a tab is a selection changing, and the scrub was the one
      // way of changing it that said nothing: the destination slid past under
      // a thumb that is covering the bar it is sliding along. Same feedback a
      // press already gives, once per crossing rather than once per frame —
      // `goToIndex` returns early when the index has not actually moved.
      selectionTap();
      navigation.navigate(route.name, route.params);
    }
  };

  // Dragging across the bar scrubs through the tabs, so the box is measured in
  // window coordinates.
  const measureBar = () => {
    barRef.current?.measureInWindow((x, y, width, height) => {
      barBox.current = { x, y, width, height };
    });
  };

  // The selection is one shape that travels, not five that light up in turn.
  // Choosing a tab was a hard swap of fill and outline, which said which tab is
  // current but never that you had moved between them — and this bar is also
  // draggable, where a jumping highlight reads as five separate flickers rather
  // than one thing being scrubbed.
  const [barWidth, setBarWidth] = useState(0);
  /**
   * The bar drops its labels once the user's text no longer fits them.
   *
   * Five equal columns in a bounded bar give each label roughly 60pt. Capping
   * the multiplier at 200% stops the glyphs clipping and does nothing about the
   * words: measured on a simulator at the largest accessibility size, the bar
   * rendered "Duru | Mali | Abo | Yatı | Aya" with the five labels overlapping
   * each other — worse than no labels at all.
   *
   * The trigger is the MEASURED label, not a font scale. `fontScale` from
   * `useWindowDimensions` is 1 on iOS whatever the text-size setting says — it
   * follows Display Zoom, not Dynamic Type — so a threshold on it is dead code
   * on the one platform that has the problem. This is the same intrinsic-width
   * probe `Figure` uses for the amount ladder.
   *
   * Above the threshold the bar becomes icon-only, which is what iOS does when
   * its own tab bar runs out of room. Nothing is lost to a screen reader:
   * `tabBarAccessibilityLabel` sits on the Pressable and is announced either
   * way.
   */
  const [labelWidth, setLabelWidth] = useState(0);
  const slotWidth = state.routes.length > 0 && barWidth > 0
    ? (barWidth - BAR_PADDING * 2) / state.routes.length
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
        /**
         * Claim only a deliberate drag along the navigation's own axis, so a
         * tap still reaches the Pressable underneath and a scroll still
         * belongs to the page.
         *
         * The threshold used to be 8pt, which is inside the slop of an
         * ordinary tap: the bar sits where a held thumb rests, so a press that
         * slid a little navigated somewhere the user had not chosen. It is now
         * a distance nobody crosses by accident, and the gesture also has to
         * be clearly horizontal rather than merely more horizontal than
         * vertical — a diagonal flick towards the bar no longer counts.
         */
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > DRAG_CLAIM_DISTANCE
          && Math.abs(gesture.dx) > Math.abs(gesture.dy) * DRAG_HORIZONTAL_BIAS,
        onPanResponderMove: (_event, gesture) => {
          const { x, width } = barBox.current;
          const count = latest.current.routes.length;
          if (width <= 0 || count === 0) return;
          const slot = Math.floor(((gesture.moveX - x) / width) * count);
          goToIndex(Math.min(Math.max(slot, 0), count - 1));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once on purpose; live values come from refs
    [],
  );

  // A quiet navigation instrument, not a second card pile: a restrained
  // outline over a translucent fill. The outline is what gives it an edge on a
  // near-black page, where the shadow has nothing to fall onto.
  const material: ViewStyle = {
    backgroundColor: materialFill,
    borderWidth: 1,
    borderColor: palette.border + (scheme === "dark" ? "" : "70"),
    ...webMaterial,
    ...themeShadow.overlay(palette),
  };

  // Derived, not stored. The label lays itself out before the bar has reported
  // its own width, so a decision taken inside the measurement callback is taken
  // against `slotWidth === 0` and never revisited. Remembering the widest label
  // and comparing it in render means the answer follows the geometry whenever
  // the geometry changes.
  const labelsFit = tabLabelsFit(labelWidth, slotWidth);
  // A new bar width deserves a fresh measurement, so shrinking the text can
  // bring the labels back.
  useEffect(() => setLabelWidth(0), [barWidth]);

  const destinations = state.routes.map((route, index) => {
    const options = descriptors[route.key]?.options ?? {};
    const focused = state.index === index;
    // On the soft pill the accent role measures 4.12 against it — below AA
    // for an 11px label. `primaryText` is the ink that role exists for and
    // is already proved against `primarySoft` for every palette, so the
    // selected tab reads by weight and fill rather than by hue alone.
    const color = focused ? palette.accentText : palette.textSecondary;
    const label = options.tabBarLabel ?? options.title ?? route.name;

    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        // `aria-selected`, not `accessibilityState`: react-native-web does
        // not translate the latter for this role, so the bar rendered five
        // tabs with no selected state at all. React Native maps the aria-*
        // props back to accessibility state on native, so this is one
        // mechanism rather than a web special case.
        aria-selected={focused}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        onPress={() => {
          // The library's contract: navigate only if no listener cancelled
          // it. Bypassing the event would silently drop `popToTopOnBlur`
          // and the selection haptic, both of which listen for it.
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
          marginVertical: 0,
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
            backgroundColor: "transparent",
          }}
        >
          {options.tabBarIcon?.({ focused, color, size: 22 })}
        </View>
        {labelsFit ? (
          <Text
            maxFontSizeMultiplier={maxFontScale.measuredBox}
            // A label that WRAPPED is the clearest evidence it does not fit,
            // and it is the only evidence available without clamping the label
            // to one line — which this app does not do to its own copy.
            // Wrapping reports a width the column cannot hold; a single line
            // reports its real one.
            onTextLayout={(event) => {
              const lines = event.nativeEvent.lines;
              const widest = Math.max(...lines.map((line) => line.width), 0);
              setLabelWidth((known) => Math.max(known, lines.length > 1 ? tooWide(slotWidth) : Math.ceil(widest)));
            }}
            onLayout={(event) => {
              // react-native-web does not dispatch `onTextLayout`, so the web
              // half measures the DOM itself. It used to read `scrollWidth` and
              // `getClientRects()` off the element, and both answers were the
              // CONTAINER's: a react-native-web Text is a block box with
              // `overflow: visible`, so `scrollWidth` never exceeds the column
              // it is in and a block always reports exactly one rect. The bar
              // therefore measured every label as "exactly fits" no matter how
              // wide it really was — at 320px "Mali Tablo" and "Abonelikler"
              // ended up 1px apart and read as one word, and the rule that
              // exists to prevent that never fired once.
              //
              // A Range over the text CONTENT is not clipped by the box, so it
              // reports the width the glyphs actually need and one rect per
              // line box.
              const node = event.target as unknown as HTMLElement | null;
              const measured = measureLabelText(node);
              setLabelWidth((known) => Math.max(known, measured.wrapped ? tooWide(slotWidth) : measured.width));
            }}
            style={{
              fontFamily: focused ? font.semibold : font.medium,
              fontSize: type.caption.fontSize,
              // No `lineHeight`. A constant line box beside a scaling font size
              // is the Dynamic Type clipping bug the shared type scale already
              // refuses to write: at 14pt the glyphs grew with the OS setting
              // and the box did not, so Turkish descenders (ç, ğ) were cut off
              // the moment the user asked for larger text.
              textAlign: "center",
              color: focused ? palette.textStrong : palette.textSecondary,
            }}
          >
            {typeof label === "string" ? label : route.name}
          </Text>
        ) : null}
      </Pressable>
    );
  });

  return (
    // Two views on purpose: an absolutely positioned element with both `left`
    // and `right` set ignores `maxWidth` and an auto margin, so the bar spanned
    // a 1440 px viewport and each of its five targets came out ~288 px wide.
    // The wrapper owns the position, the bar owns its own bounded width.
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
        // The bar floats over the page, and at `radius.md` it was more square
        // than the RESTING cards underneath it — which reads as a panel that
        // failed to detach rather than as a layer above. `xl` is the widest
        // corner in the scale and the only one that suits a 56pt pill.
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
