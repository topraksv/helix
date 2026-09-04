import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { classify, CI_EXECUTED_SCRIPTS } from "../scripts/classify-changes.mjs";

const root = resolve(process.cwd());
const classifier = resolve(root, "scripts/classify-changes.mjs");

function filesUnder(directory: string): string[] {
  const absolute = resolve(root, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const path = join(absolute, entry);
    return statSync(path).isDirectory()
      ? filesUnder(relative(root, path))
      : [relative(root, path).replaceAll("\\", "/")];
  });
}

describe("change classification", () => {
  it("keeps the light gate as the minimum for a no-impact push", () => {
    expect(classify([
      "README.md",
      "docs/BASELINE.md",
      "assets/screenshots/dashboard-dark.png",
      ".gitignore",
    ])).toMatchObject({
      run_ci: false,
      light_gate: true,
      full_gate: false,
      run_web_build: false,
      deploy_web: false,
      deploy_mobile: false,
      reason: "no application impact; light gate retained",
    });
  });

  it("keeps every current UI module, interface string, and route leaf on the light tier", () => {
    const routeLeaves = filesUnder("src/app").filter(
      (file) => file.endsWith(".tsx") && !file.endsWith("/_layout.tsx") && !file.endsWith("/+html.tsx"),
    );
    const lightFiles = [...filesUnder("src/ui"), ...filesUnder("src/i18n"), ...routeLeaves];

    expect(lightFiles.length).toBeGreaterThan(50);
    for (const file of lightFiles) {
      expect(classify([file]), file).toMatchObject({
        run_ci: true,
        light_gate: true,
        full_gate: false,
        run_web_build: true,
        deploy_web: true,
        deploy_mobile: true,
      });
    }
  });

  it("treats every current correctness-sensitive source module as high risk", () => {
    const highRiskFiles = [
      ...filesUnder("src/domain"),
      ...filesUnder("src/data"),
      ...filesUnder("src/db"),
      ...filesUnder("src/sync"),
      ...filesUnder("src/auth"),
      ...filesUnder("src/services"),
    ];

    expect(highRiskFiles).toContain("src/domain/category-icons.ts");
    expect(highRiskFiles.length).toBeGreaterThan(100);
    for (const file of highRiskFiles) {
      expect(classify([file]).full_gate, file).toBe(true);
    }
  });

  it("treats every route layout as high risk regardless of nesting depth", () => {
    const layouts = filesUnder("src/app").filter((file) => file.endsWith("/_layout.tsx"));

    expect(layouts).toContain("src/app/(tabs)/cash-flow/_layout.tsx");
    for (const file of layouts) {
      expect(classify([file]).full_gate, file).toBe(true);
    }
  });

  for (const [area, file, shipping] of [
    ["dependency lock", "package-lock.json", true],
    ["coverage policy", "vitest.coverage.config.ts", false],
    ["mutation policy", "stryker.config.mjs", false],
    ["database configuration", "drizzle.config.ts", false],
    ["Supabase migration", "supabase/migrations/00000000000029_retire_legacy_expected_kinds.sql", false],
    ["routing infrastructure", "src/app/(tabs)/_layout.tsx", true],
    ["HTML security shell", "src/app/+html.tsx", true],
    ["delivery workflow", ".github/workflows/ci.yml", true],
    ["native config plugin", "plugins/with-ios-native-product-name.js", false],
  ] as const) {
    it(`treats ${area} as high risk`, () => {
      const result = classify([file]);
      expect(result, file).toMatchObject({ run_ci: true, light_gate: true, full_gate: true });
      expect(result.deploy_mobile, file).toBe(shipping);
    });
  }

  it("runs and ships everything when no diff is available", () => {
    expect(classify([])).toMatchObject({
      run_ci: true,
      light_gate: true,
      full_gate: true,
      run_web_build: true,
      deploy_web: true,
      deploy_mobile: true,
      reason: "no diff available; fail-open full gate and dual deploy",
    });
  });

  it("escalates an unrecognised path instead of guessing", () => {
    expect(classify(["some/new/thing.ts"])).toMatchObject({
      run_ci: true,
      light_gate: true,
      full_gate: true,
      run_web_build: true,
      deploy_web: true,
      deploy_mobile: true,
    });
  });

  it("verifies tests and non-delivery tooling without publishing unchanged application bytes", () => {
    for (const file of [
      "tests/balance.test.ts",
      "e2e/core-flow.spec.ts",
    ]) {
      const result = classify([file]);
      expect(result, file).toMatchObject({
        light_gate: true,
        deploy_web: false,
        deploy_mobile: false,
      });
    }
    expect(classify(["scripts/check-web-budget.mjs"])).toMatchObject({
      full_gate: true,
      run_web_build: true,
      deploy_web: false,
    });
  });

  /**
   * Every `node scripts/...` a workflow can reach.
   *
   * Followed rather than listed: the `run:` lines in `.github/workflows/`,
   * each `npm run` target they name resolved through `package.json` (and its
   * own `npm run` chains), and the config files those commands load — which is
   * how `serve-static.mjs` counts, since nothing runs it by name and
   * `playwright.config.ts` starts it as the E2E web server.
   *
   * Only command position matters. A script NAMED in a comment is not a script
   * the gate runs, and several are named that way; matching `node scripts/...`
   * is what tells the two apart.
   */
  function scriptsReachableFromCi(): Set<string> {
    const packageScripts: Record<string, string> = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    // A command may load a config that starts a process of its own.
    const configFor: Record<string, string[]> = {
      "playwright test": ["playwright.config.ts"],
      "stryker run": ["stryker.config.mjs", "stryker.ci.config.mjs"],
    };
    const found = new Set<string>();
    const visited = new Set<string>();

    const scan = (text: string, depth: number): void => {
      if (depth > 8) return;
      for (const match of text.matchAll(/node (scripts\/[\w.-]+)/g)) found.add(match[1]!);
      for (const [command, configs] of Object.entries(configFor)) {
        if (!text.includes(command)) continue;
        for (const config of configs) scan(readFileSync(config, "utf8"), depth + 1);
      }
      for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
        const target = match[1]!;
        if (visited.has(target) || packageScripts[target] == null) continue;
        visited.add(target);
        scan(packageScripts[target]!, depth + 1);
      }
    };

    for (const file of readdirSync(".github/workflows")) {
      scan(readFileSync(`.github/workflows/${file}`, "utf8"), 0);
    }
    return found;
  }

  it("escalates exactly the scripts a workflow can run, and no more", () => {
    const reachable = scriptsReachableFromCi();

    // The floor: a scan that found nothing would make every claim below vacuous.
    expect(reachable.size).toBeGreaterThan(3);
    // Nothing the gate executes may sit on the light tier. This is the half
    // that matters: a new gate step whose script nobody added to the list
    // would otherwise ship unproven.
    for (const script of reachable) {
      expect(classify([script]).full_gate, `${script} is run by CI`).toBe(true);
    }
    // And nothing may be listed that CI does not run, which is what keeps the
    // narrowing honest rather than letting the list creep back to the whole
    // directory.
    expect([...CI_EXECUTED_SCRIPTS].sort()).toEqual([...reachable].sort());
  });

  it("keeps a local tool and a workflow this gate does not read on the light tier", () => {
    // The point of the narrowing, stated as behaviour. Neither of these can
    // change what a push proves or what either target publishes.
    for (const file of ["scripts/subset-fonts.mjs", "scripts/audit-brand-marks.mjs", ".github/workflows/nightly.yml", ".github/dependabot.yml"]) {
      expect(classify([file]), file).toMatchObject({
        run_ci: true,
        light_gate: true,
        full_gate: false,
        run_web_build: false,
        deploy_web: false,
        deploy_mobile: false,
      });
    }
  });

  it("rebuilds and republishes both surfaces after delivery-control changes", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      "scripts/classify-changes.mjs",
    ]) {
      expect(classify([file]), file).toMatchObject({
        light_gate: true,
        full_gate: true,
        run_web_build: true,
        deploy_web: true,
        deploy_mobile: true,
        reason: `delivery control changed: ${file}; full gate and dual republish`,
      });
    }
  });

  it("publishes public files only to web and shipped assets to both targets", () => {
    expect(classify(["public/sw.js"])).toMatchObject({
      full_gate: false,
      deploy_web: true,
      deploy_mobile: false,
    });
    for (const file of ["assets/images/icon.png", "assets/fonts/Inter_400Regular.ttf"]) {
      expect(classify([file]), file).toMatchObject({
        full_gate: false,
        deploy_web: true,
        deploy_mobile: true,
      });
    }
  });

  it("ships application brand symbols while leaving README-only lockups alone", () => {
    for (const file of ["assets/brand/symbol-light-t.png", "assets/brand/symbol-dark-t.png"]) {
      expect(classify([file]), file).toMatchObject({
        full_gate: false,
        run_web_build: true,
        deploy_web: true,
        deploy_mobile: true,
      });
    }
    for (const file of ["assets/brand/horizontal-light.png", "assets/brand/horizontal-dark.png"]) {
      expect(classify([file]), file).toMatchObject({
        run_ci: false,
        run_web_build: false,
        deploy_web: false,
        deploy_mobile: false,
      });
    }
  });

  it("lets one high-risk file escalate a mixed push", () => {
    expect(classify(["src/i18n/tr.ts", "src/domain/money.ts"])).toMatchObject({
      full_gate: true,
      deploy_web: true,
      deploy_mobile: true,
    });
  });

  it("never deploys web without producing the checked artifact in the same run", () => {
    const samples = [
      [],
      ["README.md"],
      ["tests/a.test.ts"],
      ["src/app/upcoming.tsx"],
      ["src/domain/money.ts"],
      ["public/sw.js"],
      ["some/new/thing.ts"],
    ];
    for (const files of samples) {
      const result = classify(files);
      if (result.deploy_web) expect(result.run_web_build, files.join(", ") || "no diff").toBe(true);
    }
  });

  it("does not retain the obsolete agent-routing output", () => {
    expect(classify(["src/domain/money.ts"])).not.toHaveProperty("quality_checks");
  });

  it("classifies both sides of a rename so a shipped removal cannot disappear", () => {
    const repository = mkdtempSync(join(tmpdir(), "helix-classifier-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "classifier@example.invalid"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "Classifier Test"], { cwd: repository });
      mkdirSync(join(repository, "src/ui"), { recursive: true });
      writeFileSync(join(repository, "src/ui/removed.ts"), "export const shipped = true;\n");
      execFileSync("git", ["add", "."], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: repository });
      const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();

      mkdirSync(join(repository, "docs"), { recursive: true });
      execFileSync("git", ["mv", "src/ui/removed.ts", "docs/removed.ts"], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "move"], { cwd: repository });
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
      const output = execFileSync(process.execPath, [classifier, base, head], {
        cwd: repository,
        encoding: "utf8",
      });

      expect(output).toContain("run_web_build=true");
      expect(output).toContain("deploy_web=true");
      expect(output).toContain("deploy_mobile=true");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
