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
 *
 * A tablet in portrait belongs on the desktop side of it. It was on the phone
 * side while the rail cost 220px, which a 768px window cannot spare; a compact
 * rail costs 108, and everything a tablet gains from that — a persistent
 * navigation instrument, a real page margin, paired columns — is what the
 * device is for. It is a pointer-or-two-hand device, not a big phone.
 */
const DESKTOP_WIDTH = 768;

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

/**
 * The dashboard's two composition rules, which used to share one hand-written
 * `width >= 960` and therefore arrived together whether or not both fitted.
 *
 * The hero needs room for a balance beside a three-value month strip. The
 * payment list and the market strip need less than that between them, because
 * each side is a short row rather than a figure that must not wrap — so they
 * pair a little earlier, and a tablet in portrait gets both.
 */
const DASHBOARD_HERO_SPLIT_WIDTH = 640;
const DASHBOARD_PANEL_PAIR_WIDTH = 620;

export function shouldSplitDashboardHero(contentWidth: number): boolean {
  return contentWidth >= DASHBOARD_HERO_SPLIT_WIDTH;
}

export function shouldPairDashboardPanels(contentWidth: number): boolean {
  return contentWidth >= DASHBOARD_PANEL_PAIR_WIDTH;
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

/**
 * Where two filter cards stop being a stack and become a row.
 *
 * They waited for the workspace width, so a tablet held in portrait spent its
 * entire first screen on the range picker and the search box — on the screen
 * called Analysis, with no chart in sight. Two cards need about 350px each to
 * keep a six-option period control on one line, so they can pair a long way
 * before a workspace can.
 */
const PAIRED_FILTER_WIDTH = 640;

export function shouldPairFilterCards(contentWidth: number): boolean {
  return contentWidth >= PAIRED_FILTER_WIDTH;
}

/**
 * Two columns are only two columns when both of them have something to say.
 *
 * A five-row group beside a one-row group is not a layout, it is a five-row
 * group with a hole next to it: on Abonelikler the short column ended 550px
 * above the tall one and the page read as half-finished. When the caller can
 * say how much each child weighs, an extreme imbalance keeps the single stream
 * instead of buying a column with dead space.
 */
export function shouldPairByMass(masses: number[]): boolean {
  const present = masses.filter((mass) => mass > 0);
  if (present.length < 2) return false;
  const heaviest = Math.max(...present);
  const lightest = Math.min(...present);
  // Three to one is the point where two columns stop looking like peers.
  return heaviest <= lightest * 3;
}

/** Rounding error a measured grid may differ from its caller's estimate by. */
const CELL_FIT_TOLERANCE = 8;

/**
 * Correct a caller's estimated cell width against the grid that was really
 * measured, but only by a rounding error's worth.
 *
 * `gridWidth` must be the whole area the columns share — the table minus its
 * fixed label rail — and never the scrolling body alone. A pinned column is
 * drawn beside the labels, so the body is exactly one cell narrower whenever
 * one is pinned; a width fitted to the body therefore reads a measurement its
 * own previous answer produced. That recursion has no fixed point for most
 * widths: iterated over the numbers the ledger really computes, 73 of the 121
 * phone widths from 320 to 440 alternate between two cell widths for ever
 * (390 settles, 389 flips 81/82, 425 flips 93/94). Taking the grid instead
 * makes the answer independent of what the answer did.
 */
export function fittedCellWidth(gridWidth: number, requestedWidth: number): number {
  if (gridWidth <= 0 || requestedWidth <= 0) return requestedWidth;
  const cellsAcross = Math.max(1, Math.round(gridWidth / requestedWidth));
  return Math.abs(gridWidth - cellsAcross * requestedWidth) <= CELL_FIT_TOLERANCE
    ? Math.floor(gridWidth / cellsAcross)
    : requestedWidth;
}
