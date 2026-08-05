/**
 * The app's motion vocabulary, in one place.
 *
 * Helix had five animated behaviours across forty-five screens — a screen
 * fade, the toggle's thumb, the loading dots, the waiting medallion and the
 * drag handle — so almost everything appeared, changed and disappeared without
 * saying that it had. These primitives cover the cases that were missing, and
 * they all obey the same three rules:
 *
 * 1. Every family short-circuits on Reduce Motion. The end state is applied
 *    immediately; nothing is left half-drawn and no meaning lives in movement.
 * 2. Only `transform` and `opacity` are driven natively. A width, a height or
 *    a colour cannot be, so those animations say `useNativeDriver: false`
 *    rather than silently falling back.
 * 3. Duration comes from `motion`, never from a screen's private taste.
 *
 * React Native's own `Animated` is the driver. Reanimated, Skia and Gesture
 * Handler would each be a new native dependency, and none of what is here
 * needs one.
 */

import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { useReducedMotion } from "./motion";
import { motion, useTheme } from "./theme";

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
  const focused = useScreenFocus();
  const progress = useRef(new Animated.Value(0)).current;
  const wasFocused = useRef(false);
  useEffect(() => {
    const arriving = focused && !wasFocused.current;
    wasFocused.current = focused;
    if (!active || !focused) return;
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
  }, [active, focused, duration, token, progress, reducedMotion]);
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
 */
export function useScreenFocus(active = true): boolean {
  const navigation = useContext(NavigationContext);
  return useSyncExternalStore(
    React.useCallback(
      (notify) => {
        // `active` is what keeps this off the ledger: `Amount` calls it for
        // every cell, and a table of six hundred figures must not attach twelve
        // hundred navigation listeners to answer a question none of them ask.
        if (!navigation || !active) return () => {};
        const unsubscribeFocus = navigation.addListener("focus", notify);
        const unsubscribeBlur = navigation.addListener("blur", notify);
        return () => {
          unsubscribeFocus();
          unsubscribeBlur();
        };
      },
      [navigation, active],
    ),
    () => (active ? navigation?.isFocused() ?? true : true),
    () => true,
  );
}

/**
 * The entrance every screen runs — again on every visit, not once per mount.
 *
 * Expo Router keeps a tab's screen mounted after you leave it, so a mount-only
 * entrance played exactly once per session: the first time you opened
 * Yatırımlar it arrived, and every return after that was a repaint. The
 * navigator's own `focus` event is the trigger because it fires while the
 * navigation state is being dispatched — before the incoming scene is
 * rendered, let alone painted — so resetting to 0 there can never flash.
 *
 * Nothing listens for `blur`: the outgoing screen keeps its finished state
 * while the navigator fades it out, which is what stops a tab change from
 * looking like the old screen being deleted.
 */
export function useScreenEntrance(): Animated.Value {
  const reducedMotion = useReducedMotion();
  const navigation = useContext(NavigationContext);
  const progress = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    const enter = () => {
      running.current?.stop();
      if (reducedMotion) {
        progress.setValue(1);
        running.current = null;
        return;
      }
      progress.setValue(0);
      const animation = Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: Platform.OS !== "web",
        ...motion.spring.entrance,
      });
      running.current = animation;
      animation.start();
    };
    enter();
    const unsubscribe = navigation?.addListener("focus", enter);
    return () => {
      unsubscribe?.();
      running.current?.stop();
      running.current = null;
    };
  }, [navigation, progress, reducedMotion]);
  return progress;
}

/** The screen scaffold's entrance. Re-runs every time the screen is focused. */
export function ScreenEntrance({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useScreenEntrance();
  return (
    <Animated.View
      style={[
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
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
  const flash = useRef(new Animated.Value(0)).current;
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
 * A figure that counts to its new value instead of swapping to it.
 *
 * Only the app's hero figures use this — the balance on Durum, the free cash
 * on Yatırımlar. A table of amounts must never animate: twelve numbers moving
 * at once is noise, and the ledger's whole job is to be read. `enabled` is what
 * keeps it off the table; hooks cannot be called conditionally, so every
 * `Amount` runs this one and only the heroes ask it to move.
 *
 * It runs on every ARRIVAL, not once per mount. Expo Router keeps a tab's
 * screen alive, so a figure that counted only when it first appeared spent the
 * rest of the session as a static number — the owner asked for the reveal each
 * time, so arriving counts up from zero and a value that changes while you are
 * watching counts from what it was.
 *
 * The animation is on a plain number, not on a native driver, because the text
 * content itself changes; `format` is called on every frame, so it must stay
 * cheap. Reduce Motion shows the value outright.
 */
export function useCountUp(value: number, enabled = true, duration = motion.figure): number {
  const reducedMotion = useReducedMotion();
  const focused = useScreenFocus(enabled);
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  const wasFocused = useRef(false);
  useEffect(() => {
    const arriving = focused && !wasFocused.current;
    wasFocused.current = focused;
    const from = arriving ? 0 : previous.current;
    previous.current = value;
    if (!enabled || reducedMotion || !focused || from === value) {
      setShown(value);
      return;
    }
    const driver = new Animated.Value(0);
    const listener = driver.addListener(({ value: fraction }) => {
      setShown(Math.round(from + (value - from) * fraction));
    });
    const animation = Animated.timing(driver, {
      toValue: 1,
      duration,
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
  }, [value, enabled, focused, duration, reducedMotion]);
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
  const offset = useRef(new Animated.Value(0)).current;
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

/**
 * A block that opens and closes instead of blinking in and out.
 *
 * Height cannot be driven natively, so this measures its content once and
 * animates the measured height. Closed content stays mounted but is hidden
 * from assistive technology and from the tab order, because a collapsed
 * section is not content the user can reach.
 */
export function Collapse({
  open,
  children,
  style,
}: {
  open: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Closed means gone, not merely clipped. A zero-height box with
  // `overflow: hidden` still holds a laid-out subtree: assistive technology can
  // reach it, a pointer can be told to click it, and its controls stay in the
  // tab order. The content is unmounted once the closing animation has run, so
  // the exit is still animated and the collapsed state is genuinely absent.
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

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
      if (finished && !open) setMounted(false);
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
        style,
      ]}
    >
      <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>{children}</View>
    </Animated.View>
  );
}

/**
 * A confirmation that lands rather than appears: a small scale pop with the
 * spring the rest of the app enters with. Used where an action has succeeded
 * and the only other feedback would have been the screen changing.
 */
export function SuccessPop({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
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
  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
        },
        style,
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
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
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
 * The window changing colour, as a dissolve rather than a snap.
 *
 * Every colour in the app comes from one palette object, so switching theme
 * repaints the entire window in a single frame — the one change big enough to
 * read as a glitch. Animating the colours themselves would mean an animated
 * value behind every token in every component; this paints the palette you are
 * LEAVING over the top and fades it out, which costs one view and one opacity
 * and is indistinguishable from the expensive version.
 *
 * The effect must land before the browser paints, or the new theme flashes at
 * full strength for a frame before the old one covers it — hence the layout
 * effect, chosen once at module scope so the hook order never changes and a
 * static web render never calls it.
 */
const useThemeChangeEffect = typeof window === "undefined" ? useEffect : React.useLayoutEffect;

export function ThemeDissolve() {
  const { palette, scheme, paletteId } = useTheme();
  const reducedMotion = useReducedMotion();
  const identity = `${paletteId}|${scheme}`;
  const previous = useRef({ identity, background: palette.background });
  const progress = useRef(new Animated.Value(0)).current;
  const [leaving, setLeaving] = useState<string | null>(null);
  useThemeChangeEffect(() => {
    const before = previous.current;
    previous.current = { identity, background: palette.background };
    if (before.identity === identity || reducedMotion) return;
    progress.setValue(1);
    setLeaving(before.background);
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: motion.theme,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start(({ finished }) => {
      if (finished) setLeaving(null);
    });
    return () => {
      animation.stop();
      setLeaving(null);
    };
  }, [identity, palette.background, progress, reducedMotion]);
  if (leaving == null) return null;
  return (
    <Animated.View
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: leaving,
        opacity: progress,
      }}
    />
  );
}

/** A text node whose figure counts to its new value. `format` runs per frame. */
export function CountingText({
  value,
  format,
  style,
  accessibilityLabel,
  testID,
}: {
  value: number;
  format: (value: number) => string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const shown = useCountUp(value);
  return (
    <Text testID={testID} accessibilityLabel={accessibilityLabel ?? format(value)} style={style}>
      {format(shown)}
    </Text>
  );
}
