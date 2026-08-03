/** Deterministic monetary axis geometry shared by the column chart and tests. */

export interface BarAxis {
  min: number;
  max: number;
  step: number;
  ticks: number[];
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
    return { min: -1, max: 1, step: 1, ticks: [1, 0, -1] };
  }
  const range = Math.max(dataMax - dataMin, 1);
  const pad = Math.max(range * 0.08, Math.max(Math.abs(dataMin), Math.abs(dataMax), 1) * 0.01);
  const paddedMin = dataMin < 0 ? dataMin - pad : 0;
  const paddedMax = dataMax > 0 ? dataMax + pad : 0;
  const step = niceStep(paddedMax - paddedMin);
  const min = dataMin < 0 ? Math.floor(paddedMin / step) * step : 0;
  const max = dataMax > 0 ? Math.ceil(paddedMax / step) * step : 0;
  const span = Math.max(step, max - min);
  const ticks = Array.from({ length: Math.round(span / step) + 1 }, (_, index) => max - index * step);

  return { min, max, step, ticks };
}
