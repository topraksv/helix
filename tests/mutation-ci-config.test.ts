import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isMutationScoped, selectMutationScope } from "../stryker.ci.config.mjs";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CI mutation contract", () => {
  it("keeps the broad audit canonical and gives delivery its own command", () => {
    const packageJson = JSON.parse(read("package.json"));
    const broad = read("stryker.config.mjs");
    const ci = read("stryker.ci.config.mjs");

    expect(packageJson.scripts["test:mutation"]).toBe("stryker run");
    // Delivery runs the mutation pass and then the ratchet. Stryker reports
    // the score; `check-mutation-ratchet.mjs` decides whether it is a failure.
    expect(packageJson.scripts["test:mutation:ci"]).toBe(
      "stryker run stryker.ci.config.mjs && node scripts/check-mutation-ratchet.mjs",
    );
    expect(ci).toContain('import broadConfig from "./stryker.config.mjs"');
    expect(ci).toContain("...broadConfig");

    // The break threshold is the ONE broad setting delivery does not inherit,
    // and it is disabled rather than lowered — a smaller number would be a
    // quieter version of the same lie. Everything else still comes from the
    // broad config, and the broad audit keeps the unchanged 98.
    expect(ci).toContain("thresholds: { ...broadConfig.thresholds, break: null }");
    expect(ci.match(/thresholds:/g)).toHaveLength(1);
    expect(broad).toContain("break: 98");
    expect(packageJson.scripts["mutation:baseline"]).toBe("node scripts/write-mutation-baseline.mjs");

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
  it("never mutates the generated manifest or the declarative schema", () => {
    const scope = selectMutationScope({
      base: "9d9d1021abcbb4f299133828dcb2af0b4dbbbe4a",
      head: "HEAD",
      eventName: "push",
      cwd: process.cwd(),
    });
    expect(scope.some((file) => file.startsWith("src/db/migrations/"))).toBe(false);
    // `schema.ts` joined them for the same reason and a measured cost. Every
    // one of its 411 mutants is static, which is 411 full runs of the suite —
    // 93% of a 44-minute job that held up the deploy. What they test is a
    // MIRROR: the file's own header records that constraints are deliberately
    // not reproduced locally because Postgres enforces them, and the real
    // schema is replayed against a database by `migration-upgrade`.
    expect(scope).not.toContain("src/db/schema.ts");
    // The exclusion stays narrow: database source that carries logic is still
    // mutated, and so is everything outside `src/db`.
    expect(scope).toContain("src/db/ids.ts");
    expect(scope).toContain("src/db/relations.ts");
    expect(scope).toContain("src/domain/statement-import.ts");
  });

  /**
   * Asked of the rule rather than of a diff.
   *
   * `selectMutationScope` can only answer about files that are already
   * committed, so the exclusion for a file the current change ADDS is
   * unassertable until after it has shipped — exactly when the assertion
   * would have been worth having.
   */
  it("excludes generated evidence outside src/db, and only the evidence", () => {
    // 180 generated rows of what two favicon services returned on the day
    // someone asked, with no function in the file. A mutated `px: 180` tests
    // nothing: the number is not a decision the app makes, and the file is
    // rewritten wholesale by `scripts/audit-brand-marks.mjs` rather than
    // edited. Same argument as `schema.ts`, outside `src/db`.
    expect(isMutationScoped("src/domain/brand-mark-audit.ts")).toBe(false);
    // The CONCLUSION drawn from that record does carry logic — which five
    // domains take the DuckDuckGo route, and the two URL shapes — so it is
    // mutated like any other domain file.
    expect(isMutationScoped("src/domain/brand-marks.ts")).toBe(true);
    expect(isMutationScoped("src/db/schema.ts")).toBe(false);
    // Generated from the LINKED database and rewritten wholesale, so a mutant
    // here tests a description of somebody else's Postgres rather than
    // anything this repository decides. Its sibling in the same directory,
    // which is the engine that uses those types, stays in scope.
    expect(isMutationScoped("src/sync/database.types.ts")).toBe(false);
    expect(isMutationScoped("src/sync/engine.ts")).toBe(true);
    expect(isMutationScoped("src/db/migrations/migrations.js")).toBe(false);
    expect(isMutationScoped("src/db/ids.ts")).toBe(true);
    // Outside the high-risk directories entirely: never mutated, never was.
    expect(isMutationScoped("src/ui/charts.tsx")).toBe(false);
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
