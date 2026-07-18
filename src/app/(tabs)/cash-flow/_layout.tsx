import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../i18n/tr";
import { HeaderBackButton } from "../../../ui/header-back";
import { stackScreenOptions } from "../../../ui/navigation";
import { useTheme } from "../../../ui/theme";

export const unstable_settings = { initialRouteName: "index" };

export default function CashflowLayout() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        ...stackScreenOptions(palette),
        headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" />,
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
