import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      // Mutating process workers do not reliably apply mid-test TZ changes.
      // Calendar behavior remains covered by deterministic date test inputs.
      "tests/locale-timezone.test.ts",
      // Instrumenting the full 59-file scope turns the 100k-row release-budget
      // suite into an instrumentation benchmark and can exhaust Vitest's 5s
      // test timeout. Functional equivalents remain in analytics and mutation
      // contract tests; the real performance suite remains in the normal gate.
      "tests/performance.test.ts",
      // Asserts the exact SOURCE TEXT of `services/notifications.ts` and
      // `auth/session.ts` — that the redaction and teardown calls are really
      // wired, which no behavioural test can see. Stryker runs against an
      // instrumented copy of those files, so the snippets never match there
      // and the whole run dies in its dry run. It is a structural guard, it
      // kills no mutants, and it stays mandatory in the normal gate.
      "tests/privacy.test.ts",
    ],
    environment: "node",
  },
});
