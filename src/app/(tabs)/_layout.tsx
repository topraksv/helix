import React from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Calculator, ChartPie, RefreshCw, Settings, WalletCards } from "lucide-react-native";
import { tr } from "../../i18n/tr";
import { useTheme } from "../../ui/theme";

export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        // Screens draw their own large titles; a native header would repeat them.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          ...(Platform.OS === "web" ? { height: 60, paddingBottom: 8, paddingTop: 6 } : {}),
        },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
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
