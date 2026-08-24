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

/**
 * How much of a tab's column must stay clear for its label to count as fitting.
 *
 * 6px, not 8. The rule never actually fired until the measurement behind it
 * was fixed, so the constant had never been tested against a real bar; on the
 * first run that it did fire, 8 dropped the labels at 360px as well as at 320.
 * Measured on the shipped export: at 360 the widest label ("Abonelikler", 60px)
 * leaves 9-11px between adjacent words — tight but plainly separate — and at
 * 320 it leaves 1px and 3px, which reads as one run of text. Six is the
 * boundary between those two, so the labels go only where they were broken.
 */
const LABEL_BREATHING = 6;

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

// ---------------------------------------------------------------------------
// Layout-mode thresholds
//
// Every width that changes a layout MODE lives here, named for what the width
// buys rather than for the number. Written inline they became rules nobody
// could find: `contentWidth >= 720` appeared in three files deciding three
// different questions, and the two table headers each carried their own copy
// of the cell-density constant that has to agree between them.
//
// Character budgets and measured glyph arithmetic stay with the component that
// measures them; this file owns decisions of the form "at this width the
// surface becomes a different layout".
// ---------------------------------------------------------------------------

/**
 * Where a tile grid stops fitting two across and fits three.
 *
 * A tile has to hold an icon, a Turkish label and its own 12px inset; measured,
 * three of them need about 240px each before the labels start wrapping to a
 * second line and the grid's rows stop being one height.
 */
const TRIPLE_TILE_GRID_WIDTH = 720;

export function shouldUseTripleTileGrid(contentWidth: number): boolean {
  return contentWidth >= TRIPLE_TILE_GRID_WIDTH;
}

/**
 * Whether a multi-month trend line is offered at all.
 *
 * It used to be 720 — desktop only — because a trend needs one readable x-tick
 * per month and twelve of them collide on a phone. That was true of the caller,
 * not of the chart: `Lines` thins its own x labels to at most six and has done
 * since it was written, so a twelve-month trend on a 390pt phone prints every
 * other month about 50px apart at a 10pt face. What the chart genuinely cannot
 * survive is the y-axis gutter eating the plot, which is what this floor now
 * guards: below about 280 the 54px gutter and the 12px right margin leave less
 * than 220px for the line itself.
 *
 * The owner asked for the trend on the phone. This is the width at which it is
 * still worth reading.
 */
const TREND_CHART_WIDTH = 280;

export function shouldOfferTrendChart(contentWidth: number): boolean {
  return contentWidth >= TREND_CHART_WIDTH;
}

/**
 * The month distribution ring's ceiling class.
 *
 * `Donut` fits whatever box it is given; this only chooses which ceiling it is
 * fitted against, so a ring that owns a whole desktop row is not a small
 * picture in a large frame.
 */
const LARGE_DONUT_WIDTH = 900;

export function shouldUseLargeDonut(contentWidth: number): boolean {
  return contentWidth >= LARGE_DONUT_WIDTH;
}

/**
 * How many market tiles share one row.
 *
 * Measured against the CARD's width, never the window: two columns of a 358px
 * phone card and two columns of a 500px desktop column are different tiles,
 * and the window says nothing about either.
 */
const MARKET_GRID_WIDE_WIDTH = 620;
const MARKET_GRID_PAIR_WIDTH = 300;

export function marketTileColumns(cardWidth: number, wideColumns: number): number {
  if (cardWidth >= MARKET_GRID_WIDE_WIDTH) return wideColumns;
  return cardWidth >= MARKET_GRID_PAIR_WIDTH ? 2 : 1;
}

/**
 * Whether the financial table's supplementary details start expanded.
 *
 * A remembered preference overrides this; it is only the first answer on a
 * viewport that has never been asked. Wide enough to show the details beside
 * the table rather than pushing it a screen down.
 */
const TABLE_DETAILS_OPEN_WIDTH = 600;

export function shouldStartTableDetailsOpen(viewportWidth: number): boolean {
  return viewportWidth >= TABLE_DETAILS_OPEN_WIDTH;
}

/** Where the investments empty-state hero earns its taller frame. */
const TALL_INVESTMENT_HERO_WIDTH = 760;

export function shouldUseTallInvestmentHero(viewportWidth: number): boolean {
  return viewportWidth >= TALL_INVESTMENT_HERO_WIDTH;
}

/** Where sign-in puts its brand panel beside the form instead of above it. */
const SPLIT_AUTH_HERO_WIDTH = 820;

export function shouldSplitAuthHero(viewportWidth: number): boolean {
  return viewportWidth >= SPLIT_AUTH_HERO_WIDTH;
}

/**
 * Where an options list is a sheet pulled off the bottom edge rather than a
 * dialog in the middle of the window.
 *
 * The thumb reaches the bottom of a phone and the middle of nothing; a pointer
 * reaches the middle of the window and has no bottom edge to speak of.
 */
const OPTION_SHEET_WIDTH = 640;

export function shouldPresentOptionsAsSheet(viewportWidth: number): boolean {
  return viewportWidth < OPTION_SHEET_WIDTH;
}

/**
 * Where a panel header's trailing cluster drops below its title.
 *
 * A status chip beside a two-word Turkish title runs out of room before any
 * other pairing in the app does, so this sits well below every other threshold.
 */
const PANEL_ACTION_STACK_WIDTH = 360;

export function shouldStackPanelAction(viewportWidth: number): boolean {
  return viewportWidth < PANEL_ACTION_STACK_WIDTH;
}

/**
 * Where an operation's calculation summary can sit beside its form rather than
 * under it. It was written inline in `investments/operation.tsx` as a bare
 * `>= 560` — the one threshold in the app that was neither in this file nor a
 * copy of something that was.
 */
const PAIRED_OPERATION_SUMMARY_WIDTH = 560;

export function shouldPairOperationSummary(contentWidth: number): boolean {
  return contentWidth >= PAIRED_OPERATION_SUMMARY_WIDTH;
}

/** Where chart axis labels can afford the larger of the two type sizes. */
const LARGE_AXIS_TYPE_WIDTH = 480;

export function shouldUseLargeAxisType(chartWidth: number): boolean {
  return chartWidth >= LARGE_AXIS_TYPE_WIDTH;
}

/** Where the navigation bar's material stops needing its compact treatment. */
const COMPACT_NAV_MATERIAL_WIDTH = 600;

export function shouldUseCompactNavigationMaterial(viewportWidth: number): boolean {
  return viewportWidth < COMPACT_NAV_MATERIAL_WIDTH;
}

/**
 * Whether a mobile browser's visual viewport can be shrunk by a keyboard.
 *
 * Coarse pointers cover phones and tablets; the width is the fallback for
 * mobile emulation, where pointer capability is not faithfully reported.
 */
const MOBILE_VIEWPORT_WIDTH = 768;

export function isMobileViewportWidth(viewportWidth: number): boolean {
  return viewportWidth < MOBILE_VIEWPORT_WIDTH;
}

/**
 * Where a financial table's cell stops holding a full-size header.
 *
 * Both header rails read this — the scrolling one and the pinned one — and the
 * whole point of pinning is that a column does not change when it moves, so
 * the two cannot be allowed to carry separate copies of the number.
 */
const COMPACT_TABLE_CELL_WIDTH = 104;

export function isCompactTableCell(cellWidth: number): boolean {
  return cellWidth < COMPACT_TABLE_CELL_WIDTH;
}

/**
 * Whether the ledger's column controls are being driven by a finger.
 *
 * The pin that fixes a column measured 24x53: over WCAG 2.5.8's floor, fine
 * under a mouse, and well under the 44pt a thumb is given — on a control that
 * also ships to phones. It cannot simply grow to 44, because the strip sits
 * inside a ~134px financial column next to that column's own label and would
 * cost a visible month. So it grows only where the pointer is coarse: every
 * native build, and the compact table a phone browser gets.
 *
 * `isWeb` is a parameter rather than a `Platform` read so this stays a pure
 * function a test can hold, like every other threshold in this file.
 */
export function usesCoarsePointerTable(cellWidth: number, isWeb: boolean): boolean {
  return !isWeb || isCompactTableCell(cellWidth);
}

/**
 * How many characters of a table label fit on one soft-wrapped line.
 *
 * Two shapes, because the two rails ask different questions. A column header
 * has three densities — a phone's narrowest cell, a compact cell and a full
 * one. A row label has two: it either has the rail's full width or it does not.
 * Both were written inline three times over, in the two header renderers and
 * the row renderer, so a change to one silently disagreed with the others.
 */
const NARROW_TABLE_LABEL_WIDTH = 80;

export function tableLabelCharBudget(width: number, { twoStep = false } = {}): number {
  if (width < NARROW_TABLE_LABEL_WIDTH) return 8;
  if (twoStep) return 12;
  return isCompactTableCell(width) ? 10 : 12;
}

/**
 * The investments hero's two composition steps, measured on the CARD's own box
 * rather than on the page column.
 *
 * Reading the column was fine at 100% zoom and wrong everywhere else: at 175%
 * the same 1920 monitor reports 1097 CSS px, the layout picked its widest
 * arrangement, and a 204px ring sat in a column that no longer had room for it
 * beside the balance.
 */
const COMPACT_INVESTMENT_HERO_WIDTH = 520;
const DESKTOP_INVESTMENT_HERO_WIDTH = 860;

export function shouldUseCompactInvestmentHero(heroBoxWidth: number): boolean {
  return heroBoxWidth < COMPACT_INVESTMENT_HERO_WIDTH;
}

export function shouldUseDesktopInvestmentHero(heroBoxWidth: number): boolean {
  return heroBoxWidth >= DESKTOP_INVESTMENT_HERO_WIDTH;
}
