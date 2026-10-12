import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // The modules that decide what a number means or what gets written. A
      // glob so a new file there is gated the day it lands. Screens are owned
      // by contract tests, not line counts.
      include: ["src/domain/**/*.ts", "src/data/repo/**/*.ts", "src/services/spreadsheet-import.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        perFile: true,
        branches: 90,
        functions: 100,
        lines: 95,
        statements: 90,
      },
    },
  },
});
