import { describe, expect, it } from "vitest";
import { provenanceOf } from "../src/domain/provenance";
describe("provenance", () => {
  it("reports a row written before provenance existed as unknown, not manual", () => {
    expect(provenanceOf({})).toBe("unknown");
    expect(provenanceOf({ origin: null })).toBe("unknown");
    expect(provenanceOf({ origin: "manual" })).toBe("manual");
    expect(provenanceOf({ origin: "spreadsheet" })).toBe("spreadsheet");
    expect(provenanceOf({ origin: "statement" })).toBe("statement");
  });
});
