import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fittedCellWidth, shouldPairByMass } from "../src/ui/responsive";
import { biometricName } from "../src/ui/biometric-name";
import { tr } from "../src/i18n/tr";
import { balanceDeclarationDrift, parseBalanceDeclaration } from "../src/domain/balance-declaration";

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
 * One hard-coded "Face ID Kilidi" shipped to Android too, naming a technology
 * that phone does not have — on a security control.
 */
describe("the biometric lock is named after the device's own sensor", () => {
  it("never offers Face ID as a name on Android", () => {
    const android = [
      biometricName({ ios: false, facial: false, fingerprint: true }),
      biometricName({ ios: false, facial: true, fingerprint: false }),
      biometricName({ ios: false, facial: true, fingerprint: true }),
      biometricName({ ios: false, facial: false, fingerprint: false }),
    ];
    for (const label of android) expect(label).not.toContain("Face ID");
    expect(android[0]).toBe(tr.settings.biometricFingerprint);
    expect(android[1]).toBe(tr.settings.biometricFace);
  });

  it("keeps the Apple names on Apple hardware", () => {
    expect(biometricName({ ios: true, facial: true, fingerprint: false })).toBe(tr.settings.biometricFaceId);
    expect(biometricName({ ios: true, facial: false, fingerprint: true })).toBe(tr.settings.biometricTouchId);
  });

  it("falls back to a neutral name when the sensor list says nothing", () => {
    expect(biometricName({ ios: false, facial: false, fingerprint: false })).toBe(tr.settings.biometric);
    expect(tr.settings.biometric).not.toContain("Face ID");
  });

  it("keeps the settings row on the resolved label, not the constant", () => {
    const settings = readFileSync(join(root, "src/app/(tabs)/settings/index.tsx"), "utf8");
    expect(settings).toContain("title={biometricLabel}");
    expect(settings).not.toContain("title={tr.settings.biometric}");
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
    dashboard.indexOf("{projectedDelta != null && projectedDelta >= 0 ?"),
    dashboard.indexOf("<View style={{ flex: 1, gap: 2, minWidth: 0 }}>"),
  );

  it("draws the direction with the glyph, in a neutral colour", () => {
    expect(arrow).toContain("<TrendingUp size={18} color={palette.textSecondary} />");
    expect(arrow).toContain("<TrendingDown size={18} color={palette.textSecondary} />");
    // The red/green vocabulary belongs to the amount below, which reads the
    // sign of the money. The arrow must not compete for it.
    expect(arrow).not.toContain("palette.positiveText");
    expect(arrow).not.toContain("palette.negativeText");
  });

  it("says the direction in words so the glyph is not the only carrier", () => {
    expect(dashboard).toContain("tr.dashboard.forecastRising");
    expect(dashboard).toContain("tr.dashboard.forecastFalling");
  });
});

/**
 * A horizontally scrolled financial grid must never rest on a half-covered
 * cell: the sticky label column hides the left part of an amount and what is
 * left reads as a smaller but perfectly valid figure — `₺14.500,00` became
 * `4.500,00` whenever the focus scroll hit the far-end clamp.
 */
describe("the ledger never rests between columns", () => {
  const table = readFileSync(join(root, "src/ui/sticky-table.tsx"), "utf8");

  it("shows a whole number of cells and reaches the end on that grid", () => {
    expect(table).toContain("const visibleCells =");
    expect(table).toContain("const trailingSpacer =");
    expect(table).toContain("const maxScrollX =");
    expect(table).toContain("Math.min(Math.round(centered / cellWidth) * cellWidth, maxScrollX)");
  });

  it("snaps a dragged scroll to the same grid", () => {
    expect(table).toContain("snapToInterval={cellWidth}");
    expect(table).toContain('snapToAlignment="start"');
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
    expect(table).toContain("fittedCellWidth(Math.max(0, tableW - headWidth), requestedCellWidth)");
    // The body measurement may only reach scroll geometry.
    const fit = table.slice(table.indexOf("const cellWidth ="), table.indexOf("useWebInteractions"));
    expect(fit).not.toContain("bodyW");
  });

  it("has no fixed point when the pinned column is subtracted first", () => {
    // Why the input contract above matters, stated as arithmetic rather than as
    // a claim. Feeding the body — the grid minus the cell a pinned column takes
    // — makes the answer an input to itself, and for most phone widths the two
    // answers never agree, so the columns resize on every frame.
    let unstable = 0;
    for (let tableWidth = 320; tableWidth <= 440; tableWidth += 1) {
      const grid = tableWidth - 112;
      const requested = 82;
      const settled = fittedCellWidth(grid, requested);
      if (fittedCellWidth(grid - settled, requested) !== settled) unstable += 1;
    }
    expect(unstable).toBeGreaterThan(0);
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
 * The balance the user last confirmed against a real account, and whether the
 * ledger still agrees. Reconciling writes an adjustment so the table lands on
 * the declared figure, and from that instant the app used to have no memory of
 * what was actually checked.
 */
describe("a declared balance can be compared with the ledger later", () => {
  it("reads back only a well-formed declaration", () => {
    expect(parseBalanceDeclaration({ minor: 2_000_000, at: "2026-08-04" })).toEqual({ minor: 2_000_000, at: "2026-08-04" });
    expect(parseBalanceDeclaration(null)).toBeNull();
    expect(parseBalanceDeclaration({ minor: 10 })).toBeNull();
    expect(parseBalanceDeclaration({ at: "2026-08-04" })).toBeNull();
    expect(parseBalanceDeclaration({ minor: Number.NaN, at: "2026-08-04" })).toBeNull();
    expect(parseBalanceDeclaration({ minor: 10, at: "" })).toBeNull();
  });

  it("reports the drift, and says nothing when there is none", () => {
    const declared = { minor: 2_000_000, at: "2026-08-04" };
    expect(balanceDeclarationDrift(declared, 3_000_000)).toBe(1_000_000);
    expect(balanceDeclarationDrift(declared, 1_000_000)).toBe(-1_000_000);
    expect(balanceDeclarationDrift(declared, 2_000_000)).toBeNull();
    expect(balanceDeclarationDrift(null, 3_000_000)).toBeNull();
    expect(balanceDeclarationDrift(declared, null)).toBeNull();
  });

  it("is written when a balance is confirmed, and read where it matters", () => {
    const editor = readFileSync(join(root, "src/ui/opening-balance-editor.tsx"), "utf8");
    expect(editor).toContain("setBalanceDeclaration(userId, effectiveTarget, todayISO())");
    for (const path of ["src/app/(tabs)/index.tsx", "src/app/(tabs)/cash-flow/index.tsx"]) {
      expect(readFileSync(join(root, path), "utf8")).toContain("balanceDeclarationDrift(");
    }
  });
});
