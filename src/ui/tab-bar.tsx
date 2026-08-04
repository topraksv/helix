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

import React, { useMemo, useRef } from "react";
import { PanResponder, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceTransparency } from "./motion";
import { font, NAV_GLASS, navigationMaterial, radius, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, themeShadow, useTheme } from "./theme";

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceTransparency = useReduceTransparency();
  const isWeb = Platform.OS === "web";
  const glass = !reduceTransparency;
  const webMaterial = isWeb
    ? ({
        backdropFilter: glass ? NAV_GLASS.blur : "none",
        WebkitBackdropFilter: glass ? NAV_GLASS.blur : "none",
      } as unknown as ViewStyle)
    : null;
  const materialFill = navigationMaterial(palette.surface, { glass, isWeb });

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

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only a deliberate drag along the navigation's own axis, so a tap
        // still reaches the Pressable underneath and a scroll still belongs to
        // the page.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
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
        style={({ pressed }) => ({
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
          style={{
            fontFamily: focused ? font.semibold : font.medium,
            fontSize: 11,
            lineHeight: 14,
            textAlign: "center",
            color: focused ? palette.textStrong : palette.textSecondary,
          }}
        >
          {typeof label === "string" ? label : route.name}
        </Text>
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
      onLayout={measureBar}
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
