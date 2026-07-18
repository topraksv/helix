import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../i18n/tr";
import { HeaderBackButton } from "../../../ui/header-back";
import { useTheme } from "../../../ui/theme";

export const unstable_settings = { initialRouteName: "index" };

export default function CashflowLayout() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text, fontFamily: "Inter_600SemiBold" },
        headerBackTitle: tr.common.back,
        headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" />,
        headerShadowVisible: false,
        gestureEnabled: true,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[month]" options={{ title: tr.cashflow.monthDetail }} />
      <Stack.Screen name="item" options={{ title: tr.cashflow.monthDetail }} />
      <Stack.Screen name="analytics" options={{ title: tr.analysis.title }} />
      <Stack.Screen name="installments" options={{ title: tr.installments.title }} />
    </Stack>
  );
}
