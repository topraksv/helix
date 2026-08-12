import { describe, expect, it } from "vitest";
import { isControlPlanePath } from "../scripts/quality-audit-paths.mjs";

describe("quality audit freshness classification", () => {
  it("does not stale product evidence for the execution-authority control plane", () => {
    expect([
      ".githooks/pre-commit",
      ".githooks/pre-push",
      "scripts/execution-authority-guard.mjs",
      "tests/execution-authority.test.ts",
      "tests/release-config.test.ts",
    ].every((path) => isControlPlanePath(path))).toBe(true);
  });

  it("still treats product and ordinary test paths as evidence-bearing", () => {
    expect(isControlPlanePath("src/domain/balance.ts")).toBe(false);
    expect(isControlPlanePath("tests/financial-properties.test.ts")).toBe(false);
    expect(isControlPlanePath("scripts/check-advisories.mjs")).toBe(false);
  });
});
