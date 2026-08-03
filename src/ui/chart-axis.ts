/** Deterministic monetary axis geometry shared by the column chart and tests. */

export interface BarAxis {
  min: number;
  max: number;
  step: number;
  /** Rounded reference gridlines — the ruler you compare against. */
  ticks: number[];
  /**
   * The extremes that are actually in the data, labelled on the axis in their
   * own right.
   *
   * A rounded ruler alone answers "roughly how big" and refuses to answer "how
   * big": a 120.000 column between a 100.000 and a 150.000 line reads as 100,
   * because that is the only number written next to it. The real figure belongs
   * on the axis beside the reference values, not instead of them.
   */
  valueTicks: number[];
}

function niceStep(range: number, targetIntervals = 6): number {
  const roughStep = Math.max(1, range / targetIntervals);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

/**
 * Resolve a truthful, compact axis from the values that are actually visible.
 * Zero is included for signed financial comparison; a small outer pad prevents
 * a single bar from touching the plot edge without letting a forced +1 value
 * create a large positive range for an all-negative data set.
 */
export function resolveBarAxis(values: readonly (number | null)[]): BarAxis | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (finite.length === 0) return null;

  const dataMin = Math.min(0, ...finite);
  const dataMax = Math.max(0, ...finite);
  // A flat zero series still needs a visible ruler. A negative tick would be
  // misleading here, while a tiny symmetric domain keeps the zero baseline
  // legible without implying a financial amount that exists.
  if (dataMin === 0 && dataMax === 0) {
    return { min: -1, max: 1, step: 1, ticks: [1, 0, -1], valueTicks: [] };
  }
  const range = Math.max(dataMax - dataMin, 1);
  const pad = Math.max(range * 0.08, Math.max(Math.abs(dataMin), Math.abs(dataMax), 1) * 0.01);
  const paddedMin = dataMin < 0 ? dataMin - pad : 0;
  const paddedMax = dataMax > 0 ? dataMax + pad : 0;
  const step = niceStep(paddedMax - paddedMin);
  const min = dataMin < 0 ? Math.floor(paddedMin / step) * step : 0;
  const max = dataMax > 0 ? Math.ceil(paddedMax / step) * step : 0;
  const span = Math.max(step, max - min);
  const reference = Array.from({ length: Math.round(span / step) + 1 }, (_, index) => max - index * step);

  // Only the extremes: with twelve months and three series there are 36 values,
  // and a column of 36 labels is not an axis. The largest and, when the data
  // goes below the line, the smallest are the two the ruler cannot express.
  const valueTicks = [
    ...(dataMax > 0 ? [dataMax] : []),
    ...(dataMin < 0 ? [dataMin] : []),
  ];
  // Zero is structural and always stays. A reference line that would print its
  // own label on top of a real one is the one that gives way — the ruler can
  // afford a missing rung, the real figure cannot.
  const ticks = reference.filter(
    (tick) => tick === 0 || valueTicks.every((value) => Math.abs(tick - value) > step * 0.34),
  );

  return { min, max, step, ticks, valueTicks };
}
