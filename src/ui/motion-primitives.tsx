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

import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useReducedMotion } from "./motion";
import { motion } from "./theme";

/**
 * A value that runs 0 → 1 once, when `active` becomes true.
 *
 * Charts use it to draw themselves in; anything that reveals a shape rather
 * than moving one can share it. Reduce Motion lands on 1 without a frame of
 * animation, so the chart is simply there.
 */
export function useDrawIn(active = true, duration = motion.draw): Animated.Value {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      // A path length and an arc offset are neither transform nor opacity.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, duration, progress, reducedMotion]);
  return progress;
}

/**
 * A figure that counts to its new value instead of swapping to it.
 *
 * Only the app's hero figures use this — the balance on Durum, the free cash
 * on Yatırımlar. A table of amounts must never animate: twelve numbers moving
 * at once is noise, and the ledger's whole job is to be read.
 *
 * The animation is on a plain number, not on a native driver, because the text
 * content itself changes; `format` is called on every frame, so it must stay
 * cheap. Reduce Motion, and the very first render, show the value outright —
 * counting up from zero on open would be a lie about what changed.
 */
export function useCountUp(value: number, enabled = true, duration = motion.figure): number {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  const settled = useRef(false);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    // `enabled` is what keeps this off the ledger. Hooks cannot be called
    // conditionally, so every `Amount` runs this one — but only the two hero
    // figures ask it to animate. Without the guard a table of amounts would
    // re-render per frame whenever any of its cells changed, which is both the
    // wrong behaviour and the wrong cost.
    if (!enabled || reducedMotion || !settled.current || from === value) {
      settled.current = true;
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
  }, [value, enabled, duration, reducedMotion]);
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
 */
export function SlideUp({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
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
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
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
