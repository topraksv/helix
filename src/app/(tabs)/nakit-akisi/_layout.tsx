import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../i18n/tr";
import { useTheme } from "../../../ui/theme";

export default function CashflowLayout() {
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
      <Stack.Screen name="[month]" options={{ title: tr.cashflow.monthDetail }} />
      <Stack.Screen name="analiz" options={{ title: tr.analysis.title }} />
      <Stack.Screen name="taksitler" options={{ title: tr.installments.title }} />
    </Stack>
  );
}
