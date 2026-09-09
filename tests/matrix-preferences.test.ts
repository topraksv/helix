import { describe, expect, it } from "vitest";
import { balanceColumnLabel, MAX_BALANCE_COLUMN_LABEL, parseBalanceColumns, resolveMatrixMode } from "../src/domain/matrix-preferences";

describe("Mali Tablo view preference", () => {
  it("starts row-focused until the user chooses another view", () => {
    expect(resolveMatrixMode(null)).toBe("rows");
    expect(resolveMatrixMode("unexpected")).toBe("rows");
  });

  it("restores every explicit supported view", () => {
    expect(resolveMatrixMode("rows")).toBe("rows");
    expect(resolveMatrixMode("columns")).toBe("columns");
    expect(resolveMatrixMode("cards")).toBe("cards");
  });
});

describe("what the owner calls the two balance columns", () => {
  const stored = { openingLabel: "Ay Sonu", closingLabel: "Toplam", showOpening: true };

  it("reads a complete preference back", () => {
    expect(parseBalanceColumns(stored)).toEqual(stored);
  });

  it("accepts a preference that names neither column", () => {
    expect(parseBalanceColumns({ openingLabel: null, closingLabel: null, showOpening: false }))
      .toEqual({ openingLabel: null, closingLabel: null, showOpening: false });
  });

  it("refuses anything that is not an object of that shape", () => {
    for (const value of [null, undefined, 3, "Ay Sonu", [stored], { ...stored, showOpening: "evet" }]) {
      expect(parseBalanceColumns(value)).toBeNull();
    }
  });

  it("refuses a missing visibility rather than assuming one", () => {
    // A stored value with no answer is not the same as an answer of "yes":
    // decoding it as one would turn a synced half-write into a decision the
    // owner never made.
    expect(parseBalanceColumns({ openingLabel: "Ay Sonu", closingLabel: null })).toBeNull();
  });

  it("refuses a heading longer than a heading", () => {
    const long = "a".repeat(MAX_BALANCE_COLUMN_LABEL + 1);
    expect(parseBalanceColumns({ ...stored, openingLabel: long })).toBeNull();
    expect(parseBalanceColumns({ ...stored, closingLabel: long })).toBeNull();
    expect(parseBalanceColumns({ ...stored, openingLabel: "a".repeat(MAX_BALANCE_COLUMN_LABEL) })).not.toBeNull();
  });

  it("falls back to the app's own name for anything that is not a name", () => {
    expect(balanceColumnLabel(null, "Ay Başı")).toBe("Ay Başı");
    expect(balanceColumnLabel(undefined, "Ay Başı")).toBe("Ay Başı");
    expect(balanceColumnLabel("   ", "Ay Başı")).toBe("Ay Başı");
  });

  it("uses the owner's name, trimmed", () => {
    expect(balanceColumnLabel(" Ay Sonu ", "Ay Başı")).toBe("Ay Sonu");
  });
});
