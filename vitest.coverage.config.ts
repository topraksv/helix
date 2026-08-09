import { defineConfig } from "vitest/config";

const criticalDomainFiles = [
  "src/domain/money.ts",
  "src/domain/balance.ts",
  "src/domain/card-statements.ts",
  "src/domain/recurrence.ts",
  "src/domain/transaction-draft.ts",
  "src/domain/investments.ts",
];

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      enabled: true,
      provider: "v8",
      include: criticalDomainFiles,
      reportsDirectory: "coverage/critical-domain",
      reporter: ["text", "json-summary"],
      reportOnFailure: true,
      skipFull: false,
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
