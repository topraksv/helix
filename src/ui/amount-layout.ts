/** Font steps for exact monetary values that must stay readable without clipping. */
export type AmountScale = "regular" | "large" | "hero";

const FONT_STEPS: Record<AmountScale, readonly number[]> = {
  regular: [15, 14, 13, 12, 11],
  large: [33, 30, 27, 24, 21, 18, 16, 15],
  hero: [38, 34, 30, 27, 24, 21, 18, 16, 15],
};

export function initialAmountFontSize(scale: AmountScale): number {
  return FONT_STEPS[scale][0]!;
}

/**
 * Move down one measured step. The last step is stable so a text-layout event
 * can never create an update loop. Font scaling remains enabled; at large OS
 * text sizes the base size simply walks farther down the same scale.
 */
export function nextAmountFontSize(scale: AmountScale, current: number): number {
  const steps = FONT_STEPS[scale];
  const last = steps[steps.length - 1]!;
  if (current > steps[0]!) return steps[0]!;
  if (current <= last) return current;
  return steps.find((step) => step < current) ?? last;
}
