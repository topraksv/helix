import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Easing, type EmitterSubscription } from "react-native";

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

/** One dim-and-return of a waiting caption. */
const WAITING_PULSE_MS = 1600;
/**
 * The dimmest a waiting caption may go.
 *
 * Measured, not chosen: at 0.72 the faintest moment of the faintest palette
 * (clay/sand light) still reads 5.2:1 against its background, so the text
 * clears 4.5:1 throughout the cycle. A deeper trough would trade legibility
 * for motion on screens where this caption is the only thing to read.
 */
const WAITING_PULSE_FLOOR = 0.72;

/**
 * The app's one "still working" text animation.
 *
 * A caption that is merely dimmed reads as decoration and gets skipped; the
 * pulse is what says the app is still doing something. Reduced motion holds it
 * at full strength rather than dropping to the floor.
 */
export function useWaitingPulse(): Animated.Value {
  const reducedMotion = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(1);
      return;
    }
    const step = (toValue: number) =>
      Animated.timing(pulse, {
        toValue,
        duration: WAITING_PULSE_MS / 2,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([step(WAITING_PULSE_FLOOR), step(1)]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);
  return pulse;
}
