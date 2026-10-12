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

/** Up to nine characters is safe unmeasured at the regular scale; ten can overflow the narrowest column, so it is measured. */
const SAFE_UNMEASURED_LENGTH = 9;

/**
 * Whether a figure has to be measured before it is trusted to fit.
 *
 * Every scale above `regular` opens large enough to overflow something, so
 * those are always measured; `regular` is measured only when it is long
 * enough to be at risk. Pure, so the bound is a test rather than a screenshot.
 */
export function shouldMeasureAmountFit(
  scale: AmountScale,
  formatted: string,
  callerFixedFontSize = false,
): boolean {
  // A caller that fixes its own size (the ledger) has already decided what fits; measuring each cell again is a forced layout per cell.
  if (callerFixedFontSize) return false;
  return scale !== "regular" || formatted.length > SAFE_UNMEASURED_LENGTH;
}
