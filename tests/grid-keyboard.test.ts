import { describe, expect, it } from "vitest";
import { nextGridPosition } from "../src/ui/grid-navigation";

/**
 * Mali Tablo used to be 240 separate tab stops with no arrow-key behaviour at
 * all: reaching the navigation bar behind a two-year ledger meant 240 Tab
 * presses. These are the movement rules the grid now follows; the clamping and
 * the Home/Ctrl+Home distinction are the parts that are invisible in a
 * screenshot and easy to get subtly wrong.
 */
describe("grid keyboard navigation", () => {
  const size = { rows: 12, columns: 20 };
  const at = (row: number, column: number) => ({ row, column });

  it("moves one cell per arrow press", () => {
    expect(nextGridPosition({ key: "ArrowDown", toEnds: false }, at(3, 5), size)).toEqual(at(4, 5));
    expect(nextGridPosition({ key: "ArrowUp", toEnds: false }, at(3, 5), size)).toEqual(at(2, 5));
    expect(nextGridPosition({ key: "ArrowRight", toEnds: false }, at(3, 5), size)).toEqual(at(3, 6));
    expect(nextGridPosition({ key: "ArrowLeft", toEnds: false }, at(3, 5), size)).toEqual(at(3, 4));
  });

  it("stops at every edge instead of wrapping", () => {
    expect(nextGridPosition({ key: "ArrowUp", toEnds: false }, at(0, 0), size)).toEqual(at(0, 0));
    expect(nextGridPosition({ key: "ArrowLeft", toEnds: false }, at(0, 0), size)).toEqual(at(0, 0));
    expect(nextGridPosition({ key: "ArrowDown", toEnds: false }, at(11, 19), size)).toEqual(at(11, 19));
    expect(nextGridPosition({ key: "ArrowRight", toEnds: false }, at(11, 19), size)).toEqual(at(11, 19));
  });

  it("separates Home from Ctrl+Home", () => {
    // Home is the start of THIS row; Ctrl+Home is the corner of the grid.
    expect(nextGridPosition({ key: "Home", toEnds: false }, at(7, 13), size)).toEqual(at(7, 0));
    expect(nextGridPosition({ key: "Home", toEnds: true }, at(7, 13), size)).toEqual(at(0, 0));
    expect(nextGridPosition({ key: "End", toEnds: false }, at(7, 13), size)).toEqual(at(7, 19));
    expect(nextGridPosition({ key: "End", toEnds: true }, at(7, 13), size)).toEqual(at(11, 19));
  });

  it("pages by a screenful, bounded at both ends", () => {
    expect(nextGridPosition({ key: "PageDown", toEnds: false }, at(0, 4), size)).toEqual(at(10, 4));
    expect(nextGridPosition({ key: "PageUp", toEnds: false }, at(11, 4), size)).toEqual(at(1, 4));
    // A very long ledger still moves a screenful, never the whole distance.
    expect(nextGridPosition({ key: "PageDown", toEnds: false }, at(0, 0), { rows: 400, columns: 4 }))
      .toEqual(at(10, 0));
    // A two-row table still moves, rather than sticking.
    expect(nextGridPosition({ key: "PageDown", toEnds: false }, at(0, 0), { rows: 2, columns: 2 }))
      .toEqual(at(1, 0));
  });

  it("declines keys it does not own, so they keep their default behaviour", () => {
    expect(nextGridPosition({ key: "Tab", toEnds: false }, at(1, 1), size)).toBeNull();
    expect(nextGridPosition({ key: "Enter", toEnds: false }, at(1, 1), size)).toBeNull();
    expect(nextGridPosition({ key: " ", toEnds: false }, at(1, 1), size)).toBeNull();
  });

  it("declines an empty grid rather than producing a negative cell", () => {
    expect(nextGridPosition({ key: "ArrowDown", toEnds: false }, at(0, 0), { rows: 0, columns: 0 })).toBeNull();
    expect(nextGridPosition({ key: "ArrowDown", toEnds: false }, at(0, 0), { rows: 3, columns: 0 })).toBeNull();
  });
});
