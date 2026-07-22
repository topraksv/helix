import { describe, expect, it } from "vitest";
import {
  shouldStackListActions,
  shouldUseCompactChart,
  shouldUseNarrowAnalytics,
  shouldUseWideImportGuide,
  shouldUseWideWorkspace,
} from "../src/ui/responsive";

describe("phone action layouts", () => {
  it("stacks wide payment actions on phones only", () => {
    expect(shouldStackListActions(320)).toBe(true);
    expect(shouldStackListActions(390)).toBe(true);
    expect(shouldStackListActions(768)).toBe(false);
    expect(shouldStackListActions(1440)).toBe(false);
  });

  it("keeps feature capability boundaries explicit and stable", () => {
    expect(shouldUseCompactChart(389)).toBe(true);
    expect(shouldUseCompactChart(390)).toBe(false);
    expect(shouldUseNarrowAnalytics(519)).toBe(true);
    expect(shouldUseNarrowAnalytics(520)).toBe(false);
    expect(shouldUseWideImportGuide(819)).toBe(false);
    expect(shouldUseWideImportGuide(820)).toBe(true);
    expect(shouldUseWideWorkspace(899)).toBe(false);
    expect(shouldUseWideWorkspace(900)).toBe(true);
  });
});
