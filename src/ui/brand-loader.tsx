/**
 * Loading indicator for the app's full-screen waits.
 *
 * A spinner is the right answer for a wait the user barely notices, so that is
 * what shows first — swapping straight to a large brand mark would make every
 * quick load flash a logo. Once a wait is long enough to feel like one, the
 * spinner gives way to the Helix symbol breathing slowly, which reads as "still
 * working" rather than "stuck".
 *
 * Inline waits (a button's own spinner, a settings row) deliberately keep the
 * plain `ActivityIndicator`: they sit inside a control that is itself the
 * context, and a breathing logo there would be noise.
 */

import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, View } from "react-native";
import { BrandMark } from "./brand";
import { useReducedMotion } from "./motion";
import { tr } from "../i18n/tr";
import { useTheme } from "./theme";

/** How long a wait has to last before it stops being "just a moment". */
export const BRAND_LOADER_DELAY_MS = 1200;
const BREATH_MS = 1900;

export function BrandLoader({ size = 64 }: { size?: number }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const [slow, setSlow] = useState(false);
  const breath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), BRAND_LOADER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!slow || reducedMotion) return;
    // In and out at the same pace, forever: a breath, not a pulse.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: BREATH_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [slow, reducedMotion, breath]);

  if (!slow) return <ActivityIndicator accessibilityLabel={tr.dataState.loading} color={palette.primary} />;

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={tr.dataState.loading} accessibilityState={{ busy: true }}>
      <Animated.View
        style={{
          transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) }],
          opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }),
        }}
      >
        <BrandMark size={size} />
      </Animated.View>
    </View>
  );
}
