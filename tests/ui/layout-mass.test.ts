import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fittedCellWidth, ledgerCellWidth, shouldPairByMass } from "../../src/ui/responsive";

const root = process.cwd();

/**
 * Two columns are two columns only when both have something in them. On
 * Abonelikler a five-row group sat beside a one-row group, so the right column
 * ended 550px above the left and the page read as half-finished.
 */
describe("paired columns need comparable mass", () => {
  it("pairs groups of similar size", () => {
    expect(shouldPairByMass([5, 4])).toBe(true);
    expect(shouldPairByMass([6, 2])).toBe(true);
    expect(shouldPairByMass([3, 3, 2])).toBe(true);
  });

  it("keeps the stream when one column would be a hole", () => {
    expect(shouldPairByMass([5, 1])).toBe(false);
    expect(shouldPairByMass([12, 3, 1])).toBe(false);
  });

  it("never pairs a single group with itself", () => {
    expect(shouldPairByMass([5])).toBe(false);
    expect(shouldPairByMass([5, 0])).toBe(false);
    expect(shouldPairByMass([])).toBe(false);
  });

  it("is the rule the subscriptions screen actually passes its groups to", () => {
    const screen = readFileSync(join(root, "src/app/(tabs)/subscriptions.tsx"), "utf8");
    expect(screen).toContain("masses={[active.length, watched.length, passive.length]}");
  });
});

/**
 * The forecast row paints two things: an arrow for the direction of change and
 * an amount for the projected balance. When the arrow took the delta's colour
 * and the amount took its own sign, a falling-but-positive forecast rendered a
 * red arrow beside a green number — one row, two contradictory readings, in the
 * single vocabulary this app reserves for the sign of money.
 */
describe("the month-end forecast carries one colour meaning", () => {
  const dashboard = readFileSync(join(root, "src/app/(tabs)/index.tsx"), "utf8");
  const arrow = dashboard.slice(
    dashboard.indexOf("function ForecastToggle("),
    dashboard.indexOf("<View style={{ flex: 1, gap: 2, minWidth: 0 }}>"),
  );

  it("draws the direction with the glyph, in a neutral colour", () => {
    // The invariant is the COLOUR and the pair of glyphs, not how the size is
    // spelled — pinning `size={18}` made moving the literal onto the shared
    // `iconSize` scale read as a regression, which is the same trap the
    // forecast-padding test below already documents.
    for (const glyph of ["<TrendingUp", "<TrendingDown"]) {
      const at = arrow.indexOf(glyph);
      expect(at, `${glyph} must be drawn`).toBeGreaterThanOrEqual(0);
      const tag = arrow.slice(at, arrow.indexOf("/>", at));
      expect(tag, `${glyph} must be neutral`).toContain("color={palette.textSecondary}");
      expect(tag, `${glyph} is decoration beside a label`).toContain("accessible={false}");
    }
    // The red/green vocabulary belongs to the amount below, which reads the
    // sign of the money. The arrow must not compete for it.
    expect(arrow).not.toContain("palette.positiveText");
    expect(arrow).not.toContain("palette.negativeText");
  });

  it("says the direction in words so the glyph is not the only carrier", () => {
    expect(dashboard).toContain("tr.dashboard.forecastRising");
    expect(dashboard).toContain("tr.dashboard.forecastFalling");
  });

  it("gives the forecast hover surface equal air above and below", () => {
    const start = dashboard.indexOf('testID="dashboard-forecast-toggle"');
    const forecast = dashboard.slice(start, dashboard.indexOf("interactionSurface", start));
    // The invariant is symmetry, not a particular number: the phone opens this
    // row up to reach the rule beneath it while the wide layout, where that
    // rule is a vertical divider, keeps its own spacing. Pinning the literal
    // `spacing.md` made a legitimate per-layout value look like a regression.
    //
    // What must never differ is the two sides, so the only way to set padding
    // here is the property that sets both at once. Asserting that catches the
    // asymmetry itself — an attempt to give the amount more room by growing
    // `paddingBottom` alone fails this line.
    expect(forecast).toMatch(/paddingVertical: spacing\.(md|lg)/);
    expect(forecast).not.toMatch(/paddingTop:/);
    expect(forecast).not.toMatch(/paddingBottom:/);
  });

  it("makes the balance-versus-forecast boundary explicit and removes the trailing card gap", () => {
    expect(dashboard).toContain("tr.dashboard.forecastHint");
    expect(dashboard).toContain('<Card style={{ marginBottom: 0 }}>');
  });
});

/**
 * A horizontally scrolled financial grid must not rest on a half-covered cell:
 * the sticky label column hides the left part of an amount and what is left
 * reads as a smaller but perfectly valid figure — `₺14.500,00` became
 * `4.500,00` whenever the focus scroll hit the far-end clamp.
 *
 * Every offset the table CHOOSES is therefore a whole number of cells. The one
 * it does not choose is the far end a person drags to themselves: reaching it
 * used to need a spacer after the last column, and a strip of bare background
 * at the end of every row was the worse of the two readings.
 */
describe("the ledger never rests between columns", () => {
  const table = readFileSync(join(root, "src/ui/sticky-table.tsx"), "utf8");

  it("shows a whole number of cells and focuses one on that grid", () => {
    expect(table).toContain("const visibleCells =");
    expect(table).toContain("const maxScrollX =");
    expect(table).toContain("Math.min(Math.round(centered / cellWidth) * cellWidth, maxScrollX)");
    // No spacer, and no column widened to stand in for one: the columns of a
    // table are equal or they are not columns.
  });

  /**
   * `snapToInterval` is the NATIVE half of the contract, and only the native
   * half: react-native-web's `ScrollView` maps `pagingEnabled` onto
   * `scroll-snap-type` and nothing else, so the prop does nothing at all in a
   * browser (`node_modules/react-native-web/dist/exports/ScrollView/index.js`).
   * Measured before the web half existed: a dragged scroll rested at 722px on
   * an 87px grid. Asserting the prop's presence therefore proves the phone
   * behaviour and NOTHING about the web — the browser half is a settle timer
   * that rounds to the same grid, and `e2e/ui-consistency.spec.ts` drives it
   * against a real render.
   */
  it("snaps a dragged scroll to the same grid on both platforms", () => {
    expect(table).toContain("snapToInterval={cellWidth}");
    expect(table).toContain('snapToAlignment="start"');
    // The web half, which the prop above cannot provide.
    expect(table).toContain("const snapToCell = ()");
    expect(table).toContain("Math.round(bodyNode.scrollLeft / cellWidth) * cellWidth");
    expect(table).toContain("WEB_SCROLL_SETTLE_MS");
  });

  /**
   * Pinning a month must not resize the months beside it.
   *
   * The pinned column is drawn in the fixed left rail, so the scrolling body
   * loses exactly one cell the moment one is pinned. While the cell width was
   * fitted to that body, the width fed the rail, the rail fed the body and the
   * body fed the width again — a loop with no fixed point at most widths. The
   * columns alternated between two sizes for ever, which is what the owner saw
   * as a shake. The fit reads the whole grid now, so pinning cannot move it.
   */
  it("is fed the grid the columns share, never the scrolling body", () => {
    // The body measurement may only reach scroll geometry.
    expect(table).toContain("fittedCellWidth(Math.max(0, tableW - headWidth), requestedCellWidth)");
  });

  it("only corrects by a rounding error, and leaves a real overflow to scroll", () => {
    // 3 x 82 = 246 against a measured 244: two pixels, so the cell is trimmed.
    expect(fittedCellWidth(244, 82)).toBe(81);
    // 3 x 100 = 300 against 273: 27 pixels is a genuine overflow, not rounding.
    expect(fittedCellWidth(273, 100)).toBe(100);
    // Nothing measured yet, and degenerate input, keep the caller's number.
    expect(fittedCellWidth(0, 88)).toBe(88);
    expect(fittedCellWidth(-10, 88)).toBe(88);
  });
});

/**
 * The rule that decides whether an amount can be read in a ledger cell.
 *
 * It used to be sixty-five lines inside the ledger screen's render, so the one
 * thing standing between `₺868.952,23` and a wrapped or clipped figure could
 * only be checked by opening the app at the right width with the right data.
 */
describe("a ledger cell is sized by the widest figure it must hold", () => {
  const base = { gridWidth: 900, valueChars: 8, headerChars: 6, columnCount: 12, compact: false };

  it("never returns less than the measured amount needs", () => {
    for (const valueChars of [0, 4, 8, 12, 16, 20]) {
      for (const compact of [true, false]) {
        const width = ledgerCellWidth({ ...base, valueChars, compact });
        const glyph = compact ? 6.2 : 7.2;
        const inset = compact ? 8 : 16;
        expect(width, `${valueChars} chars, compact=${compact}`).toBeGreaterThanOrEqual(
          Math.ceil(valueChars * glyph + inset),
        );
      }
    }
  });

  it("grows the cell for a longer amount rather than squeezing it", () => {
    const narrow = ledgerCellWidth({ ...base, valueChars: 6, gridWidth: 320, compact: true });
    const wide = ledgerCellWidth({ ...base, valueChars: 18, gridWidth: 320, compact: true });
    expect(wide).toBeGreaterThan(narrow);
  });

  it("fits whole columns and stops at a readable ceiling", () => {
    // One column in a wide workspace must not become a 900px block.
    expect(ledgerCellWidth({ ...base, columnCount: 1, gridWidth: 900 })).toBeLessThanOrEqual(320);
    expect(ledgerCellWidth({ ...base, columnCount: 1, gridWidth: 900, compact: true })).toBeLessThanOrEqual(144);
  });

  it("survives a degenerate width instead of returning zero", () => {
    for (const gridWidth of [0, -50, 1]) {
      expect(ledgerCellWidth({ ...base, gridWidth })).toBeGreaterThan(0);
    }
  });
});
