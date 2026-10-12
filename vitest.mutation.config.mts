import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      // Mutating process workers do not reliably apply mid-test TZ changes;
      // calendar behaviour stays covered by deterministic date inputs.
      "tests/domain/locale-timezone.test.ts",
      // Instrumentation turns the 100k-row release-budget suite into a
      // benchmark that exhausts the test timeout. It stays in the normal gate.
      "tests/domain/performance.test.ts",
      // Asserts the exact source text of `services/notifications.ts` and
      // `auth/session.ts`; Stryker's instrumented copy never matches, so the
      // dry run dies. Only this wiring half is excluded, not the behavioural
      // tests for `domain/privacy.ts`. It stays in the normal gate.
      "tests/repo/privacy-wiring.test.ts",
    ],
    environment: "node",
    // Instrumentation, not the tests, makes Vitest's 5-second default too
    // short (`utf8ByteLength` over a maximum-size backup); the normal gate
    // keeps the default. Excluding that test would score the file on nothing.
    testTimeout: 60_000,
  },
});
