
export interface BackRouter<T> {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: T) => void;
  navigate: (href: T) => void;
}

export function navigateBack<T>(
  router: BackRouter<T>,
  fallback: T,
  /** Skip history and go straight to `fallback` (see `resolveBackTarget`). */
  exact = false,
): void {
  if (!exact) {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
    return;
  }
  /**
   * An exact target lives in ANOTHER navigator — the tab the user came from —
   * while this screen sits on top of a stack that the anchored push mounted at
   * its own index. Those are two separate things to undo, and a single
   * cross-navigator `replace` only reliably does one of them: on web the URL
   * rebuilds the whole tree so it looked right, but on native the action is
   * dispatched to the nearest navigator, so the user was left standing on the
   * anchor — the Financial Table — instead of the screen they came from.
   *
   * Unwind this stack first, then move to the recorded origin. Leaving the
   * stack wound up would also mean returning to that tab later reopened the
   * screen the user had just left.
   */
  if (router.canGoBack()) router.back();
  router.navigate(fallback);
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
