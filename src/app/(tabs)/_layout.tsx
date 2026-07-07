import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calculator, ChartPie, RefreshCw, Settings, WalletCards } from "lucide-react-native";
import { tr } from "../../i18n/tr";
import { useTheme } from "../../ui/theme";

export default function TabsLayout() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  // Mobile web reports no safe-area inset yet the label baseline still needs
  // room, so reserve a floor on web; on native the device inset is enough.
  const isWeb = Platform.OS === "web";
  const bottomPad = Math.max(insets.bottom, isWeb ? 14 : 8);
  // Web clips descenders (ç/ğ) when the label line box hugs the item edge:
  // give the bar extra height + an explicit line height so nothing is cut.
  const barHeight = (isWeb ? 64 : 56) + bottomPad;
  return (
    <Tabs
      screenOptions={{
        // Screens draw their own large titles; a native header would repeat them.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: barHeight,
          paddingBottom: bottomPad,
          paddingTop: 8,
        },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15, paddingTop: 1 },
        tabBarIconStyle: { marginBottom: 0 },
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: tr.tabs.dashboard,
          tabBarIcon: ({ color, size }) => <ChartPie color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="cash-flow"
        options={{
          title: tr.tabs.cashflow,
          tabBarIcon: ({ color, size }) => <WalletCards color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          title: tr.tabs.subscriptions,
          tabBarIcon: ({ color, size }) => <RefreshCw color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="calculator"
        options={{
          title: tr.tabs.calculator,
          tabBarIcon: ({ color, size }) => <Calculator color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: tr.tabs.settings,
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size - 2} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
