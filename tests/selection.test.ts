import { describe, expect, it } from "vitest";
import { filterSelectionOptions } from "../src/ui/selection";

const options = [
  { value: "1", label: "İnternet" },
  { value: "2", label: "Kira" },
  { value: "3", label: "Giyim" },
];

describe("shared selection search", () => {
  it("matches Turkish labels without changing their source order", () => {
    expect(filterSelectionOptions(options, "  int  ")).toEqual([options[0]]);
    expect(filterSelectionOptions(options, "İY")).toEqual([options[2]]);
    expect(filterSelectionOptions(options, "")).toEqual(options);
  });
});
