import { describe, expect, it } from "vitest";
import {
  shouldStackListActions,
  shouldUseCompactChart,
  shouldUseNarrowAnalytics,
  shouldUseWideImportGuide,
  shouldUseWideWorkspace,
  usesCoarsePointerTable,
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

/**
 * The pin that fixes a ledger column measured 24x53 on every platform. That
 * clears WCAG 2.5.8 and is fine under a mouse, but the same control ships to
 * phones, where 24px is well under the 44pt a thumb is given — and it cannot
 * simply grow to 44 without costing a visible month in a ~134px column.
 */
describe("ledger column controls", () => {
  it("uses the wider target on every native build", () => {
    expect(usesCoarsePointerTable(134, false)).toBe(true);
    expect(usesCoarsePointerTable(320, false)).toBe(true);
  });

  it("uses the wider target for the compact table a phone browser gets", () => {
    expect(usesCoarsePointerTable(90, true)).toBe(true);
  });

  it("keeps the dense target under a desktop pointer", () => {
    expect(usesCoarsePointerTable(134, true)).toBe(false);
  });
});
