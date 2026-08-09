import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/auth.test.ts",
      "tests/investment-domain.test.ts",
      "tests/investment-validation.test.ts",
      "tests/repository-model.test.ts",
    ],
    environment: "node",
  },
});
