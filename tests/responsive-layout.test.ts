import { describe, expect, it } from "vitest";
import { fixedToolRowWidth, shouldStackListActions } from "../src/ui/responsive";

describe("phone action layouts", () => {
  it.each([320, 390, 768, 1440])("keeps five cash-flow tools inside the padded %ipx viewport", (viewport) => {
    const contentWidth = viewport - 32;
    expect(fixedToolRowWidth(5)).toBeLessThanOrEqual(contentWidth);
  });

  it("stacks wide payment actions on phones only", () => {
    expect(shouldStackListActions(320)).toBe(true);
    expect(shouldStackListActions(390)).toBe(true);
    expect(shouldStackListActions(768)).toBe(false);
    expect(shouldStackListActions(1440)).toBe(false);
  });
});
