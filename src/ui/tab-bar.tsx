/**
 * The app's navigation surface: one bounded bottom bar on every viewport.
 *
 * Only iOS gets the translucent material, because only there does it read as
 * the system's own glass. Android and web use the solid `surface`; Reduce
 * Transparency turns iOS solid too.
 *
 * It is translucency, not blur: `expo-blur` and the glass-tab packages built on
 * it are native modules that cannot ship over OTA, so the background layer here
 * is deliberately the only thing that would change if real blur is adopted
 * after a device build exists.
 *
 * Metrics live in the shared `TAB_BAR` tokens so `Screen` and the undo snackbar
 * cannot drift from the real height, and the press behaviour reproduces the
 * library's own `tabPress` contract — a screen listener may still cancel
 * navigation, which is what keeps `popToTopOnBlur` and the selection haptic
 * working.
 */

import React, { useMemo, useRef } from "react";
import { PanResponder, Platform, Pressable, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceTransparency } from "./motion";
import { font, radius, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, themeShadow, useTheme } from "./theme";

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceTransparency = useReduceTransparency();
  const isWeb = Platform.OS === "web";
  // Owner's decision: the glass material is iOS only. Android and web get the
  // same shape in a solid `surface` rather than an imitation of a system look
  // neither platform has.
  const glass = Platform.OS === "ios" && !reduceTransparency;

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
        borderRadius: radius.lg,
        // No outline. The bar reads as a floating object from its own fill and
        // shadow, and the surface ramp now steps far enough from the page that
        // a hairline only added a hard edge across the bottom of every screen.
        backgroundColor: glass ? palette.surfaceTranslucent : palette.surface,
        borderWidth: 1,
        borderColor: palette.border + "70",
        ...themeShadow.overlay(palette),
      }}
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        const focused = state.index === index;
        // On the soft pill the accent role measures 4.12 against it — below AA
        // for an 11px label. `primaryText` is the ink that role exists for and
        // is already proved against `primarySoft` for every palette, so the
        // selected tab reads by weight and fill rather than by hue alone.
        const color = focused ? palette.onPrimary : palette.textSecondary;
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
              borderColor: focused ? palette.primary + "70" : "transparent",
              backgroundColor: focused ? palette.surfaceAlt : "transparent",
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
                backgroundColor: focused ? palette.primary : "transparent",
              }}
            >
              {options.tabBarIcon?.({ focused, color, size: 22 })}
            </View>
            <Text style={{ fontFamily: focused ? font.semibold : font.medium, fontSize: 11, lineHeight: 14, color: focused ? palette.textStrong : palette.textSecondary }}>
              {typeof label === "string" ? label : route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}
