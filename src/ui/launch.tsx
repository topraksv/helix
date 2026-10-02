/**
 * What a cold start shows between the native splash and the app: the mark
 * drawing itself on the splash's own ground, at the splash image's size and
 * place, so the hand-over from native to JavaScript changes nothing but the
 * mark beginning to move. It is held until the root has something to show and
 * the drawing has had its time, then dissolves into the app.
 *
 * It replaced the three-dot boot wait. A wait still shows one indicator for
 * its whole duration: the mark, from the first frame to the last, and never
 * dots under it, which is why the boot gates beneath draw nothing while this
 * is up.
 */

import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, type ViewStyle } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { tr } from "../i18n/tr";
import { BrandMark, preloadBrandMark } from "./brand";
import { useReducedMotion } from "./motion";
import { useTheme } from "./theme";

/**
 * The `expo-splash-screen` ground in `app.json`, which `+html.tsx` also paints
 * as the web's first frame. The page background is a different colour; the
 * dissolve carries that change, so the native hand-over does not have to.
 */
const SPLASH_GROUND = { light: "#E7ECEB", dark: "#101315" } as const;

/**
 * `imageWidth` in `app.json`. The plugin fits the image into a square of that
 * side on both platforms and centres it, and the mark is taller than wide, so
 * 130 is its HEIGHT — which is what `BrandMark`'s `size` measures. The splash
 * PNG is cropped to the drawing, so nothing else offsets it.
 */
const SPLASH_MARK = 130;

/** The drawing's length, the finished mark's rest and the dissolve. The chart's
 *  `motion.draw` (1150 ms) and a 120 ms dissolve were gone before they were
 *  seen; the owner asked for a slower launch (2026-10-02). */
const LAUNCH = { draw: 2000, rest: 300, fade: 400 } as const;

/** How long the drawing may hold an app that is ready. The drawing starts
 *  within a frame of mount, so it finishes and rests inside this; a web chunk
 *  that arrives late is cut off, not waited for. */
const HOLD_CEILING = LAUNCH.draw + LAUNCH.rest;

function hideSplash() {
  SplashScreen.hideAsync().catch(() => {});
}

export function Launch({ settled, onGone }: { settled: boolean; onGone: () => void }) {
  const { scheme } = useTheme();
  const reducedMotion = useReducedMotion();
  const [drawable, setDrawable] = useState(false);
  const [held, setHeld] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));
  const leaving = settled && (held || reducedMotion);

  useEffect(() => {
    let live = true;
    // A rejected chunk still ends the wait: the ground alone is the splash
    // without its symbol, and the app behind it is what matters.
    const show = () => live && setDrawable(true);
    preloadBrandMark().then(show, show);
    const timer = setTimeout(() => setHeld(true), HOLD_CEILING);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  // A frame after the commit that holds the mark, since an effect runs after
  // the commit and not after the paint: hiding any sooner shows the ground
  // without it for a frame.
  useEffect(() => {
    if (!drawable) return;
    const frame = requestAnimationFrame(hideSplash);
    return () => cancelAnimationFrame(frame);
  }, [drawable]);

  useEffect(() => {
    if (!leaving) return;
    // Again, directly: unmounting cancels the frame above, and a native splash
    // left up over a ready app is an app that looks dead.
    hideSplash();
    if (reducedMotion) {
      onGone();
      return;
    }
    // RN Web has no native driver: an Animated fade would repaint the whole
    // window from JavaScript while the first screen mounts under it. CSS fades
    // it off the main thread, as the theme veil does.
    if (Platform.OS === "web") {
      const timer = setTimeout(onGone, LAUNCH.fade);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: LAUNCH.fade,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onGone();
    });
    return () => animation.stop();
  }, [leaving, reducedMotion, opacity, onGone]);

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={tr.dataState.loading}
      accessibilityState={{ busy: true }}
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: SPLASH_GROUND[scheme],
          // Opaque while it holds, so nothing it hides can be pressed; the app
          // takes input from the moment it starts to show through.
          pointerEvents: leaving ? "none" : "auto",
        },
        Platform.OS === "web"
          ? ({
              opacity: leaving && !reducedMotion ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: `${LAUNCH.fade}ms`,
              transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
            } as unknown as ViewStyle)
          : { opacity },
      ]}
    >
      {drawable && <BrandMark size={SPLASH_MARK} duration={LAUNCH.draw} />}
    </Animated.View>
  );
}
