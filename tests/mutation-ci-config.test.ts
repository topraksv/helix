import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { selectMutationScope } from "../stryker.ci.config.mjs";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CI mutation contract", () => {
  it("keeps the broad audit canonical and gives delivery its own command", () => {
    const packageJson = JSON.parse(read("package.json"));
    const broad = read("stryker.config.mjs");
    const ci = read("stryker.ci.config.mjs");

    expect(packageJson.scripts["test:mutation"]).toBe("stryker run");
    expect(packageJson.scripts["test:mutation:ci"]).toBe("stryker run stryker.ci.config.mjs");
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
    }
  });

  it("mutates the changed correctness-sensitive source instead of a static subset", () => {
    const repository = mkdtempSync(join(tmpdir(), "helix-mutation-scope-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "mutation@example.invalid"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "Mutation Test"], { cwd: repository });
      mkdirSync(join(repository, "src/domain"), { recursive: true });
      writeFileSync(join(repository, "src/domain/money.ts"), "export const amount = 1;\n");
      execFileSync("git", ["add", "."], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: repository });
      const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

      writeFileSync(join(repository, "src/domain/money.ts"), "export const amount = 2;\n");
      execFileSync("git", ["add", "."], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "change"], { cwd: repository });
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

      expect(selectMutationScope({ base, head, cwd: repository })).toEqual(["src/domain/money.ts"]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("fails closed when an asserted push base cannot be resolved", () => {
    expect(() => selectMutationScope({
      base: "0000000000000000000000000000000000000000",
      head: "HEAD",
      cwd: process.cwd(),
    })).toThrow(/mutation diff base/i);
  });

  /**
   * The generated migration manifest is inside the relevant path but has no
   * logic to mutate, and Stryker cannot parse it at all — its Babel setup and
   * this project's collide on the decorator plugins. Before this exclusion the
   * gate did not report a low score, it CRASHED, and it did so only on the
   * pushes that add a migration. What those files do is proven by
   * `tests/migration-upgrade.test.ts` replaying them against a real database.
   */
  it("never mutates the generated migration manifest", () => {
    const scope = selectMutationScope({
      base: "9d9d1021abcbb4f299133828dcb2af0b4dbbbe4a",
      head: "HEAD",
      eventName: "push",
      cwd: process.cwd(),
    });
    expect(scope.some((file) => file.startsWith("src/db/migrations/"))).toBe(false);
    // The exclusion is narrow: real database source is still in scope.
    expect(scope).toContain("src/db/schema.ts");
  });

  it("allows a ref-free sentinel only for an explicit manual dispatch", () => {
    expect(selectMutationScope({
      base: "",
      head: "",
      eventName: "workflow_dispatch",
      cwd: process.cwd(),
    })).toContain("src/auth/recovery.ts");
    expect(() => selectMutationScope({
      base: "",
      head: "HEAD",
      eventName: "push",
      cwd: process.cwd(),
    })).toThrow(/missing mutation diff/i);
  });
});
