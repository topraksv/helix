import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldPairByMass } from "../src/ui/responsive";
import { biometricName } from "../src/ui/biometric-name";
import { tr } from "../src/i18n/tr";

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
});
