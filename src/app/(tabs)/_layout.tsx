import React from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs } from "expo-router";
import { ChartPie, Landmark, RefreshCw, Settings, WalletCards } from "lucide-react-native";
import { tr } from "../../i18n/tr";
import { selectionTapIfChanged } from "../../ui/haptics";
import { shouldUseSideNavigation } from "../../ui/responsive";
import { TabBar } from "../../ui/tab-bar";
import { navigationInset, useTheme } from "../../ui/theme";

export default function TabsLayout() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // The rail stands beside the scene rather than over it, so the SCENE gives up
  // the space — not each screen. A nested stack draws its own header inside
  // this container and outside `Screen`, and insetting only `Screen` left the
  // rail covering that header's back control.
  const nav = navigationInset({
    bottomInset: insets.bottom,
    isWeb: Platform.OS === "web",
    side: shouldUseSideNavigation(width),
  });
  return (
    <Tabs
      // The bar floats over the scene, so it draws itself rather than being
      // laid out by the navigator. Metrics stay in the shared TAB_BAR tokens
      // (theme.ts); `Screen` and the undo snackbar read the same source.
      tabBar={(props) => <TabBar {...props} />}
      screenListeners={({ navigation, route }) => ({
        tabPress: () => {
          const state = navigation.getState();
          selectionTapIfChanged(state.routes[state.index]?.key, route.key);
        },
      })}
      screenOptions={{
        // Screens draw their own large titles; a native header would repeat them.
        headerShown: false,
        sceneStyle: { backgroundColor: palette.background, paddingLeft: nav.left },
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
        name="investments"
        options={{
          title: tr.tabs.investments,
          tabBarLabel: tr.tabBar.investments,
          tabBarAccessibilityLabel: tr.tabs.investments,
          tabBarIcon: ({ color, size }) => <Landmark color={color} size={size - 2} strokeWidth={2} />,
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
