import { describe, expect, it } from "vitest";
import { resolveMatrixMode } from "../src/domain/matrix-preferences";

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
