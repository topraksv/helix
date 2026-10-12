/** A row that animates the gap it leaves. `ReduceMotion.System` is required: Reanimated does not consult useReducedMotion. */
import type { ReactNode } from "react";
import Animated, { FadeOut, LinearTransition, ReduceMotion } from "react-native-reanimated";

import { motion } from "./theme";

export function RowMotion({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      layout={LinearTransition.duration(motion.standard).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(motion.feedback).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}
