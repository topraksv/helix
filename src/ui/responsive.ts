/** Measurable capability breakpoints kept outside React for regression tests. */

const NARROW_ACTION_STACK_WIDTH = 430;
const COMPACT_CHART_WIDTH = 390;
const NARROW_ANALYTICS_WIDTH = 520;
const WIDE_IMPORT_GUIDE_WIDTH = 820;
const WIDE_WORKSPACE_WIDTH = 900;

/**
 * The one desktop threshold. Above it the viewport is pointer-sized: navigation
 * stops being a thumb-reachable bar at the bottom of a held device and becomes a
 * rail beside the content, and a page keeps a real margin instead of the tight
 * gutter a phone needs to earn its width back.
 *
 * Both facts change together on purpose — two thresholds a few pixels apart is
 * how a layout starts looking accidental.
 */
const DESKTOP_WIDTH = 1024;

export function shouldUseSideNavigation(viewportWidth: number): boolean {
  return viewportWidth >= DESKTOP_WIDTH;
}

export function shouldUseWideGutter(viewportWidth: number): boolean {
  return viewportWidth >= DESKTOP_WIDTH;
}

/**
 * Where a control stops taking its container and starts taking only what it
 * needs.
 *
 * On a phone the container IS the natural bound — a segmented control that fills
 * the column is the convention, and capping it there just leaves a ragged edge
 * beside it. Past this width the container stops being a bound at all (a
 * two-way choice was spanning 1090 px), so the control has to carry its own.
 */
const INTRINSIC_CONTROL_WIDTH = 600;

export function shouldBoundIntrinsicControls(viewportWidth: number): boolean {
  return viewportWidth >= INTRINSIC_CONTROL_WIDTH;
}

export function shouldStackListActions(viewportWidth: number): boolean {
  return viewportWidth < NARROW_ACTION_STACK_WIDTH;
}

export function shouldUseCompactChart(viewportWidth: number): boolean {
  return viewportWidth < COMPACT_CHART_WIDTH;
}

export function shouldUseNarrowAnalytics(viewportWidth: number): boolean {
  return viewportWidth < NARROW_ANALYTICS_WIDTH;
}

export function shouldUseWideImportGuide(viewportWidth: number): boolean {
  return viewportWidth >= WIDE_IMPORT_GUIDE_WIDTH;
}

export function shouldUseWideWorkspace(viewportWidth: number): boolean {
  return viewportWidth >= WIDE_WORKSPACE_WIDTH;
}
