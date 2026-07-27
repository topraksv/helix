/** RN Modal animations do not inherit the preference from Animated children. */
export function modalAnimationType(reducedMotionEnabled: boolean): "none" | "fade" {
  return reducedMotionEnabled ? "none" : "fade";
}
