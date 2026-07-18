import { font, type Palette } from "./theme";

export function navigateBack<T>(
  router: { canGoBack: () => boolean; back: () => void; replace: (href: T) => void },
  fallback: T,
): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export function stackScreenOptions(palette: Palette) {
  return {
    headerStyle: { backgroundColor: palette.surface },
    headerTintColor: palette.accentText,
    headerTitleStyle: { color: palette.textStrong, fontFamily: font.semibold },
    headerBackButtonDisplayMode: "minimal" as const,
    headerShadowVisible: false,
    gestureEnabled: true,
    contentStyle: { backgroundColor: palette.background },
  };
}
