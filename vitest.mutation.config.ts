import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Instrumentation makes this wall-clock parser budget measure Stryker,
    // not the parser. The same test remains mandatory in the normal gate.
    exclude: [
      "tests/backup-validation.test.ts",
      // Mutating process workers do not reliably apply mid-test TZ changes.
      // Calendar behavior remains covered by deterministic date test inputs.
      "tests/locale-timezone.test.ts",
      // Instrumenting the full 59-file scope turns the 100k-row release-budget
      // suite into an instrumentation benchmark and can exhaust Vitest's 5s
      // test timeout. Functional equivalents remain in analytics and mutation
      // contract tests; the real performance suite remains in the normal gate.
      "tests/performance.test.ts",
    ],
    environment: "node",
  },
});
