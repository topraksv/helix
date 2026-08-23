/**
 * Rotating example placeholders: every form shows a different, realistic
 * example each time (and cycles while the field is empty), instead of one
 * frozen sample value.
 *
 * Three things about HOW it cycles were wrong, and none of them were the idea:
 *
 * 1. One `setInterval` per call site. `transaction.tsx` and
 *    `investments/operation.tsx` ask for three placeholders each, so those
 *    screens ran three independent timers whose ticks did not line up — the
 *    examples changed at three different moments, which reads as three
 *    unrelated things twitching rather than as one set of examples refreshing.
 *    There is now ONE module-level ticker and every field reads the same beat.
 *
 * 2. The timer ran whether or not anything was showing a placeholder. A field
 *    with a value renders no placeholder at all, so the tick was pure work —
 *    and because the tick sets state in the SCREEN, a fully filled-in
 *    Yeni İşlem re-rendered itself every four seconds, forever. Callers now
 *    say when the sample is actually visible, and a hook that is not showing
 *    anything does not subscribe.
 *
 * 3. Reduced motion was ignored. Text that changes on its own every four
 *    seconds is exactly the class of movement that setting exists to stop, and
 *    the rest of this app honours it carefully. When it is on, the sample is
 *    picked once and held — the feature still works, it simply stops moving.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { tr } from "../i18n/tr";
import { useReducedMotion } from "./motion";

export const placeholderPools = {
  subscription: tr.placeholders.subscription,
  installment: tr.placeholders.installment,
  category: tr.placeholders.category,
  person: tr.placeholders.person,
  source: tr.placeholders.source,
  note: tr.placeholders.note,
  amount: tr.placeholders.amount,
  investmentProduct: tr.placeholders.investmentProduct,
  investmentQuantity: tr.placeholders.investmentQuantity,
  investmentUnitPrice: tr.placeholders.investmentUnitPrice,
  investmentNote: tr.placeholders.investmentNote,
  feedback: tr.placeholders.feedback,
} as const;

const ROTATE_MS = 4000;

/**
 * One beat for every placeholder in the app.
 *
 * The interval exists only while something is subscribed, so a screen with no
 * visible sample costs nothing and the last field to go quiet stops the clock.
 */
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickListeners.size === 1) {
    timer = setInterval(() => {
      tick += 1;
      for (const notify of tickListeners) notify();
    }, ROTATE_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getTick(): number {
  return tick;
}

/** Test seam: stop the shared clock and forget its subscribers. */
export function resetPlaceholderTicker(): void {
  if (timer != null) clearInterval(timer);
  timer = null;
  tickListeners.clear();
  tick = 0;
}

function useTick(active: boolean): number {
  const subscribe = active ? subscribeTick : () => () => {};
  return useSyncExternalStore(subscribe, getTick, getTick);
}

/**
 * A placeholder from the pool that starts at a random spot and keeps cycling.
 * Shared fields add the example prefix if the caller asks for a bare sample,
 * while already-prefixed values pass through unchanged.
 *
 * `active` is what the caller knows and this hook cannot: whether the field is
 * empty, and therefore whether a placeholder is on screen at all. It defaults
 * to true so a caller that has not been taught the difference behaves exactly
 * as before.
 */
export function useRotatingPlaceholder(
  pool: readonly string[],
  opts?: { prefix?: boolean; active?: boolean },
): string {
  const [start] = useState(() => Math.floor(Math.random() * pool.length));
  const reducedMotion = useReducedMotion();
  const rotating = (opts?.active ?? true) && !reducedMotion;
  const offset = useTick(rotating);
  const sample = pool[(start + offset) % pool.length] ?? "";
  return opts?.prefix === false ? sample : tr.placeholders.example(sample);
}

/**
 * Hold the shared clock while the user is on this screen but not looking at
 * examples — a screen that has scrolled its forms out of view, or one that is
 * behind a modal. Callers pass `false` and every field on the page stops.
 */
export function usePlaceholderRotationPaused(paused: boolean): void {
  useEffect(() => {
    if (!paused || timer == null) return;
    clearInterval(timer);
    timer = null;
    return () => {
      if (timer == null && tickListeners.size > 0) {
        timer = setInterval(() => {
          tick += 1;
          for (const notify of tickListeners) notify();
        }, ROTATE_MS);
      }
    };
  }, [paused]);
}
