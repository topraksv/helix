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
    ],
    environment: "node",
  },
});
