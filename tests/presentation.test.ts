import { describe, expect, it } from "vitest";
import { PRESENTATION_TAXONOMY } from "../src/ui/presentation";

describe("presentation taxonomy", () => {
  it("keeps page, task and overlay dismissal contracts distinct", () => {
    expect(PRESENTATION_TAXONOMY["primary-page"].backAction).toBe("back");
    expect(PRESENTATION_TAXONOMY["drill-down"].backAction).toBe("back");
    expect(PRESENTATION_TAXONOMY["task-sheet"].backAction).toBe("close");
    expect(PRESENTATION_TAXONOMY["bottom-sheet"].backAction).toBe("dismiss");
    expect(PRESENTATION_TAXONOMY["contextual-overlay"].backAction).toBe("dismiss");
  });
});
