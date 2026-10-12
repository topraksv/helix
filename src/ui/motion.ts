import { useSyncExternalStore } from "react";
import { AccessibilityInfo, type EmitterSubscription } from "react-native";

let reducedMotion = false;
let nativeSubscription: EmitterSubscription | null = null;
const listeners = new Set<() => void>();

function updateReducedMotion(next: boolean) {
  if (reducedMotion === next) return;
  reducedMotion = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void AccessibilityInfo.isReduceMotionEnabled().then(updateReducedMotion).catch(() => {});
    nativeSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", updateReducedMotion);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      nativeSubscription?.remove();
      nativeSubscription = null;
    }
  };
}

/** One shared native listener backs every animated primitive in the app. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reducedMotion, () => false);
}

/** The same answer without subscribing, for a style a Pressable already re-renders to produce. */
export function isReducedMotion(): boolean {
  return reducedMotion;
}

let reduceTransparency = false;
let transparencySubscription: EmitterSubscription | null = null;
const transparencyListeners = new Set<() => void>();

function updateReduceTransparency(next: boolean) {
  if (reduceTransparency === next) return;
  reduceTransparency = next;
  for (const listener of transparencyListeners) listener();
}

function subscribeTransparency(listener: () => void) {
  transparencyListeners.add(listener);
  // react-native-web's AccessibilityInfo ships `isReduceMotionEnabled` and no
  // transparency equivalent, so calling it unguarded throws and takes the tree
  // down at first render. The setting is iOS-only; absent means false.
  if (transparencyListeners.size === 1 && typeof AccessibilityInfo.isReduceTransparencyEnabled === "function") {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(updateReduceTransparency).catch(() => {});
    transparencySubscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", updateReduceTransparency);
  }
  return () => {
    transparencyListeners.delete(listener);
    if (transparencyListeners.size === 0) {
      transparencySubscription?.remove();
      transparencySubscription = null;
    }
  };
}

/** iOS "Reduce Transparency"; Android and web blur nothing unasked, so false is correct there. */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(subscribeTransparency, () => reduceTransparency, () => false);
}
