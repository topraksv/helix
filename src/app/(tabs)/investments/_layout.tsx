import { Stack } from "expo-router";
import { HeaderBackButton } from "../../../ui/header-back";
import { pageScreenOptions } from "../../../ui/header-bar";
import { useTheme } from "../../../ui/theme";
import { tr } from "../../../i18n/tr";

export const unstable_settings = { initialRouteName: "index" };

export default function InvestmentsLayout() {
  const { palette } = useTheme();
  return (
    <Stack
      screenOptions={{
        ...pageScreenOptions(palette),
        headerLeft: () => <HeaderBackButton fallback="/(tabs)/investments" />,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="setup" options={{ title: tr.investments.setupTitle }} />
      <Stack.Screen name="product" options={{ title: tr.investments.addProduct }} />
      <Stack.Screen name="operation" options={{ title: tr.investments.title }} />
      <Stack.Screen name="correction" options={{ title: tr.investments.removeProductHistoryTitle }} />
    </Stack>
  );
}
