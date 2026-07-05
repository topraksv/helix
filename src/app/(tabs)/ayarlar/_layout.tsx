import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../i18n/tr";
import { useTheme } from "../../../ui/theme";

export default function SettingsLayout() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="kategoriler" options={{ title: tr.settings.categories }} />
      <Stack.Screen name="kisiler" options={{ title: tr.settings.persons }} />
      <Stack.Screen name="kaynaklar" options={{ title: tr.settings.sources }} />
      <Stack.Screen name="gelirler" options={{ title: tr.settings.incomeRules }} />
      <Stack.Screen name="hesaplamalar" options={{ title: tr.settings.computed }} />
    </Stack>
  );
}
