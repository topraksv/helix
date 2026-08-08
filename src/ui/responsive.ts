/** Measurable capability breakpoints kept outside React for regression tests. */

const NARROW_ACTION_STACK_WIDTH = 430;
const COMPACT_CHART_WIDTH = 390;
const NARROW_ANALYTICS_WIDTH = 520;
const WIDE_IMPORT_GUIDE_WIDTH = 820;
const WIDE_WORKSPACE_WIDTH = 900;

/**
 * The one desktop threshold. Above it the viewport is pointer-sized and a page
 * keeps a real margin instead of the tight gutter a phone needs to earn its
 * width back.
 *
 * A tablet in portrait belongs on the desktop side of it: paired columns and a
 * real margin are what the device is for. It is a pointer-or-two-hand device,
 * not a big phone.
 *
 * Navigation does NOT change here. A side rail was built at this threshold and
 * removed by the owner — it took a column out of the window and made the app
 * teach two navigations. One bottom bar, every width.
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

/**
 * How wide a ledger cell has to be before an amount can be read in it.
 *
 * This was sixty-five lines of arithmetic inside the ledger screen's render,
 * which meant the one rule that decides whether `₺868.952,23` is legible could
 * only be checked by opening the app. It is a pure function of four measured
 * facts, so it belongs where a test can reach it.
 *
 * The two glyph constants are measured, not guessed: tabular figures at 11px
 * cap at ~6.2px of advance and at 13px at ~7.2px. `headerChars` is bounded by
 * the caller, because a user-authored column name may be a paragraph.
 */
export function ledgerCellWidth(input: {
  /** Space the columns share: the content column minus the label rail. */
  gridWidth: number;
  /** Longest formatted amount the table will draw, in characters. */
  valueChars: number;
  /** Longest column heading, in characters. */
  headerChars: number;
  /** How many columns exist at all — never fit more cells than there are. */
  columnCount: number;
  /** Phone and tablet density, where headers may wrap and cells may not. */
  compact: boolean;
}): number {
  const { gridWidth, valueChars, headerChars, columnCount, compact } = input;
  // A financial figure never wraps and never clips, so the amount sets the
  // floor whatever else wants the space.
  const valueSafe = compact
    ? Math.ceil(valueChars * 6.2 + 8)
    : Math.ceil(valueChars * 7.2 + 16);
  // Header markers reserve 48px between them; ordinary names get one or two
  // balanced lines and longer ones wrap and grow the shared header height.
  const headerSafe = Math.min(168, Math.max(112, Math.ceil(headerChars * 5.8 + 48)));
  const natural = compact ? Math.max(70, valueSafe) : Math.max(112, valueSafe, headerSafe);
  const body = Math.max(1, gridWidth);
  // Complete columns only: a clipped half-header at the right edge signalled
  // scrolling and looked broken.
  const wholeCount = columnCount > 0
    ? Math.min(columnCount, Math.max(1, Math.floor(body / natural)))
    : 1;
  const fitted = Math.floor(body / wholeCount);
  return Math.max(natural, Math.min(compact ? 144 : 320, fitted));
}

/**
 * A compact chip and the gap after it, measured in the browser at 390pt: the
 * widest two-digit day rendered 38px and the row's gap is 6.
 */
const CHIP_SLOT = 44;

/**
 * How many quick days a month-day row can offer on one line.
 *
 * A paired field inside a card on a phone gets about 155px, which is three
 * days, not six. Every day is still typeable in the field below, so thinning
 * the shortcuts costs nothing but a tap — and a row that wraps costs a whole
 * control height, which is what shifted the field under it.
 */
export function fittedQuickDays<T>(boxWidth: number, days: readonly T[]): T[] {
  if (boxWidth <= 0 || days.length === 0) return [...days];
  const fits = Math.max(1, Math.floor(boxWidth / CHIP_SLOT));
  if (fits >= days.length) return [...days];
  // Keep the ends and thin the middle, so the row still spans the month.
  const step = (days.length - 1) / (fits - 1 || 1);
  const kept = new Set<number>();
  for (let i = 0; i < fits; i += 1) kept.add(Math.round(i * step));
  return days.filter((_, index) => kept.has(index));
}

/** How much of a tab's column must stay clear for its label to count as fitting. */
const LABEL_BREATHING = 8;

/**
 * Whether the bar should draw its labels at all.
 *
 * Exported because it is the whole rule, and a rule this cheap to get wrong
 * deserves a test rather than a device. Both zeroes mean "not measured yet",
 * which has to read as fits: the labels must render at least once or they can
 * never be measured, and a bar that starts icon-only would stay icon-only.
 */
/** A width the column provably cannot hold, for a label that wrapped. */
export function tooWide(slotWidth: number): number {
  return slotWidth + LABEL_BREATHING + 1;
}

export function tabLabelsFit(labelWidth: number, slotWidth: number): boolean {
  if (labelWidth <= 0 || slotWidth <= 0) return true;
  return labelWidth <= slotWidth - LABEL_BREATHING;
}
