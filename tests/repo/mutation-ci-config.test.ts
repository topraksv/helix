import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isMutationScoped, selectMutationScope, shardOfScope, weigherOf } from "../../stryker.ci.config.mjs";

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
    expect(packageJson.scripts["mutation:record"]).toBe("node scripts/check-mutation-ratchet.mjs --record");

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
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
    const commit = (message: string) => { git("add", "."); git("commit", "--quiet", "-m", message); };
    try {
      git("init", "--quiet");
      git("config", "user.email", "mutation@example.invalid");
      git("config", "user.name", "Mutation Test");
      mkdirSync(join(repository, "src/domain"), { recursive: true });
      writeFileSync(join(repository, "src/domain/money.ts"), "export const amount = 1;\n");
      commit("base");
      const base = git("rev-parse", "HEAD");

      writeFileSync(join(repository, "src/domain/money.ts"), "export const amount = 2;\n");
      commit("change");
      const head = git("rev-parse", "HEAD");

      expect(selectMutationScope({ base, head, cwd: repository })).toEqual(["src/domain/money.ts"]);

      // A test is named for a behaviour, not its source: what it imports is mutated.
      mkdirSync(join(repository, "tests/domain"), { recursive: true });
      writeFileSync(join(repository, "tests/domain/financial-boundaries.test.ts"), 'import { amount } from "../../src/domain/money";\n');
      commit("fewer cases");
      const weakened = git("rev-parse", "HEAD");
      expect(selectMutationScope({ base: head, head: weakened, cwd: repository })).toEqual(["src/domain/money.ts"]);

      // A raised floor is a claim about a file's tests, so the file is mutated
      // to prove it; a floor that only moved its provenance is not.
      writeFileSync(join(repository, "src/domain/dates.ts"), "export const day = 1;\n");
      writeFileSync(join(repository, "mutation-baseline.json"), JSON.stringify({ files: { "src/domain/dates.ts": { score: 80 }, "src/domain/money.ts": { score: 90 } } }));
      commit("floors");
      const floors = git("rev-parse", "HEAD");
      writeFileSync(join(repository, "mutation-baseline.json"), JSON.stringify({ files: { "src/domain/dates.ts": { score: 85 }, "src/domain/money.ts": { score: 90, measuredOn: "later" } } }));
      commit("raise");
      const raised = git("rev-parse", "HEAD");
      expect(selectMutationScope({ base: floors, head: raised, cwd: repository })).toEqual(["src/domain/dates.ts"]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails closed when an asserted push base cannot be resolved", () => {
    expect(() => selectMutationScope({
      base: "0000000000000000000000000000000000000000",
      head: "HEAD",
      cwd: process.cwd(),
    })).toThrow(/mutation diff base/i);
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
    // The evidence it was drawn from lives in `tests/fixtures/`, outside the
    // mutated tree entirely, so no exclusion has to name it. The CONCLUSION
    // drawn from that record does carry logic — which five
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

  /**
   * The delivery gate runs in shards (`ci.yml`). What has to hold is that
   * together they are exactly the scope — nothing mutated twice, nothing left
   * out — and that every runner deals the same hand from the same tree.
   */
  it("deals every file of the scope to exactly one shard, heaviest first", () => {
    const sizes: Record<string, number> = { "a.ts": 900, "b.ts": 500, "c.ts": 400, "d.ts": 300, "e.ts": 100 };
    const files = Object.keys(sizes);
    const sizeOf = (file: string) => sizes[file]!;
    const shards = [1, 2, 3].map((shard) => shardOfScope(files, `${shard}/3`, sizeOf));
    expect(shards).toEqual([["a.ts"], ["b.ts", "e.ts"], ["c.ts", "d.ts"]]);
    expect(shards.flat().sort()).toEqual(files);
    expect(shardOfScope(files, undefined, sizeOf)).toBe(files);
    expect(shardOfScope(["only.ts"], "3/3", () => 1)).toEqual([]);
    for (const spec of ["0/3", "4/3", "1/0", "2", "a/b"]) {
      expect(() => shardOfScope(files, spec, sizeOf), spec).toThrow(/MUTATION_SHARD/);
    }
  });

  it("weighs a file by its recorded cost, and an unrecorded one by bytes at the recorded rate", () => {
    const sizes: Record<string, number> = { "static.ts": 100, "plain.ts": 300, "new.ts": 200 };
    const sizeOf = (file: string) => {
      if (!(file in sizes)) throw new Error(`ENOENT ${file}`);
      return sizes[file]!;
    };
    const weightOf = weigherOf({ "static.ts": { cost: 3000 }, "plain.ts": { cost: 1000 }, "gone.ts": { cost: 50 } }, sizeOf);
    expect(["static.ts", "plain.ts", "new.ts", "gone.ts", "missing.ts"].map(weightOf)).toEqual([3000, 1000, 2000, 50, 0]);
    expect(weigherOf({}, sizeOf)("new.ts")).toBe(200);
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
