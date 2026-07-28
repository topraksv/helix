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

  it("treats an empty diff as high risk, never as nothing to do", () => {
    expect(classify([])).toMatchObject({ run_ci: true, full_e2e: true });
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

  it("escalates the whole push when one file in it is high risk", () => {
    expect(classify(["src/i18n/tr.ts", "src/domain/money.ts"]).full_e2e).toBe(true);
  });
});
