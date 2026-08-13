import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CI mutation contract", () => {
  it("runs the proven mutation net without relabeling the red broad audit", () => {
    const packageJson = JSON.parse(read("package.json"));
    const broad = read("stryker.config.mjs");
    const ci = read("stryker.ci.config.mjs");

    expect(packageJson.scripts["test:mutation"]).toBe("stryker run stryker.ci.config.mjs");
    expect(ci).toContain('import broadConfig from "./stryker.config.mjs"');
    expect(ci).toContain("...broadConfig");
    expect(ci).not.toContain("thresholds:");

    for (const file of [
      "src/auth/recovery.ts",
      "src/domain/investments.ts",
      "src/data/repo/accounts.ts",
      "src/data/repo/categories.ts",
      "src/data/repo/cell-notes.ts",
      "src/data/repo/computed.ts",
      "src/data/repo/import-plan.ts",
      "src/data/repo/investment-validation.ts",
      "src/data/repo/rule-validation.ts",
      "src/data/repo/settings.ts",
      "src/data/repo/transactions.ts",
    ]) {
      expect(ci, file).toContain(`"${file}"`);
      expect(broad, file).toContain(`"${file}"`);
    }

    for (const partial of [
      "src/data/repo/budgets.ts",
      "src/data/repo/expected.ts",
      "src/data/repo/imports.ts",
      "src/data/repo/installments.ts",
      "src/data/repo/investments.ts",
      "src/data/repo/maintenance.ts",
      "src/data/repo/onboarding.ts",
      "src/data/repo/rules.ts",
    ]) {
      expect(broad, partial).toContain(`"${partial}"`);
      expect(ci, partial).not.toContain(`"${partial}"`);
    }
  });
});
