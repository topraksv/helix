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
} from "../../src/domain/matrix-colors";
import { tr } from "../../src/i18n/tr";


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

describe("the tokens it ships", () => {
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
