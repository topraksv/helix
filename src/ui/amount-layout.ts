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

/**
 * The longest regular-scale amount that is safe to render without measuring.
 *
 * `Figure` skips its overflow probe for short amounts, because the probe is a
 * layout read and the ledger paints 240 of these at once. The bound was
 * `length > 10`, and 10 is exactly the length of "₺90.500,00" — which is what
 * the dashboard's three-up month strip shows. At 320px each of those three
 * columns is about 88px, a 10-character amount at the regular scale's opening
 * 15px measures a little over 90, and the figure never shrank because it was
 * never measured: measured on the real build, Gelir and Çıkış overlapped by
 * 2px and read as one run of digits.
 *
 * Nine characters ("₺9.500,00") is ~75px at the same size, which clears the
 * narrowest column the app lays out with room to spare. Ten is inside the
 * margin of error, so ten gets measured.
 */
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
  // A caller that names its own font size has already decided what fits. The
  // ledger does exactly that: it derives one size per column from
  // `ledgerCellWidth` and the widest amount in it, then hands that size to
  // every cell. Measuring each of them again asks the browser for a synchronous
  // layout per cell — 504 of them on a five-year workspace, in an effect that
  // re-runs on every grid re-render. Measured at 6x CPU throttle, that was
  // 532ms to pin a column and 750ms to switch orientation: a visible freeze on
  // a phone, for an answer the caller already had.
  if (callerFixedFontSize) return false;
  return scale !== "regular" || formatted.length > SAFE_UNMEASURED_LENGTH;
}
