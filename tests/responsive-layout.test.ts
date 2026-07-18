import { describe, expect, it } from "vitest";
import { shouldStackListActions } from "../src/ui/responsive";

describe("phone action layouts", () => {
  it("stacks wide payment actions on phones only", () => {
    expect(shouldStackListActions(320)).toBe(true);
    expect(shouldStackListActions(390)).toBe(true);
    expect(shouldStackListActions(768)).toBe(false);
    expect(shouldStackListActions(1440)).toBe(false);
  });
});
