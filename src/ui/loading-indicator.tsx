/**
 * The app's one waiting visual and one delayed-reveal boundary.
 *
 * `DelayedLoading` owns the shared 350 ms threshold, so callers delay either
 * the whole notice or the compact indicator without stacking timers.
 * `LoadingIndicator` itself is immediate: three easing dots for indeterminate
 * work, or the same stable frame as a progress bar when a phase ratio exists.
 * Reduced motion holds the dots still.
 */

import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";
import { useReducedMotion } from "./motion";
import { tr } from "../i18n/tr";
import { loadingSize, motion, radius, useTheme } from "./theme";

const DOTS = 3;

export interface ProgressValue {
  completed: number;
  total: number;
}

export function DelayedLoading({
  active = true,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), motion.loadingReveal);
    return () => clearTimeout(timer);
  }, [active]);
  return visible ? children : null;
}

export function LoadingIndicator({
  size = 8,
  progress,
  label = tr.dataState.loading,
}: {
  size?: number;
  progress?: ProgressValue | null;
  label?: string;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  // One value per dot, so each sits at its own point in the same cycle.
  const values = useRef(Array.from({ length: DOTS }, () => new Animated.Value(0))).current;

  useEffect(() => {
    if (reducedMotion || progress) return;
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((motion.loading / DOTS) * index),
          Animated.timing(value, { toValue: 1, duration: motion.loading / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: motion.loading / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay((motion.loading / DOTS) * (DOTS - 1 - index)),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [progress, reducedMotion, values]);

  const completed = progress
    ? Math.min(Math.max(progress.completed, 0), Math.max(progress.total, 1))
    : 0;
  const total = progress ? Math.max(progress.total, 1) : 1;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityValue={progress ? { min: 0, max: total, now: completed } : undefined}
      style={{ flexDirection: "row", alignItems: "center", gap: size }}
    >
      {progress ? (
        <View
          style={{
            width: loadingSize.progressWidth,
            height: Math.max(size - 2, 6),
            borderRadius: radius.full,
            backgroundColor: palette.surfaceStrong,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.round((completed / total) * 100)}%`,
              height: "100%",
              borderRadius: radius.full,
              backgroundColor: palette.primary,
            }}
          />
        </View>
      ) : (
        values.map((value, index) => (
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
        ))
      )}
    </View>
  );
}

export function DelayedLoadingIndicator(props: React.ComponentProps<typeof LoadingIndicator>) {
  return (
    <DelayedLoading>
      <LoadingIndicator {...props} />
    </DelayedLoading>
  );
}
