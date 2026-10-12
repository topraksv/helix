/**
 * `/cell-editor` is directly addressable, so both of its params are hostile
 * input. Validation is a pure gate in the OUTER component: the editor — and
 * therefore every database query it opens — only mounts once both params pass.
 *
 * Two earlier shapes were rejected and are pinned against here:
 *  - `categoryId!` (a non-null ASSERTION) with the redirect in an effect. The
 *    effect runs AFTER the query is built and executed, so a missing category
 *    bound `undefined` into drizzle's `eq` and the read failed first.
 *  - a sentinel id such as `" no-category"`, which hides invalid input inside a
 *    well-formed query instead of refusing it.
 */

import { describe, expect, it } from "vitest";

import { classifyRecordId, isValidCellParams, isValidItemParams } from "../../src/domain/route-params";

describe("cell editor route params", () => {
  it("accepts a real month/category pair", () => {
    expect(isValidCellParams("2026-07", "cat-1")).toEqual({ month: "2026-07", categoryId: "cat-1" });
  });

  it("rejects every malformed month", () => {
    for (const month of ["2026-13", "2026-00", "garbage", "2026", "2026-7", "", "2026-07-01"]) {
      expect(isValidCellParams(month, "cat-1"), `month ${JSON.stringify(month)}`).toBeNull();
    }
  });

  it("rejects a missing, empty or blank category", () => {
    for (const categoryId of [undefined, null, "", "   ", "\t"]) {
      expect(isValidCellParams("2026-07", categoryId), `category ${JSON.stringify(categoryId)}`).toBeNull();
    }
  });

  it("rejects non-string param types, including a repeated query key", () => {
    // Expo Router yields string[] when a query key appears more than once.
    expect(isValidCellParams(["2026-07", "2026-08"], "cat-1")).toBeNull();
    expect(isValidCellParams("2026-07", ["cat-1", "cat-2"])).toBeNull();
    expect(isValidCellParams(7, "cat-1")).toBeNull();
    expect(isValidCellParams("2026-07", 7)).toBeNull();
    expect(isValidCellParams({}, {})).toBeNull();
  });
});

describe("item breakdown route params", () => {
  it("accepts a well-formed triple", () => {
    expect(isValidItemParams("cat-1", "2026", "category")).toEqual({
      col: "cat-1",
      year: 2026,
      kind: "category",
    });
    expect(isValidItemParams("comp-1", "2026", "computed")?.kind).toBe("computed");
    expect(isValidItemParams("x", "2026", "uncategorized")?.kind).toBe("uncategorized");
  });

  it("rejects a year that is not four digits in range", () => {
    // `Number("abc")` is NaN, and NaN reached makeMonthKey, which returned the
    // string "0NaN-01" — twelve rows and a "NaN yıl toplamı" header.
    const badYears = [
      "abc", "", "20260", "202", "-2026", "2026.5", "1969", "3000", "NaN", "Infinity",
      // Numerically these ARE 2026, but they are not a four-digit year. Only
      // the shape check rejects them; the range check alone lets them through.
      "+2026", " 2026 ", "2.026e3", "0x7EA",
    ];
    for (const year of badYears) {
      expect(isValidItemParams("cat-1", year, "category"), `year ${JSON.stringify(year)}`).toBeNull();
    }
  });

  it("rejects an unknown kind, which the screen branches on", () => {
    for (const kind of ["", "COMPUTED", "categories", "__proto__", "constructor", undefined, null]) {
      expect(isValidItemParams("cat-1", "2026", kind), `kind ${JSON.stringify(kind)}`).toBeNull();
    }
  });

  it("rejects a missing or repeated column", () => {
    expect(isValidItemParams(undefined, "2026", "category")).toBeNull();
    expect(isValidItemParams("", "2026", "category")).toBeNull();
    expect(isValidItemParams(["a", "b"], "2026", "category")).toBeNull();
    expect(isValidItemParams("cat-1", ["2026", "2027"], "category")).toBeNull();
    expect(isValidItemParams("cat-1", "2026", ["category", "computed"])).toBeNull();
  });

  it("rejects prefixed, suffixed, and exclusive-boundary route years", () => {
    expect(isValidItemParams("id", "1970", "category")).toEqual({ col: "id", year: 1970, kind: "category" });
    expect(isValidItemParams("id", "2999", "computed")).toEqual({ col: "id", year: 2999, kind: "computed" });
    for (const year of ["x2026", "2026x"]) expect(isValidItemParams("id", year, "category")).toBeNull();
    expect(isValidItemParams("id", "2026 ", "category")).toBeNull();
  });
});

describe("modal record id", () => {
  it("treats an absent id as create-new", () => {
    expect(classifyRecordId(undefined)).toEqual({ mode: "new" });
    expect(classifyRecordId(null)).toEqual({ mode: "new" });
    expect(classifyRecordId("")).toEqual({ mode: "new" });
  });

  it("accepts a usable id as edit", () => {
    expect(classifyRecordId("tx-1")).toEqual({ mode: "edit", id: "tx-1" });
  });

  it("rejects input that can never identify a row", () => {
    // These used to render a permanently blank screen with a header, because
    // `id && !existing` could not tell "still loading" from "no such row".
    expect(classifyRecordId(["tx-1", "tx-2"])).toBeNull();
    expect(classifyRecordId("   ")).toBeNull();
    expect(classifyRecordId(7)).toBeNull();
    expect(classifyRecordId({})).toBeNull();
  });
});
