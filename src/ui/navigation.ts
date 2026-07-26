/**
 * Back navigation.
 *
 * There used to be a whole subsystem here: an allowlist of recorded origins, an
 * "exact" mode that unwound one navigator before moving to another, and a relay
 * that handed a screen's own origin to the next screen so it could be handed
 * back. All of it existed to repair one thing — pushing a screen that lives in
 * another tab used `{ withAnchor: true }`, which mounts that tab's index
 * underneath, so plain history popped to a screen the user had never visited.
 *
 * It also only ever repaired the BUTTON. The iOS edge swipe pops the stack
 * without consulting any of it, so the gesture kept landing on the anchor.
 *
 * A screen reachable from more than one place now has a root-level route, and a
 * cross-tab push goes there instead. What sits under it is the screen the user
 * came from, so plain history is the correct answer for the button and the
 * gesture alike, and neither needs to be told anything.
 */

export interface BackRouter<T> {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: T) => void;
}

export function navigateBack<T>(router: BackRouter<T>, fallback: T): void {
  if (router.canGoBack()) router.back();
  // No history: a direct link, a hand-typed URL or a stale bookmark. The
  // fallback is the screen's deterministic parent.
  else router.replace(fallback);
}
