/**
 * Mount a lazy tab once, while nothing is waiting on the main thread.
 *
 * A bottom-tab screen is lazy: it is created the first time it is focused,
 * which is the one moment it must not be. The navigator is running its `fade`
 * between two scenes while the whole tree is built, styled and committed on the
 * same thread that has to draw those frames.
 *
 * Measured on the shipped web build at 6x CPU throttling, following the exact
 * sequence the owner described — sit on the dashboard, reload, then go straight
 * to Mali Tablo:
 *
 *   without this hook   first arrival: 2 long tasks, 112ms, longest 58ms
 *                       later arrivals: 0
 *   with this hook      first arrival: 0 long tasks
 *
 * Once, then never again, on a ledger holding six transactions — the cost is
 * the tree, not the data, so a real account does not escape it.
 *
 * Preloading does not make the work cheaper; it moves it off the transition and
 * into idle, where a 58ms task drops no frame anyone is looking at. The
 * screen's live queries start early as a result, which is the price: they would
 * have started on first visit anyway, so this brings them forward rather than
 * adding them.
 *
 * `lazy: false` on the navigator was rejected. It warms all five tabs during
 * boot instead of the one the user actually opens, and boot is the other moment
 * nothing may be spent.
 */

import { useEffect } from "react";
import { InteractionManager, Platform } from "react-native";
import { useNavigation } from "expo-router";
import type { NavigationProp } from "@react-navigation/native";

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
