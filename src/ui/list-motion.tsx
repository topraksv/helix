/**
 * How a list row behaves when the list around it changes — on the web, not at
 * all.
 *
 * The native file beside this one uses Reanimated's layout animations, which
 * are the right answer for a row appearing, leaving or moving up to fill a gap.
 * They are not the right answer on the web: Reanimated's web support runs the
 * same animations in JavaScript with "lower efficiency" and no springs, and
 * pulling it into the entry bundle would cost every visitor the download for a
 * cosmetic gain. `keyboard-safe.tsx` draws the same boundary for the same
 * reason, and `tests/ui/design-system-contract.test.ts` now enforces it: an
 * import of `react-native-reanimated` outside a `.native` file fails the suite.
 *
 * So the web keeps the honest behaviour it already had — rows appear and
 * disappear without motion — and native gets the one that reads better.
 */
import type { ReactNode } from "react";

export function RowMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
