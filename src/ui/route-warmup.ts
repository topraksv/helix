/**
 * Mount a lazy tab once, while nothing is waiting on the main thread.
 *
 * Moves the first-visit build from the tab transition into idle time.
 *
 * `lazy: false` on the navigator was rejected. It warms all five tabs during
 * boot instead of the one the user actually opens, and boot is the other moment
 * nothing may be spent.
 */

import { useEffect } from "react";
import { InteractionManager, Platform } from "react-native";
import { useNavigation } from "expo-router";
import type { NavigationProp } from "expo-router/react-navigation";

/**
 * The tabs this hook may warm.
 *
 * Naming them is what lets `preload` typecheck: with no generic, expo-router
 * hands back a navigator whose param list is empty, so every route name is
 * `never` and the call has to be cast. A union of the real route names is both
 * cheaper than a cast and the thing that fails a build if a tab is renamed.
 */
type WarmableRoute = "cash-flow";

/** Once per app session, not once per mount. */
let warmed = false;

/** Idle after first paint: late enough to be free, early enough to be ready. */
const WARMUP_DELAY_MS = 1_200;

export function useWarmRoute(route: WarmableRoute): void {
  const navigation = useNavigation<NavigationProp<Record<WarmableRoute, undefined>>>();
  useEffect(() => {
    if (warmed) return;
    warmed = true;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // A navigator that has already been asked for this route, or does not
      // know it, must not take the app down over a warm-up.
      try {
        navigation.preload(route);
      } catch {
        // Nothing to recover: the screen simply mounts on first visit instead.
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => { timer = setTimeout(warm, WARMUP_DELAY_MS); };

    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number })
      .requestIdleCallback;
    // Native has no idle callback; the interaction queue is the closest thing,
    // and the delay after it keeps the warm-up clear of the first-run tour.
    const handle = Platform.OS === "web" || !InteractionManager
      ? null
      : InteractionManager.runAfterInteractions(later);
    if (!handle) {
      if (idle) idle(warm, { timeout: WARMUP_DELAY_MS * 2 });
      else later();
    }

    return () => {
      cancelled = true;
      handle?.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [navigation, route]);
}
