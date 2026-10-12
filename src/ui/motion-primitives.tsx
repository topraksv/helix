/**
 * Shared motion. Every family short-circuits on Reduce Motion; only transform
 * and opacity run on the native driver; durations come from `motion`.
 * Animated values are held by `useState(() => new Animated.Value(x))`, not
 * `useRef(…).current`: that idiom reads a ref during render, which
 * `react-hooks/refs` rejects, and allocates on every render.
 */

import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { NavigationContext } from "expo-router/react-navigation";
import { useReducedMotion } from "./motion";
import { createScreenVisitStore, type ScreenVisitStore } from "./screen-visit";
import { motion, spacing, useTheme } from "./theme";
import { crossFadesNatively } from "./theme-transition";

/**
 * A value that runs 0 → 1 when `active` becomes true, and again whenever
 * `token` changes.
 *
 * Charts use it to draw themselves in; anything that reveals a shape rather
 * than moving one can share it. `token` is what makes a chart answer a filter:
 * without it the first render was the only animated one, and switching period
 * or series swapped one finished picture for another in a single frame.
 *
 * The first draw is a reveal and takes the long duration; every later one is an
 * update and takes the standard one, because by then the user is waiting for an
 * answer rather than being introduced to a shape. Reduce Motion lands on 1
 * without a frame of animation, so the chart is simply there.
 */
export function useDrawIn(active = true, duration = motion.draw, token?: string | number): Animated.Value {
  const reducedMotion = useReducedMotion();
  const visit = useScreenVisit();
  const [progress] = useState(() => new Animated.Value(0));
  const lastVisit = useRef(0);
  useEffect(() => {
    const arriving = visit !== lastVisit.current;
    lastVisit.current = visit;
    if (!active) return;
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      // Arriving is a reveal and takes the long duration; a filter changed
      // under a chart you are already reading is an update, and by then you
      // are waiting for an answer rather than being introduced to a shape.
      duration: arriving ? duration : motion.standard,
      easing: Easing.out(Easing.cubic),
      // A path length and an arc offset are neither transform nor opacity.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, visit, duration, token, progress, reducedMotion]);
  return progress;
}

/**
 * Whether the screen this component belongs to is the one the user is looking
 * at.
 *
 * `useIsFocused` would do the same job, but it calls `useNavigation`, which
 * throws outside a navigator — and three of this app's surfaces (the lock gate,
 * the frozen gate, the first-pull wait) render above the router's `Stack` with
 * no navigation object at all. Absent one, a screen is always "focused", which
 * is exactly the mount-only behaviour those surfaces had before.
 *
 * A screen's own navigator is the arrival boundary — a tab switch, a
 * root-level push/pop and a nested stack push/pop all count as an arrival,
 * because the entrance replays every time the screen is returned to, not
 * only on the first visit. React Navigation only emits focus/blur on a
 * screen once every ancestor agrees it is on show, which is what makes one
 * listener here correct for all three cases.
 */

export const ScreenVisitContext = React.createContext<ScreenVisitStore | null>(null);

/**
 * How many times this screen has been arrived at.
 *
 * A boolean was tried and works on the web only. `react-native-screens` FREEZES
 * an inactive screen, so a blurred tab never renders the `focused: false` in
 * between — it wakes up already true, a "did it change?" comparison sees no
 * change, and nothing replays. That is the whole reason Yatırımlar animated in
 * a browser and never on a phone.
 *
 * A counter cannot be coalesced away: however many renders the freeze swallows,
 * the number the effect last saw is not the number it sees now. The focus
 * EVENT is the trigger rather than a rendered transition. One `Screen` owns
 * the listener and shares the counter with hero children through context, so a
 * screen with a chart and a counting figure does not subscribe three times.
 */
export function useScreenVisitController(): ScreenVisitStore {
  const scopedVisit = useContext(ScreenVisitContext);
  const navigation = useContext(NavigationContext);
  const ownStore = useRef<ScreenVisitStore | null>(null);
  const store = scopedVisit ?? (ownStore.current ??= createScreenVisitStore());
  useEffect(() => {
    if (scopedVisit != null || !navigation) return;
    // The screen's OWN navigator is the arrival boundary, not a specific
    // ancestor type: a tab switch, a root-level push/pop and a nested stack
    // push/pop all fire focus/blur on this exact screen. Listening here once
    // — rather than walking every ancestor — is what keeps a single
    // navigation action from firing more than one increment.
    let blurredSinceMount = false;
    const blur = () => { blurredSinceMount = true; };
    const arrive = () => {
      // The initial focus right after mount is the first entrance, already
      // played by the mount effect; only a focus that follows a real blur is
      // a return.
      if (blurredSinceMount) store.increment();
    };
    const unsubscribeBlur = navigation.addListener("blur", blur);
    const unsubscribeFocus = navigation.addListener("focus", arrive);
    return () => {
      unsubscribeBlur();
      unsubscribeFocus();
    };
  }, [navigation, scopedVisit, store]);
  return store;
}

export function useScreenVisit(): number {
  const store = useScreenVisitController();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useScreenFocus(): boolean {
  const navigation = useContext(NavigationContext);
  return useSyncExternalStore(
    React.useCallback(
      (notify) => {
        const unsubscribes: (() => void)[] = [];
        for (let level = navigation; level; level = level.getParent()) {
          unsubscribes.push(level.addListener("focus", notify), level.addListener("blur", notify));
        }
        return () => {
          for (const unsubscribe of unsubscribes) unsubscribe();
        };
      },
      [navigation],
    ),
    () => navigation?.isFocused() ?? true,
    () => true,
  );
}

/**
 * A one-shot pulse: 1 the instant `value` changes, decaying to 0.
 *
 * Built for the market tiles, where a quote arrives at most every three
 * seconds and the only sign it had changed was the number being different from
 * the one you were not looking at. It never fires on the first render — an
 * arriving screen has not changed anything — and it drives an opacity, so the
 * tint it lights can stay on the native driver.
 */
export function useValueFlash(value: number, enabled = true): Animated.Value {
  const reducedMotion = useReducedMotion();
  const [flash] = useState(() => new Animated.Value(0));
  const previous = useRef(value);
  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    if (!changed || !enabled || reducedMotion) return;
    flash.setValue(1);
    const animation = Animated.timing(flash, {
      toValue: 0,
      duration: motion.settle,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [value, enabled, flash, reducedMotion]);
  return flash;
}

/**
 * Where an arrival's count-up starts, as a fraction of the settled figure.
 *
 * Not a duration, so it does not belong in `motion`: it is the SHAPE of one
 * hook's compromise between "money climbs" and "a balance must never look
 * stale", and there is exactly one figure per screen that uses it.
 */
const ARRIVAL_APPROACH = 0.92;

/**
 * A figure that counts to its value instead of appearing at it.
 *
 * Only a surface's ONE hero figure uses this — the balance on Durum, the free
 * cash on Yatırımlar — and `Amount` reaches it through a separate component, so
 * a table of six hundred cells neither runs this hook nor subscribes to
 * navigation to feed it.
 *
 * Three starting points, and the distance between them is the whole design.
 *
 * The first sight of a figure counts from zero. A real change counts from the
 * old value, so the movement is the change. A return with nothing new counts
 * from `ARRIVAL_APPROACH` of the settled figure, so it moves without reading as a reload.
 *
 * The animation is on a plain number, not on a native driver, because the text
 * content itself changes; `format` is called on every frame, so it must stay
 * cheap. Reduce Motion shows the value outright.
 */
export function useCountUp(value: number): number {
  const reducedMotion = useReducedMotion();
  const visit = useScreenVisit();
  const [shown, setShown] = useState(value);
  // Nothing has been shown yet, so the first pass counts up from zero. After
  // that this holds whatever the reader last saw, which is what a change
  // should be measured from.
  const previous = useRef(0);
  useEffect(() => {
    // `previous` already equalling the value means nothing about the figure
    // changed, so this run is an arrival rather than an update, and it starts
    // near the answer instead of at zero. Rounding keeps the first frame a
    // whole minor unit, like every frame after it.
    const settled = previous.current === value;
    const from = settled ? Math.round(value * ARRIVAL_APPROACH) : previous.current;
    previous.current = value;
    if (reducedMotion || from === value) {
      setShown(value);
      return;
    }
    const driver = new Animated.Value(0);
    const listener = driver.addListener(({ value: fraction }) => {
      setShown(Math.round(from + (value - from) * fraction));
    });
    const animation = Animated.timing(driver, {
      toValue: 1,
      duration: motion.figure,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) setShown(value);
    });
    return () => {
      animation.stop();
      driver.removeListener(listener);
      setShown(value);
    };
  }, [value, reducedMotion, visit]);
  return shown;
}

/**
 * Two or three oscillations that say "this field, not that one".
 *
 * Errors do not overshoot — an overshoot reads as playful, and a refused
 * amount is not. Returns the style to spread and the trigger to call.
 */
export function useShake(): { style: { transform: { translateX: Animated.Value }[] }; shake: () => void } {
  const reducedMotion = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  const shake = React.useCallback(() => {
    if (reducedMotion) return;
    offset.setValue(0);
    Animated.sequence(
      [8, -6, 4, 0].map((to) =>
        Animated.timing(offset, {
          toValue: to,
          duration: motion.shake / 4,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== "web",
        }),
      ),
    ).start();
  }, [offset, reducedMotion]);
  return { style: { transform: [{ translateX: offset }] }, shake };
}

/** A block that opens and closes instead of blinking in and out. */
export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return Platform.OS === "web"
    ? <MeasuredCollapse open={open}>{children}</MeasuredCollapse>
    : <NativeCollapse open={open}>{children}</NativeCollapse>;
}

/** Web needs a measured height because CSS cannot animate the native driver. */
function MeasuredCollapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Closed means gone, not merely clipped. A zero-height box with
  // `overflow: hidden` still holds a laid-out subtree: assistive technology can
  // reach it, a pointer can be told to click it, and its controls stay in the
  // tab order. The content is unmounted once the closing animation has run, so
  // the exit is still animated and the collapsed state is genuinely absent.
  const [mounted, setMounted] = useState(open);
  const [progress] = useState(() => new Animated.Value(open ? 1 : 0));

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    if (reducedMotion || contentHeight == null) {
      progress.setValue(open ? 1 : 0);
      if (!open) setMounted(false);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: motion.standard,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // A height is layout, so it cannot be driven natively.
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        // A closed panel keeps no opinion about its old height: the content
        // is unmounted next, and the next open measures fresh rather than
        // animating to whatever this instance last happened to measure —
        // which, on a device slow enough to still be settling web fonts or
        // reflowing a wrapped hint line, was not always this content's real
        // height and briefly left true content and animated height apart.
        setContentHeight(null);
      }
    });
    return () => animation.stop();
  }, [open, mounted, contentHeight, progress, reducedMotion]);

  if (!mounted) return null;
  return (
    <Animated.View
      style={[
        {
          overflow: "hidden",
          height: contentHeight == null
            ? undefined
            : progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }),
          opacity: progress,
        },
      ]}
    >
      <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

/** 0 → 1 on the shared entrance spring, or 1 at once under Reduce Motion. */
export function useEntranceProgress(): Animated.Value {
  const reducedMotion = useReducedMotion();
  // Starts where it will be drawn, so the first painted frame is already
  // correct. Seeding at rest and moving it in an effect showed one frame at
  // the settled position before the offset applied, which is a flicker.
  const [progress] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: Platform.OS !== "web",
      ...motion.spring.entrance,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return progress;
}

/**
 * Native collapse deliberately animates only compositor properties.
 *
 * Driving height on the JS thread made a fast open/close sequence compete
 * with the forecast's chart and scroll layout. The content now mounts at its
 * natural height and uses a native opacity/translation transition; the stale
 * callback that used to leave the measured panel stuck cannot win a reversal.
 */
function NativeCollapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const mountedRef = useRef(open);
  const [progress] = useState(() => new Animated.Value(open ? 1 : 0));

  useEffect(() => {
    if (open && !mountedRef.current) {
      mountedRef.current = true;
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(open ? 1 : 0);
      if (!open) {
        mountedRef.current = false;
        setMounted(false);
      }
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: motion.standard,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) {
        mountedRef.current = false;
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [open, mounted, progress, reducedMotion]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={[
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-spacing.xs, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A confirmation that lands rather than appears: a small scale pop with the
 * spring the rest of the app enters with. Used where an action has succeeded
 * and the only other feedback would have been the screen changing.
 */
export function SuccessPop({ children }: { children: React.ReactNode }) {
  const progress = useEntranceProgress();
  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Enters from below the edge it is anchored to.
 *
 * The undo bar is the only confirmation some deletes get, and it used to fade
 * in where it stood — which reads as "this was always here" rather than "this
 * just happened". Coming up off the bottom edge says where it came from and
 * that it is temporary.
 *
 * `distance` is how far below its resting place it starts. A snackbar is a
 * small thing arriving near where it lands; a phone-width picker is a sheet
 * pulled up off the edge of the screen and needs the longer travel to read as
 * one.
 */
export function SlideUp({
  children,
  style,
  distance = 24,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  distance?: number;
}) {
  const progress = useEntranceProgress();
  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Native and View-Transition-less browsers: veil the old root background
 * over the new theme and fade it. A layout effect, so the veil lands before
 * the first paint of the new palette.
 */
const VEIL_STRENGTH = 0.42;

const useThemeChangeEffect = typeof window === "undefined" ? useEffect : React.useLayoutEffect;

export function ThemeDissolve() {
  const { palette, scheme, paletteId } = useTheme();
  const reducedMotion = useReducedMotion();
  const identity = `${paletteId}|${scheme}`;
  const previous = useRef(identity);
  const previousPalette = useRef(palette.background);
  const browserCrossFades = crossFadesNatively();
  const [progress] = useState(() => new Animated.Value(0));
  const [transitionFrom, setTransitionFrom] = useState<string | null>(null);
  const [webFade, setWebFade] = useState<"visible" | "fading">("fading");
  useThemeChangeEffect(() => {
    const before = previous.current;
    const from = previousPalette.current;
    previous.current = identity;
    previousPalette.current = palette.background;
    if (before === identity || reducedMotion || browserCrossFades) {
      setTransitionFrom(null);
      setWebFade("fading");
      return;
    }
    setTransitionFrom(from);
    // React Native Web's JS-driven Animated fallback updates a full-screen
    // opacity value on every frame. On a phone-sized browser that competes
    // with the theme repaint and is the source of the visible hitch. Mount
    // the old-colour veil once, then let the compositor own its CSS fade.
    if (Platform.OS === "web") {
      setWebFade("visible");
      const frame = window.requestAnimationFrame(() => setWebFade("fading"));
      const timer = window.setTimeout(() => setTransitionFrom(null), motion.theme + 50);
      return () => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
        setTransitionFrom(null);
      };
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.theme,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setTransitionFrom(null);
    });
    return () => {
      animation.stop();
      setTransitionFrom(null);
    };
  }, [identity, palette.background, progress, reducedMotion, browserCrossFades]);
  if (!transitionFrom) return null;
  return (
    <Animated.View
      testID="theme-dissolve"
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: transitionFrom },
        Platform.OS === "web"
          ? ({
              opacity: webFade === "visible" ? VEIL_STRENGTH : 0,
              transitionProperty: "opacity",
              transitionDuration: `${motion.theme}ms`,
              transitionTimingFunction: motion.webEase,
              willChange: "opacity",
            } as unknown as ViewStyle)
          : {
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [VEIL_STRENGTH, 0] }),
            },
      ]}
    />
  );
}
