import { font, type Palette } from "./theme";

export function navigateBack<T>(
  router: { canGoBack: () => boolean; back: () => void; replace: (href: T) => void },
  fallback: T,
  /** Skip history and go straight to `fallback` (see `resolveBackTarget`). */
  exact = false,
): void {
  if (!exact && router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * The back target for a screen that more than one place can push.
 *
 * History alone cannot answer this inside a nested tab stack. Pushing Analysis
 * from Summary must use `withAnchor`, which mounts the Cash Flow stack at its
 * own index first — so `router.back()` pops to the Financial Table, a screen
 * the user never visited. The pushing screen therefore records where it came
 * from: a recorded source is navigated to exactly, and anything unrecorded (a
 * deep link, a hand-typed URL, a stale bookmark) keeps the normal behaviour of
 * popping history and only then falling back to the stack's own parent.
 */
export function resolveBackTarget<T>(
  from: unknown,
  sources: Readonly<Record<string, T>>,
  fallback: T,
): { href: T; exact: boolean } {
  if (typeof from === "string" && Object.hasOwn(sources, from)) {
    return { href: sources[from]!, exact: true };
  }
  return { href: fallback, exact: false };
}

/**
 * The recorded source itself, when it is one this app defined.
 *
 * An exact back navigation is a `router.replace` to a freshly built href, so
 * whatever the returned-to screen was originally opened with is gone unless it
 * is put back. A screen that both HAS an origin and pushes another screen must
 * therefore hand its own origin over and get it returned — otherwise Summary →
 * Analysis → Budgets → back → Analysis leaves Analysis looking like a deep
 * link, and its next back goes to the Financial Table.
 *
 * Everything passed through here is validated against the same allowlist the
 * receiving screen resolves with (`Object.hasOwn`, so `__proto__` and friends
 * never match), so a hand-typed or hostile parameter can only ever degrade to
 * "no recorded origin" — never widen into a route the app does not own.
 */
export function knownSource(value: unknown, sources: Readonly<Record<string, unknown>>): string | undefined {
  return typeof value === "string" && Object.hasOwn(sources, value) ? value : undefined;
}

/** Where Analysis returns to, per screen that is allowed to push it. */
export const ANALYSIS_SOURCES = { summary: "/(tabs)" } as const;

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
