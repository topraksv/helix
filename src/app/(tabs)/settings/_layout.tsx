import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../i18n/tr";
import { HeaderBackButton } from "../../../ui/header-back";
import { useTheme } from "../../../ui/theme";

export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text, fontFamily: "Inter_600SemiBold" },
        headerBackTitle: tr.common.back,
        headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" />,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="categories" options={{ title: tr.settings.categories }} />
      <Stack.Screen name="persons" options={{ title: tr.settings.persons }} />
      <Stack.Screen name="payment-sources" options={{ title: tr.settings.sources }} />
      <Stack.Screen name="incomes" options={{ title: tr.settings.incomeRules }} />
      <Stack.Screen name="computed-columns" options={{ title: tr.settings.computed }} />
      <Stack.Screen name="opening-balance" options={{ title: tr.settings.opening }} />
      <Stack.Screen name="budgets" options={{ title: tr.budgets.title }} />
    </Stack>
  );
}
