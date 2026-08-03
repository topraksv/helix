import { describe, expect, it } from "vitest";

import { classify } from "../scripts/classify-changes.mjs";

describe("change classification", () => {
  it("runs nothing for a change that cannot reach the application", () => {
    expect(classify(["README.md", "assets/screenshots/dashboard-dark.png", ".gitignore"])).toMatchObject({
      run_ci: false,
      full_e2e: false,
      deploy_web: false,
      deploy_mobile: false,
    });
  });

  it("runs the smoke gate for an ordinary screen or string change", () => {
    expect(classify(["src/i18n/tr.ts", "src/app/upcoming.tsx"])).toMatchObject({
      run_ci: true,
      full_e2e: false,
      deploy_web: true,
      deploy_mobile: true,
    });
  });

  for (const [area, file] of [
    ["financial calculation", "src/domain/balance.ts"],
    ["database", "src/db/mutations.ts"],
    ["sync", "src/sync/push.ts"],
    ["auth", "src/auth/session.ts"],
    ["import/backup", "src/services/backup.ts"],
    ["supabase", "supabase/migrations/20260101_add.sql"],
    ["lockfile", "package-lock.json"],
    ["native config", "app.json"],
    ["eas", "eas.json"],
    ["routing infrastructure", "src/app/(tabs)/_layout.tsx"],
    ["shared primitive", "src/ui/components.tsx"],
    ["workflow", ".github/workflows/ci.yml"],
  ] as const) {
    it(`treats a ${area} change as high risk`, () => {
      expect(classify([file]).full_e2e, file).toBe(true);
    });
  }

  it("treats an unrecognised path as high risk rather than guessing", () => {
    expect(classify(["some/new/thing.ts"])).toMatchObject({ run_ci: true, full_e2e: true });
  });

  it("runs and ships everything when no diff is available", () => {
    // An unresolvable base — manual dispatch, first push, shallow clone — is
    // not an empty change set, and must never be read as one.
    expect(classify([])).toMatchObject({
      run_ci: true,
      full_e2e: true,
      deploy_web: true,
      deploy_mobile: true,
    });
  });

  it("verifies test-only and delivery changes without republishing anything", () => {
    expect(classify(["e2e/core-flow.spec.ts", "tests/balance.test.ts", ".github/workflows/ci.yml"])).toMatchObject({
      run_ci: true,
      deploy_web: false,
      deploy_mobile: false,
    });
  });

  it("does not send a web-only or documentation change to the phone", () => {
    expect(classify(["public/manifest.json"])).toMatchObject({ deploy_web: true, deploy_mobile: false });
  });

  it("emits deterministic specialist hints without changing CI gates", () => {
    expect(classify(["src/auth/session.ts"]).quality_checks).toEqual(["security"]);
    for (const [file, expected] of [
      ["src/app/(auth)/sign-in.tsx", ["security", "ui"]],
      ["src/app/_layout.tsx", ["security", "ui", "platform"]],
      ["src/app/+html.tsx", ["security", "ui"]],
      ["src/app/account-security.tsx", ["security", "ui"]],
    ] as const) {
      expect(classify([file]).quality_checks, file).toEqual(expected);
    }
    expect(classify(["src/domain/balance.ts"]).quality_checks).toEqual(["financial"]);
    expect(classify(["src/services/picked-file.ts"]).quality_checks).toEqual(["financial"]);
    expect(classify(["src/app/analytics.tsx"]).quality_checks).toEqual(["ui"]);
    expect(classify(["src/services/fx-fetch.ts"]).quality_checks).toEqual(["network"]);
    expect(classify(["package.json"]).quality_checks).toEqual(["dependency"]);
    for (const file of ["eslint.config.js", "babel.config.js", "metro.config.js", "tsconfig.json", "vitest.config.ts"]) {
      expect(classify([file]).quality_checks, file).toEqual(["tooling"]);
    }
    expect(classify(["supabase/migrations/20260101_add.sql"]).quality_checks).toEqual([
      "security",
      "financial",
      "database",
    ]);
    expect(classify(["README.md"]).quality_checks).toEqual(["none"]);
    expect(classify(["docs/old-snapshot.md"])).toMatchObject({
      run_ci: false,
      full_e2e: false,
      run_web_build: false,
      deploy_web: false,
      deploy_mobile: false,
      quality_checks: ["none"],
    });
  });

  it("escalates the whole push when one file in it is high risk", () => {
    expect(classify(["src/i18n/tr.ts", "src/domain/money.ts"]).full_e2e).toBe(true);
  });
});

describe("web build gating", () => {
  const cases: [string, string[], Partial<Record<string, boolean>>][] = [
    ["README or local AI file", ["README.md", "AGENTS.md"], { run_ci: false, run_web_build: false, deploy_web: false, deploy_mobile: false }],
    ["unit test only", ["tests/balance.test.ts"], { run_ci: true, run_web_build: false, deploy_web: false, deploy_mobile: false }],
    ["E2E test only", ["e2e/core-flow.spec.ts"], { run_ci: true, run_web_build: false, deploy_web: false, deploy_mobile: false }],
    ["advisory script", ["scripts/check-advisories.mjs"], { run_ci: true, full_e2e: true, run_web_build: false, deploy_web: false, deploy_mobile: false }],
    ["classifier test", ["tests/change-classification.test.ts"], { run_ci: true, run_web_build: false, deploy_web: false }],
    ["release-config test", ["tests/release-config.test.ts"], { run_ci: true, run_web_build: false, deploy_web: false }],
    ["workflow contract", [".github/workflows/ci.yml"], { run_ci: true, full_e2e: true, run_web_build: false, deploy_web: false, deploy_mobile: false }],
    ["leaf screen UI", ["src/app/upcoming.tsx"], { run_ci: true, full_e2e: false, run_web_build: true, deploy_web: true, deploy_mobile: true }],
    ["shared UI primitive", ["src/ui/components.tsx"], { run_ci: true, full_e2e: true, run_web_build: true, deploy_web: true, deploy_mobile: true }],
    ["metro config", ["metro.config.js"], { run_ci: true, full_e2e: true, run_web_build: true, deploy_web: true }],
    ["babel config", ["babel.config.js"], { run_ci: true, full_e2e: true, run_web_build: true }],
    ["app.json", ["app.json"], { run_ci: true, full_e2e: true, run_web_build: true, deploy_web: true, deploy_mobile: true }],
    ["bundle budget script", ["scripts/check-web-budget.mjs"], { run_ci: true, full_e2e: true, run_web_build: true }],
    ["unknown file", ["some/new/thing.ts"], { run_ci: true, full_e2e: true, run_web_build: true, deploy_web: true }],
  ];

  for (const [name, files, expected] of cases) {
    it(`classifies ${name}`, () => {
      expect(classify(files), files.join(", ")).toMatchObject(expected);
    });
  }

  it("never deploys the web app without building it first", () => {
    // Deploying without a build in the same run would publish whatever the
    // previous run left in the Pages artifact.
    const samples = [
      [], ["README.md"], ["tests/a.test.ts"], ["e2e/a.spec.ts"], [".github/workflows/ci.yml"],
      ["src/app/upcoming.tsx"], ["src/ui/components.tsx"], ["metro.config.js"], ["eas.json"],
      [".nvmrc"], ["package-lock.json"], ["some/new/thing.ts"], ["src/domain/money.ts"],
      ["assets/screenshots/a.png"], ["public/manifest.json"], ["supabase/migrations/x.sql"],
    ];
    for (const files of samples) {
      const result = classify(files);
      if (result.deploy_web) expect(result.run_web_build, files.join(", ") || "empty").toBe(true);
    }
  });

  it("does not publish an unchanged app for delivery-tool-only changes", () => {
    for (const file of ["eas.json", ".nvmrc"]) {
      expect(classify([file]), file).toMatchObject({ deploy_mobile: false, run_web_build: false, deploy_web: false });
    }
  });

  it("publishes mobile code, shipped assets, and bundle configuration", () => {
    for (const file of [
      "src/app/upcoming.tsx",
      "assets/images/icon.png",
      "app.json",
      "package.json",
      "metro.config.js",
      "babel.config.js",
      "tsconfig.json",
    ]) {
      expect(classify([file]).deploy_mobile, file).toBe(true);
    }
  });
});
