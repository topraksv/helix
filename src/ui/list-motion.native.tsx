/**
 * A row that closes its own gap.
 *
 * Deleting from a `CardList` used to snap every row below it up in one frame,
 * so the undo bar said something was removed while the list never showed WHICH
 * gap closed. `LinearTransition` animates the positions the layout pass
 * computes anyway, which is why it costs a worklet rather than a re-render.
 *
 * `ReduceMotion.System` is not optional here. Every other family in this app
 * short-circuits through `useReducedMotion`, and a Reanimated animation does
 * not consult that subscriber — it has its own modifier, and without it this
 * would be the one motion that ignores the setting.
 *
 * Reanimated is already in the tree as a `react-native-keyboard-controller`
 * peer, so this costs no new dependency; the `.native` split is what keeps it
 * out of the web bundle.
 */
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
