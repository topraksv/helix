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
  isMatrixColorToken,
  isValidColorTarget,
  matrixColorLabel,
  normalizeMatrixColorToken,
  parseMatrixColorLabels,
  resolveCellToken,
  withMatrixColorLabel,
  MATRIX_COLOR_LABEL_MAX,
  MATRIX_COLOR_TOKENS,
  type MatrixColorLike,
} from "../src/domain/matrix-colors";
import { matrixColorStyle, PALETTES } from "../src/ui/theme";
import { tr } from "../src/i18n/tr";


/**
 * The colour arithmetic these marks are chosen by.
 *
 * Local rather than shared: `theme-contrast.test.ts` measures the palette's own
 * tokens and this measures what a marked CELL renders as, which is the token
 * composited onto the surface underneath it.
 */
const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) =>
  channels(hex).map(linear).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** An `#rrggbbaa` fill composited onto the opaque surface behind it. */
function over(fill: string, surface: string): string {
  const alpha = fill.length === 9 ? Number.parseInt(fill.slice(7, 9), 16) / 255 : 1;
  const [fr, fg, fb] = channels(fill);
  const [sr, sg, sb] = channels(surface);
  return `#${[[fr, sr], [fg, sg], [fb, sb]]
    .map(([front, back]) => Math.round(alpha * front! + (1 - alpha) * back!).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** CIE76 ΔE — enough to say whether two washes read as two colours. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = channels(hex).map(linear) as [number, number, number];
    const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as const;
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const mark = (overrides: Partial<MatrixColorLike>): MatrixColorLike => ({
  id: "c1",
  scope: "cell",
  itemKey: "cat-1",
  month: "2026-08",
  token: "orange",
  ...overrides,
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
});

describe("which colour a cell shows", () => {
  /**
   * Specificity, not recency. If a later column mark won, colouring a month
   * would silently hide a cell someone had singled out — the mark is still
   * stored, it just stops showing, which is invisible and unfixable.
   */
  it("prefers the cell's own mark over its column, and its column over its row", () => {
    const index = buildColorIndex([
      mark({ id: "row", scope: "row", itemKey: "cat-1", month: null, token: "yellow" }),
      mark({ id: "col", scope: "column", itemKey: null, month: "2026-08", token: "green" }),
      mark({ id: "cell", scope: "cell", itemKey: "cat-1", month: "2026-08", token: "red" }),
    ]);
    expect(resolveCellToken(index, "cat-1", "2026-08")).toBe("red");
    // Same row, another month: the column mark no longer applies.
    expect(resolveCellToken(index, "cat-1", "2026-09")).toBe("yellow");
    // Same column, another row: the row mark no longer applies.
    expect(resolveCellToken(index, "cat-2", "2026-08")).toBe("green");
    expect(resolveCellToken(index, "cat-2", "2026-09")).toBeNull();
  });

  /**
   * A mark outlives the vocabulary it was written in.
   *
   * Rows already in the ledger, rows arriving from a device that has not
   * updated, and rows inside an older backup all still carry the five
   * meaning-named slots. Dropping them would silently unmark cells the owner
   * marked, which is invisible — the mark is simply gone.
   */
  it("still shows a mark written under the retired vocabulary", () => {
    const index = buildColorIndex([
      mark({ id: "a", scope: "cell", itemKey: "cat-1", month: "2026-08", token: "critical" }),
      mark({ id: "b", scope: "cell", itemKey: "cat-2", month: "2026-08", token: "warning" }),
      mark({ id: "c", scope: "cell", itemKey: "cat-3", month: "2026-08", token: "neutral" }),
      mark({ id: "d", scope: "cell", itemKey: "cat-4", month: "2026-08", token: "info" }),
      mark({ id: "e", scope: "cell", itemKey: "cat-5", month: "2026-08", token: "success" }),
    ]);
    expect(resolveCellToken(index, "cat-1", "2026-08")).toBe("red");
    expect(resolveCellToken(index, "cat-2", "2026-08")).toBe("orange");
    expect(resolveCellToken(index, "cat-3", "2026-08")).toBe("yellow");
    expect(resolveCellToken(index, "cat-4", "2026-08")).toBe("yellow");
    expect(resolveCellToken(index, "cat-5", "2026-08")).toBe("green");
  });

  /** Reading is forgiving, writing is not: the two vocabularies never mix in
   *  fresh data because only the current one passes the write guard. */
  it("reads a retired slot but refuses to store one", () => {
    for (const legacy of ["critical", "warning", "neutral", "info", "success"]) {
      expect(normalizeMatrixColorToken(legacy)).not.toBeNull();
      expect(isMatrixColorToken(legacy)).toBe(false);
    }
    for (const unknown of ["chartreuse", "", null, 7, {}]) {
      expect(normalizeMatrixColorToken(unknown)).toBeNull();
    }
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
   * a wash. This used to be asserted as an alpha ceiling, which is a proxy for
   * the real property and was wrong in both directions: it allowed four hues
   * that measured 2.7 ΔE apart — a difference nobody can act on across a table
   * of numbers, and the "renkler stabil değil" the owner reported — while
   * forbidding the strength that fixes it. Both halves of the actual
   * requirement are measured here instead.
   */
  it("keeps the figure on a marked cell readable in every palette", () => {
    for (const [id, { light, dark }] of Object.entries(PALETTES)) {
      for (const [palette, scheme] of [[light, "light"], [dark, "dark"]] as const) {
        for (const token of MATRIX_COLOR_TOKENS) {
          const cell = over(matrixColorStyle(palette, token).fill, palette.surface);
          expect(
            contrastRatio(palette.text, cell),
            `${id}/${scheme}/${token}: figure on marked cell`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  /**
   * Four marks are four signals or they are decoration.
   *
   * ΔE 5 is where two large areas of colour stop reading as two shades of one
   * thing. The pair that has to clear it is every pair, not just the adjacent
   * ones: a table shows all four at once, several rows apart.
   */
  it("keeps every pair of marks distinguishable, and each one from the bare cell", () => {
    for (const [id, { light, dark }] of Object.entries(PALETTES)) {
      for (const [palette, scheme] of [[light, "light"], [dark, "dark"]] as const) {
        const fills = MATRIX_COLOR_TOKENS.map((token) => ({
          token,
          color: over(matrixColorStyle(palette, token).fill, palette.surface),
        }));
        for (const { token, color } of fills) {
          expect(
            deltaE(color, palette.surface),
            `${id}/${scheme}/${token}: mark against an unmarked cell`,
          ).toBeGreaterThanOrEqual(5);
        }
        for (let a = 0; a < fills.length; a += 1) {
          for (let b = a + 1; b < fills.length; b += 1) {
            expect(
              deltaE(fills[a]!.color, fills[b]!.color),
              `${id}/${scheme}: ${fills[a]!.token} vs ${fills[b]!.token}`,
            ).toBeGreaterThanOrEqual(5);
          }
        }
      }
    }
  });

  /**
   * The tick drawn ON a mark is a graphical object, not text: WCAG 1.4.11 asks
   * for 3:1. It is stated rather than left implicit because the obvious 4.5
   * would force the shared semantic ink tokens off their own values for a
   * glyph that is not text.
   */
  it("keeps the selected tick visible on the mark it sits on", () => {
    for (const [id, { light, dark }] of Object.entries(PALETTES)) {
      for (const [palette, scheme] of [[light, "light"], [dark, "dark"]] as const) {
        for (const token of MATRIX_COLOR_TOKENS) {
          const { fill, ink } = matrixColorStyle(palette, token);
          expect(
            contrastRatio(ink, over(fill, palette.surface)),
            `${id}/${scheme}/${token}: tick on its own mark`,
          ).toBeGreaterThanOrEqual(3);
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

/**
 * The names are the owner's, and they belong to the COLOUR rather than to
 * anything marked with it.
 *
 * That is the whole design: renaming yellow has to rename every cell already
 * marked yellow, on every device, which is only true while the names live in
 * one account-wide setting. A per-mark name would make the same colour mean
 * five things in one table.
 */
describe("what the owner calls each mark", () => {
  it("falls back to the shipped default until a slot is renamed", () => {
    const defaults = { red: "Ödenmedi", orange: "Gecikti", yellow: "Kontrol edilmeli", green: "Ödendi" } as const;
    expect(matrixColorLabel("red", null, defaults)).toBe("Ödenmedi");
    expect(matrixColorLabel("red", {}, defaults)).toBe("Ödenmedi");
    expect(matrixColorLabel("red", { red: "Bankaya sorulacak" }, defaults)).toBe("Bankaya sorulacak");
    // A slot renamed to whitespace is not a name; it is the default again.
    expect(matrixColorLabel("red", { red: "   " }, defaults)).toBe("Ödenmedi");
    // Renaming one slot never disturbs the three beside it.
    expect(matrixColorLabel("green", { red: "Bankaya sorulacak" }, defaults)).toBe("Ödendi");
  });

  it("clears a slot back to its default rather than storing an empty name", () => {
    expect(withMatrixColorLabel(null, "red", "Bekliyor")).toEqual({ red: "Bekliyor" });
    expect(withMatrixColorLabel({ red: "Bekliyor" }, "red", "  ")).toEqual({});
    expect(withMatrixColorLabel({ red: "Bekliyor", green: "Tamam" }, "red", "")).toEqual({ green: "Tamam" });
    // Trimmed, then bounded — a name is drawn beside a swatch and spoken in
    // every marked cell's label.
    expect(withMatrixColorLabel(null, "red", "x".repeat(80)).red).toHaveLength(MATRIX_COLOR_LABEL_MAX);
    expect(withMatrixColorLabel(null, "red", "  Bekliyor  ")).toEqual({ red: "Bekliyor" });
  });

  /**
   * The map is synced and restored, so it arrives from other devices and from
   * backups. One unusable entry drops; the map survives — losing a single
   * renamed slot is recoverable and losing all four is not.
   */
  it("keeps what it can from a map it did not write", () => {
    expect(parseMatrixColorLabels({ red: "Bekliyor", purple: "Nope", green: 7, yellow: "x".repeat(80) }))
      .toEqual({ red: "Bekliyor" });
    expect(parseMatrixColorLabels({})).toEqual({});
    for (const invalid of [null, undefined, "red", 7, ["red"]]) {
      expect(parseMatrixColorLabels(invalid), String(invalid)).toBeNull();
    }
  });

  it("names every shipped slot, so no colour can render nameless", () => {
    for (const token of MATRIX_COLOR_TOKENS) {
      expect(tr.matrixColor.token[token], token).toBeTruthy();
    }
    expect(Object.keys(tr.matrixColor.token).sort()).toEqual([...MATRIX_COLOR_TOKENS].sort());
  });
});
