/** Cold start: the mark draws itself on the native splash's bare ground, then dissolves once the root is ready and the drawing has rested. It is the only boot indicator, so the gates beneath draw nothing. */

import { useEffect, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, type ViewStyle } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { tr } from "../i18n/tr";
import { BrandMark, preloadBrandMark } from "./brand";
import { useReducedMotion } from "./motion";
import { motion, useTheme } from "./theme";

/**
 * The drawn mark's height. The native splash is the bare ground
 * (`assets/brand/splash-blank.png`, transparent: the plugin's Android 12 theme
 * names an icon drawable whether or not an image is given). A splash showing
 * the finished symbol handed over to this mark starting from nothing, so the
 * owner saw the logo twice. Expo Go shows the app icon in its place, which no
 * setting reaches.
 */
const MARK_HEIGHT = 130;

/** Draw, rest and dissolve; slower than `motion.draw` so the launch is seen. */
const LAUNCH = { draw: 2000, rest: 300, fade: 400 } as const;

/** How long the drawing may hold an app that is ready. The drawing starts
 *  within a frame of mount, so it finishes and rests inside this; a web chunk
 *  that arrives late is cut off, not waited for. */
const HOLD_CEILING = LAUNCH.draw + LAUNCH.rest;

function hideSplash() {
  SplashScreen.hideAsync().catch(() => {});
}

export function Launch({ settled, onGone }: { settled: boolean; onGone: () => void }) {
  const { palette } = useTheme();
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
          backgroundColor: palette.background,
          // Opaque while it holds, so nothing it hides can be pressed; the app
          // takes input from the moment it starts to show through.
          pointerEvents: leaving ? "none" : "auto",
        },
        Platform.OS === "web"
          ? ({
              opacity: leaving && !reducedMotion ? 0 : 1,
              transitionProperty: "opacity",
              transitionDuration: `${LAUNCH.fade}ms`,
              transitionTimingFunction: motion.webEase,
            } as unknown as ViewStyle)
          : { opacity },
      ]}
    >
      {drawable && <BrandMark height={MARK_HEIGHT} duration={LAUNCH.draw} named />}
    </Animated.View>
  );
}
