import { describe, expect, it } from "vitest";
import { PRESENTATION_TAXONOMY } from "../src/ui/presentation";

describe("presentation taxonomy", () => {
  it("keeps navigable page contracts explicit", () => {
    expect(PRESENTATION_TAXONOMY["primary-page"].backAction).toBe("back");
    expect(PRESENTATION_TAXONOMY["drill-down"].backAction).toBe("back");
  });
});
