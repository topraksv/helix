import React from "react";
import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { tr } from "../../i18n/tr";
import { useTheme } from "../../ui/theme";

function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: tr.tabs.dashboard, tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} /> }}
      />
      <Tabs.Screen
        name="cash-flow"
        options={{ title: tr.tabs.cashflow, tabBarIcon: ({ color }) => <TabIcon glyph="₺" color={color} /> }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{ title: tr.tabs.subscriptions, tabBarIcon: ({ color }) => <TabIcon glyph="↻" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: tr.tabs.settings, tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} /> }}
      />
    </Tabs>
  );
}
