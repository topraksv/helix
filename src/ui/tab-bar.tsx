/**
 * The app's navigation surface: one bounded bar, on the axis the viewport has
 * to spare.
 *
 * Below the desktop breakpoint it is a bottom bar, because that is the edge a
 * held hand reaches. At and above it the same five destinations stand up into a
 * left rail: a pointer is nowhere near the bottom edge, the bar spent vertical
 * space the content wanted, and it floated over the very rows it was meant to
 * sit beside. Both orientations share this component so the material, the
 * selected semantics and the press contract cannot diverge into two navigations.
 *
 * Native platforms use a light translucent material; web adds the browser's
 * backdrop blur when available and falls back to the same tinted surface.
 * Reduce Transparency always selects the opaque fallback.
 *
 * The native material stays dependency-free so it can ship with the current
 * runtime; web's CSS blur is an optional enhancement, never a requirement for
 * contrast or navigation.
 *
 * Metrics live in the shared `TAB_BAR` / `SIDE_NAV` tokens and reach every
 * consumer through `navigationInset`, so `Screen` and the undo snackbar cannot
 * drift from where navigation really is. The press behaviour reproduces the
 * library's own `tabPress` contract — a screen listener may still cancel
 * navigation, which is what keeps `popToTopOnBlur` and the selection haptic
 * working.
 */

import React, { useMemo, useRef } from "react";
import { PanResponder, Platform, Pressable, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandMark } from "./brand";
import { tr } from "../i18n/tr";
import { useReduceTransparency } from "./motion";
import { shouldUseSideNavigation } from "./responsive";
import { font, radius, SIDE_NAV, spacing, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, themeShadow, type as typeScale, useTheme } from "./theme";

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const side = shouldUseSideNavigation(viewportWidth);
  const reduceTransparency = useReduceTransparency();
  const isWeb = Platform.OS === "web";
  const glass = !reduceTransparency;
  const webMaterial = isWeb
    ? ({
        backdropFilter: glass ? "blur(18px) saturate(125%)" : "none",
        WebkitBackdropFilter: glass ? "blur(18px) saturate(125%)" : "none",
      } as unknown as ViewStyle)
    : null;

  // Dragging across the bar scrubs through the tabs. The geometry and the
  // current index are read from refs so the responder can be created once:
  // rebuilding it per render would drop an in-flight gesture.
  const barRef = useRef<View>(null);
  const barBox = useRef({ x: 0, width: 0 });
  const latest = useRef({ routes: state.routes, index: state.index });
  latest.current = { routes: state.routes, index: state.index };

  const goToIndex = (index: number) => {
    const { routes, index: current } = latest.current;
    const route = routes[index];
    if (!route || index === current) return;
    const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only a deliberate horizontal drag, so a tap still reaches the
        // Pressable underneath and a vertical scroll still belongs to the page.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          const { width, x } = barBox.current;
          const count = latest.current.routes.length;
          if (width <= 0 || count === 0) return;
          const slot = Math.floor(((gesture.moveX - x) / width) * count);
          goToIndex(Math.min(Math.max(slot, 0), count - 1));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once on purpose; live values come from refs
    [],
  );

  // The surface both orientations paint: a quiet navigation instrument, not a
  // second card pile. A restrained outline over a translucent fill gives it
  // depth without a full-screen blur or a solid block.
  const material: ViewStyle = {
    backgroundColor: glass ? palette.surfaceTranslucent : palette.surface,
    borderWidth: 1,
    borderColor: palette.border + "70",
    ...webMaterial,
    ...themeShadow.overlay(palette),
  };

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
        style={({ pressed }) => (side
          ? {
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              height: SIDE_NAV.itemHeight,
              paddingLeft: spacing.md,
              paddingRight: spacing.sm,
              borderRadius: radius.sm,
              // The bar marks the selected tab with a bottom rule; upright, the
              // same rule becomes a leading one, so the accent still runs along
              // the edge the row is read from.
              borderLeftWidth: focused ? SIDE_NAV.markerWidth : 0,
              borderLeftColor: focused ? palette.primary : "transparent",
              backgroundColor: focused ? palette.primarySoft : "transparent",
              opacity: pressed ? stateOpacity.pressed : 1,
            }
          : {
              flex: 1,
              alignSelf: "stretch",
              marginVertical: 0,
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              borderRadius: radius.sm,
              borderWidth: focused ? 1 : 0,
              borderColor: focused ? palette.primary : "transparent",
              borderBottomWidth: focused ? 2 : 0,
              borderBottomColor: focused ? palette.primary : "transparent",
              backgroundColor: focused ? palette.primarySoft : "transparent",
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
        <Text
          style={side
            ? { ...typeScale.label, fontFamily: focused ? font.semibold : font.medium, color: focused ? palette.textStrong : palette.textSecondary, flexShrink: 1 }
            : { fontFamily: focused ? font.semibold : font.medium, fontSize: 11, lineHeight: 14, color: focused ? palette.textStrong : palette.textSecondary }}
        >
          {typeof label === "string" ? label : route.name}
        </Text>
      </Pressable>
    );
  });

  if (side) {
    return (
      <View
        accessibilityRole="tablist"
        style={{
          position: "absolute",
          left: SIDE_NAV.inset,
          top: insets.top + SIDE_NAV.inset,
          bottom: SIDE_NAV.inset,
          width: SIDE_NAV.width,
          padding: spacing.sm,
          gap: SIDE_NAV.itemGap,
          borderRadius: radius.lg,
          ...material,
        }}
      >
        {/* Desktop has room for the product to say its own name; the phone bar
            spends every pixel on the five targets instead. */}
        <View
          accessible={false}
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.sm, paddingBottom: spacing.md, paddingTop: spacing.xs }}
        >
          <BrandMark size={24} />
          <Text style={[typeScale.heading, { color: palette.textStrong, fontSize: 17 }]}>{tr.app.name}</Text>
        </View>
        {destinations}
      </View>
    );
  }

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
      onLayout={() => barRef.current?.measureInWindow((x, _y, width) => { barBox.current = { x, width }; })}
      {...pan.panHandlers}
      style={{
        width: "100%",
        maxWidth: TAB_BAR.maxWidth,
        height: tabBarHeight(isWeb),
        padding: 2,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.md,
        ...material,
      }}
    >
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
