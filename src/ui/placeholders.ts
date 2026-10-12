/** Rotating examples on one shared beat, ticking only while a sample is visible, and held still under reduced motion. */

import { useState, useSyncExternalStore } from "react";
import { tr } from "../i18n/tr";
import { useReducedMotion } from "./motion";

const ROTATE_MS = 4000;

/** One beat for every placeholder; the interval runs only while something is subscribed. */
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

const still = () => () => {};

function useTick(active: boolean): number {
  const subscribe = active ? subscribeTick : still;
  return useSyncExternalStore(subscribe, getTick, getTick);
}

/** `active`: whether the field is empty, so a placeholder is on screen. */
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
