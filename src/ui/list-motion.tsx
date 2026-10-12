/** Web: rows change without motion; Reanimated stays out of the web bundle (design-system test enforces it). */
import type { ReactNode } from "react";

export function RowMotion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
