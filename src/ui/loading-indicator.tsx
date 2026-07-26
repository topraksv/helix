/**
 * The app's waiting indicator.
 *
 * Deliberately NOT a logo, and deliberately not two things in sequence. A mark
 * that appears part-way through a wait changes shape while the user is looking
 * at it, and at the size a loading state can afford, a detailed logo is a
 * smudge. Both were tried and both read worse than the spinner they replaced.
 *
 * What is here instead: three dots easing in and out on a staggered loop. One
 * appearance for the whole wait, no image to decode, nothing laid out twice,
 * and it animates only `opacity` — which runs on the native driver, so the
 * loop costs nothing on the JS thread while the app is busy doing the very
 * work being waited on. Reduced motion holds the dots still rather than
 * blinking them.
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "./motion";
import { tr } from "../i18n/tr";
import { useTheme } from "./theme";

const CYCLE_MS = 1200;
const DOTS = 3;

export function LoadingIndicator({ size = 8 }: { size?: number }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  // One value per dot, so each sits at its own point in the same cycle.
  const values = useRef(Array.from({ length: DOTS }, () => new Animated.Value(0))).current;

  useEffect(() => {
    if (reducedMotion) return;
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((CYCLE_MS / DOTS) * index),
          Animated.timing(value, { toValue: 1, duration: CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay((CYCLE_MS / DOTS) * (DOTS - 1 - index)),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [values, reducedMotion]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={tr.dataState.loading}
      accessibilityState={{ busy: true }}
      style={{ flexDirection: "row", alignItems: "center", gap: size }}
    >
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: palette.primary,
            opacity: reducedMotion ? 0.55 : value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
          }}
        />
      ))}
    </View>
  );
}
