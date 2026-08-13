import broadConfig from "./stryker.config.mjs";

/**
 * The delivery gate mutates only files with a fresh or retained per-file score
 * at or above the unchanged 98% break threshold. The broad 59-file inventory
 * remains in stryker.config.mjs for gap discovery and must not be represented
 * as a green gate while its repository subtotal is still partial.
 */
const mutate = [
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
];

export default {
  ...broadConfig,
  mutate,
  jsonReporter: { fileName: "reports/mutation/ci-mutation.json" },
};
