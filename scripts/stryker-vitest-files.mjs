/**
 * Stryker's Vitest runner, with each mutant's run narrowed by file rather than
 * by test name.
 *
 * Stryker 10 names a test by joining its suites and title with spaces and
 * reruns a mutant's covering tests through `testNamePattern`; Vitest 5 matches
 * that pattern against the names joined with " > ". So every test inside a
 * `describe` is filtered out, the mutant runs nothing and survives: measured
 * 2026-09-27 in Gital, 84 of 84 mutants on two files, in `perTest`, `all`
 * and `off` alike, since the runner filters in all three; Helix, still on
 * Vitest 4, had measured the same fault half-formed (97.37 → 71.05). Helix and
 * Gital run this same file since 2026-10-09.
 *
 * The id keeps the test's file before the `#`, so running the covering files
 * whole is still sound: more tests can only kill more mutants, never fewer.
 * Delete this plugin when an upstream runner matches Vitest 5's names.
 */

import { strykerPlugins as upstream } from "@stryker-mutator/vitest-runner";

const [vitest] = upstream;

function createRunner(injector) {
  const runner = vitest.factory(injector);
  const run = runner.run.bind(runner);
  runner.run = ({ testIds = [], ...rest } = {}) =>
    run(testIds.length > 0 ? { ...rest, testFiles: [...new Set(testIds.map((id) => id.split("#")[0]))] } : rest);
  return runner;
}
createRunner.inject = vitest.factory.inject;

export const strykerPlugins = [{ ...vitest, name: "vitest-files", factory: createRunner }];
