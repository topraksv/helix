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

/**
 * The same answer, read without subscribing.
 *
 * For a style a component already re-renders to produce — the hover fill is
 * computed inside a `Pressable`'s style callback, which runs on every pointer
 * enter and leave anyway. A hook there would add a subscriber per control on
 * screen to learn something that cannot change between those two renders
 * without one of them happening.
 */
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

/**
 * iOS "Reduce Transparency". Android and web have no equivalent setting and
 * report false, which is correct rather than a gap: neither platform blurs
 * anything the user did not ask for. There is no React Native API for iOS
 * "Increase Contrast", so it is deliberately not claimed anywhere.
 */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(subscribeTransparency, () => reduceTransparency, () => false);
}
