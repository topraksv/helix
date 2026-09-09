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
      //
      // Only the WIRING half is excluded. It used to be one file with the
      // behavioural tests for `domain/privacy.ts` in it, and excluding the
      // file excluded those too — so that module measured 0 here, which reads
      // as "nothing guards this" when the truth was that its guards were
      // excluded by association. Measured 2026-09-09: 12 mutants, every one of
      // them NoCoverage.
      "tests/privacy-wiring.test.ts",
    ],
    environment: "node",
    /**
     * Vitest's default is 5 seconds, and instrumentation is what makes that
     * too short — not the tests.
     *
     * Measured 2026-09-09, and it is the reason 47 files could not enter this
     * gate at all: the dry run died on "backup validation accepts the exact
     * byte limit", because `src/domain/input.ts`'s `utf8ByteLength` walks the
     * 15_728_640 characters of a maximum-size backup one code point at a time,
     * and Stryker's coverage counters ride along on every iteration. The test
     * is sound and the file is worth mutating; only the clock was wrong.
     *
     * Excluding the test instead — the treatment `performance.test.ts` gets
     * above — would have been the cheaper move and the wrong one: it is the
     * test that guards the byte limit on the very file being mutated, so the
     * score would have looked fine while measuring nothing.
     *
     * The normal gate keeps the 5-second default. Nothing here loosens what a
     * commit has to pass; it stops instrumentation overhead being read as a
     * failure.
     */
    testTimeout: 60_000,
  },
});
