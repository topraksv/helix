#!/usr/bin/env node
/**
 * Fail when a mutated file detects fewer mutants than it did last time.
 *
 * `test:mutation:ci` used to inherit the broad inventory's break threshold of
 * 98 and apply it to whatever high-risk files a push happened to touch. That
 * looked like a gate and never was one. Measured on 2026-08-19 against the
 * first real product diff to reach it, the selected sixteen files scored
 * 54.22, and the three pushes before that had all fallen back to the sentinel
 * scope, so nothing had ever exercised it. The one green run that shipped the
 * previous release was a `workflow_dispatch`, which has no `github.event.before`
 * and therefore also ran sentinels. A threshold no real change can meet is not
 * a standard, it is a step everyone learns to route around — and the route
 * around it was shipping without the gate at all.
 *
 * 98 was never reachable here. The broad inventory's own recorded baseline is
 * 79.65, `src/db/schema.ts` is 411 mutants of Drizzle column declarations where
 * renaming `text("user_id")` proves nothing, and the repo layer scores near
 * zero because Stryker's per-test coverage cannot attribute its integration
 * tests. Demanding 98 of those files buys no safety.
 *
 * What is worth enforcing is that a file never gets worse. That is achievable
 * on every file, it catches the regression an absolute threshold was reaching
 * for, and it cannot be satisfied by routing around it.
 *
 * Nothing enters silently, exactly as `check-advisories.mjs` admits no advisory
 * without evidence: a mutated file with no recorded baseline FAILS, rather than
 * being adopted at whatever it happens to score.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPORT = "reports/mutation/ci-mutation.json";
const BASELINE = "mutation-baseline.json";

/**
 * How far a score may fall before it counts as a regression.
 *
 * Not slack for getting worse. Stryker's `timeoutMS` is wall-clock and it
 * counts a timeout as DETECTED, so how many mutants tip over that line moves
 * the score without any code changing.
 *
 * Measured across three runs of the same tree: 5, 36 and 72 timeouts. The
 * first two produced byte-identical per-file scores for every file except
 * `src/db/schema.ts`, whose 411 static mutants each re-run the whole suite
 * and were the entire source of the drift — which is one more reason it is no
 * longer mutated. Dropping it changed the scheduling of what remained, and
 * three files then scored HIGHER (statement-import 69.37 -> 79.58).
 *
 * So the recorded baselines are deliberately the ones from the 5-timeout run,
 * the least favourable profile. A run with more timeouts can only score at or
 * above them. RE-BASELINING FROM A NOISY RUN WOULD INVERT THAT and leave the
 * gate failing honest commits: read `write-mutation-baseline.mjs` before
 * adopting an improvement.
 */
const TOLERANCE = 0.5;

/** Stryker's own definition: detected over everything that could be detected. */
export function scoreOf(mutants) {
  let detected = 0;
  let valid = 0;
  for (const mutant of mutants) {
    if (mutant.status === "Killed" || mutant.status === "Timeout") {
      detected += 1;
      valid += 1;
    } else if (mutant.status === "Survived" || mutant.status === "NoCoverage") {
      valid += 1;
    }
  }
  return valid === 0 ? 100 : Number(((detected / valid) * 100).toFixed(2));
}

export function scoresFromReport(report) {
  const scores = {};
  for (const [file, entry] of Object.entries(report.files ?? {})) {
    scores[file] = scoreOf(entry.mutants ?? []);
  }
  return scores;
}

/**
 * The failure modes, as data: a file that got worse, a file nobody has
 * measured, and a baseline entry whose file is gone.
 *
 * @param {Record<string, number>} measured file -> score from this run
 * @param {{ files: Record<string, { score: number }> }} baseline
 * @param {(file: string) => boolean} [exists] injected so staleness is testable
 */
export function evaluate(measured, baseline, exists = (file) => existsSync(resolve(file))) {
  const recorded = baseline.files ?? {};
  const problems = [];
  const improvements = [];

  for (const [file, score] of Object.entries(measured)) {
    const previous = recorded[file];
    if (previous === undefined) {
      problems.push(
        `UNBASELINED ${file} scored ${score.toFixed(2)} and has no recorded baseline.\n` +
          `  A file enters this gate deliberately, not at whatever it happens to score.\n` +
          `  Read what survived, decide whether that is acceptable, then run:\n` +
          `    npm run mutation:baseline`,
      );
      continue;
    }
    if (score < previous.score - TOLERANCE) {
      problems.push(
        `REGRESSED ${file} fell from ${previous.score.toFixed(2)} to ${score.toFixed(2)}.\n` +
          `  Mutants this file used to detect now survive. Add the tests that kill\n` +
          `  them, or explain in the commit why the file legitimately covers less.`,
      );
    } else if (score > previous.score + TOLERANCE) {
      improvements.push(`${file}: ${previous.score.toFixed(2)} -> ${score.toFixed(2)}`);
    }
  }

  for (const file of Object.keys(recorded)) {
    if (!exists(file)) {
      problems.push(
        `STALE ${file} has a baseline but no longer exists.\n` +
          `  Delete its entry from ${BASELINE}.`,
      );
    }
  }

  return { problems, improvements };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (!existsSync(REPORT)) {
    console.error(`No mutation report at ${REPORT}. Run the mutation gate first.`);
    process.exit(1);
  }
  const measured = scoresFromReport(JSON.parse(readFileSync(REPORT, "utf8")));
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { problems, improvements } = evaluate(measured, baseline);

  const names = Object.keys(measured).sort();
  for (const file of names) {
    const previous = baseline.files?.[file];
    const mark = previous === undefined ? "  new" : measured[file] < previous.score - TOLERANCE ? " DOWN" : "   ok";
    const was = previous === undefined ? "unrecorded" : previous.score.toFixed(2);
    console.log(`${mark}  ${measured[file].toFixed(2).padStart(6)}  (was ${was})  ${file}`);
  }

  if (improvements.length > 0) {
    console.log(
      `\n${improvements.length} file(s) scored above baseline:\n  ${improvements.join("\n  ")}\n` +
        `  Lock these in with \`npm run mutation:baseline\` ONLY if the gain came from\n` +
        `  tests you added. A gain that came from more mutants timing out is a\n` +
        `  property of the runner, not of the suite, and recording it makes the\n` +
        `  next quieter run fail an honest commit.`,
    );
  }

  if (problems.length > 0) {
    console.error(`\n${problems.join("\n\n")}\n`);
    process.exit(1);
  }
  console.log(`\nNo mutated file detects less than its recorded baseline.`);
}
