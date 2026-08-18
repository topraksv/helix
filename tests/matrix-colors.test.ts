/**
 * Contextual colours on Mali Tablo.
 *
 * Two rules carry the whole feature: a mark names exactly the coordinates its
 * scope needs, and the most specific mark wins. Both live here rather than in
 * a renderer because a restore, a sync merge and the sheet all depend on them.
 */
import { describe, expect, it } from "vitest";
import {
  buildColorIndex,
  colorTargetKey,
  isMatrixColorToken,
  isValidColorTarget,
  resolveCellToken,
  MATRIX_COLOR_TOKENS,
  type MatrixColorLike,
} from "../src/domain/matrix-colors";
import { matrixColorStyle, PALETTES } from "../src/ui/theme";

const mark = (over: Partial<MatrixColorLike>): MatrixColorLike => ({
  id: "c1",
  scope: "cell",
  itemKey: "cat-1",
  month: "2026-08",
  token: "warning",
  ...over,
});

describe("matrix colour targets", () => {
  it("requires exactly the coordinates its scope names", () => {
    expect(isValidColorTarget({ scope: "row", itemKey: "cat-1", month: null })).toBe(true);
    expect(isValidColorTarget({ scope: "column", itemKey: null, month: "2026-08" })).toBe(true);
    expect(isValidColorTarget({ scope: "cell", itemKey: "cat-1", month: "2026-08" })).toBe(true);
  });

  /** A row mark carrying a month is a row another client reads as a cell. */
  it("refuses a shape two client versions would read differently", () => {
    for (const target of [
      { scope: "row", itemKey: "cat-1", month: "2026-08" },
      { scope: "row", itemKey: null, month: null },
      { scope: "column", itemKey: "cat-1", month: "2026-08" },
      { scope: "column", itemKey: null, month: null },
      { scope: "cell", itemKey: "cat-1", month: null },
      { scope: "cell", itemKey: null, month: "2026-08" },
      { scope: "everything", itemKey: "cat-1", month: "2026-08" },
      { scope: "cell", itemKey: "cat-1", month: "2026-13" },
      { scope: "cell", itemKey: "", month: "2026-08" },
      { scope: "cell", itemKey: "x".repeat(121), month: "2026-08" },
    ]) {
      expect(isValidColorTarget(target), JSON.stringify(target)).toBe(false);
    }
  });

  /** Both halves are user-reachable keys, so they cannot share a separator. */
  it("gives colliding coordinates distinct identities", () => {
    expect(colorTargetKey({ scope: "cell", itemKey: "a", month: "b" }))
      .not.toBe(colorTargetKey({ scope: "cell", itemKey: "a\u0000b", month: null }));
  });
});

describe("which colour a cell shows", () => {
  /**
   * Specificity, not recency. If a later column mark won, colouring a month
   * would silently hide a cell someone had singled out — the mark is still
   * stored, it just stops showing, which is invisible and unfixable.
   */
  it("prefers the cell's own mark over its column, and its column over its row", () => {
    const index = buildColorIndex([
      mark({ id: "row", scope: "row", itemKey: "cat-1", month: null, token: "neutral" }),
      mark({ id: "col", scope: "column", itemKey: null, month: "2026-08", token: "info" }),
      mark({ id: "cell", scope: "cell", itemKey: "cat-1", month: "2026-08", token: "critical" }),
    ]);
    expect(resolveCellToken(index, "cat-1", "2026-08")).toBe("critical");
    // Same row, another month: the column mark no longer applies.
    expect(resolveCellToken(index, "cat-1", "2026-09")).toBe("neutral");
    // Same column, another row: the row mark no longer applies.
    expect(resolveCellToken(index, "cat-2", "2026-08")).toBe("info");
    expect(resolveCellToken(index, "cat-2", "2026-09")).toBeNull();
  });

  it("ignores a mark whose token this build does not know", () => {
    const index = buildColorIndex([mark({ token: "chartreuse" as never })]);
    expect(resolveCellToken(index, "cat-1", "2026-08")).toBeNull();
  });

  it("ignores a mark missing the coordinates its scope needs", () => {
    const index = buildColorIndex([
      mark({ scope: "row", itemKey: null, month: null }),
      mark({ scope: "column", itemKey: null, month: null }),
      mark({ scope: "cell", itemKey: "cat-1", month: null }),
    ]);
    expect(resolveCellToken(index, "cat-1", "2026-08")).toBeNull();
  });
});

describe("how a mark is painted", () => {
  it("resolves every token in every shipped palette and scheme", () => {
    for (const [id, { light, dark }] of Object.entries(PALETTES)) {
      for (const [palette, scheme] of [[light, "light"], [dark, "dark"]] as const) {
        for (const token of MATRIX_COLOR_TOKENS) {
          const style = matrixColorStyle(palette, token);
          for (const [role, value] of Object.entries(style)) {
            expect(value, `${id}/${scheme}/${token}/${role}`).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
          }
        }
      }
    }
  });

  /**
   * The fill sits under an amount drawn in ordinary text ink, so it has to stay
   * a wash. A mark that painted a solid block would need its own foreground and
   * would put every marked cell outside the contrast the table was measured at.
   */
  it("keeps every fill faint enough to sit under ordinary text", () => {
    for (const { light, dark } of Object.values(PALETTES)) {
      for (const palette of [light, dark]) {
        for (const token of MATRIX_COLOR_TOKENS) {
          const { fill } = matrixColorStyle(palette, token);
          const alpha = Number.parseInt(fill.slice(7), 16);
          expect(alpha, `${token} fill alpha`).toBeLessThanOrEqual(0x2e);
        }
      }
    }
  });

  it("gives each token a distinct edge so a column can be read at a glance", () => {
    for (const { light, dark } of Object.values(PALETTES)) {
      for (const palette of [light, dark]) {
        const edges = MATRIX_COLOR_TOKENS.map((token) => matrixColorStyle(palette, token).edge);
        expect(new Set(edges).size).toBe(MATRIX_COLOR_TOKENS.length);
      }
    }
  });

  it("accepts only the tokens it ships", () => {
    expect(MATRIX_COLOR_TOKENS.every(isMatrixColorToken)).toBe(true);
    for (const value of ["", "purple", null, 3, {}]) expect(isMatrixColorToken(value)).toBe(false);
  });
});
