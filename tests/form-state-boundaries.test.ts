import { describe, expect, it } from "vitest";
import { asyncFieldState } from "../src/domain/form-state";

describe("form-state default validation contract", () => {
  it("allows a changed draft when the caller has no extra validator", () => {
    expect(asyncFieldState("10", "7")).toEqual({
      value: "10",
      edited: true,
      canSave: true,
    });
  });
});
