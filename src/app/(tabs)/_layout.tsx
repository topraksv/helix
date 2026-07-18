import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calculator, ChartPie, RefreshCw, Settings, WalletCards } from "lucide-react-native";
import { tr } from "../../i18n/tr";
import { selectionTapIfChanged } from "../../ui/haptics";
import { TAB_BAR, tabBarHeight, useTheme } from "../../ui/theme";

export default function TabsLayout() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  // Metrics come from the shared TAB_BAR tokens (theme.ts) so overlays that
  // must clear the bar (undo snackbar) can never drift from the real height.
  const isWeb = Platform.OS === "web";
  const bottomPad = Math.max(insets.bottom, isWeb ? TAB_BAR.webMinBottomInset : TAB_BAR.minBottomInset);
  const barHeight = tabBarHeight(insets.bottom, isWeb);
  return (
    <Tabs
      screenListeners={({ navigation, route }) => ({
        tabPress: () => {
          const state = navigation.getState();
          selectionTapIfChanged(state.routes[state.index]?.key, route.key);
        },
      })}
      screenOptions={{
        // Screens draw their own large titles; a native header would repeat them.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.surfaceHover,
          height: barHeight,
          paddingBottom: bottomPad,
          paddingTop: 8,
        },
        tabBarActiveTintColor: palette.accentText,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15, paddingTop: 1 },
        tabBarIconStyle: { marginBottom: 0 },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tr.tabs.dashboard,
          tabBarLabel: tr.tabBar.dashboard,
          tabBarAccessibilityLabel: tr.tabs.dashboard,
          tabBarIcon: ({ color, size }) => <ChartPie color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="cash-flow"
        options={{
          title: tr.tabs.cashflow,
          tabBarLabel: tr.tabBar.cashflow,
          tabBarAccessibilityLabel: tr.tabs.cashflow,
          popToTopOnBlur: true,
          tabBarIcon: ({ color, size }) => <WalletCards color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: tr.tabs.subscriptions,
          tabBarLabel: tr.tabBar.subscriptions,
          tabBarAccessibilityLabel: tr.tabs.subscriptions,
          tabBarIcon: ({ color, size }) => <RefreshCw color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="calculator"
        options={{
          title: tr.tabs.calculator,
          tabBarLabel: tr.tabBar.calculator,
          tabBarAccessibilityLabel: tr.tabs.calculator,
          tabBarIcon: ({ color, size }) => <Calculator color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tr.tabs.settings,
          tabBarLabel: tr.tabBar.settings,
          tabBarAccessibilityLabel: tr.tabs.settings,
          popToTopOnBlur: true,
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
