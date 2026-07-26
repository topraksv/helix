/**
 * The app's tab bar: a bounded, centred surface floating over the scene.
 *
 * The **shape** is the same everywhere; the **material** is not. Only iOS gets
 * the translucent one, because only there does it read as the system's own
 * glass — Android and web get the identical bar in solid `surface` rather than
 * an imitation of a look neither platform has. Reduce Transparency turns it
 * solid on iOS too.
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

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceTransparency } from "./motion";
import { font, overlayShadow, radius, spacing, stateOpacity, TAB_BAR, tabBarBottomOffset, tabBarHeight, useTheme } from "./theme";

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceTransparency = useReduceTransparency();
  const isWeb = Platform.OS === "web";
  // Owner's decision: the glass material is iOS only. Android and web get the
  // same shape in a solid `surface` rather than an imitation of a system look
  // neither platform has.
  const glass = Platform.OS === "ios" && !reduceTransparency;

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
      accessibilityRole="tablist"
      style={{
        width: "100%",
        maxWidth: TAB_BAR.maxWidth,
        height: tabBarHeight(isWeb),
        paddingHorizontal: spacing.xs,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.controlBorder,
        backgroundColor: glass ? palette.surfaceTranslucent : palette.surface,
        ...overlayShadow,
      }}
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        const focused = state.index === index;
        // On the soft pill the accent role measures 4.12 against it — below AA
        // for an 11px label. `primaryText` is the ink that role exists for and
        // is already proved against `primarySoft` for every palette, so the
        // selected tab reads by weight and fill rather than by hue alone.
        const color = focused ? palette.primaryText : palette.textSecondary;
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
              marginVertical: spacing.xs,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              borderRadius: radius.lg,
              backgroundColor: focused ? palette.primarySoft : "transparent",
              opacity: pressed ? stateOpacity.pressed : 1,
            })}
          >
            {options.tabBarIcon?.({ focused, color, size: 24 })}
            <Text style={{ fontFamily: font.medium, fontSize: 11, lineHeight: 15, color }}>
              {typeof label === "string" ? label : route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}
