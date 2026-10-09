#!/usr/bin/env node
/**
 * Fail when a mutated file detects fewer mutants than it did last time.
 *
 * Helix and Gital run this same file. It replaced an absolute threshold of 98
 * that no real change could meet: measured on 2026-08-19 against the first
 * product diff to reach it, Helix's sixteen selected files scored 54.22, and
 * the release before it had shipped from a `workflow_dispatch` that ran
 * sentinels. A gate no change can pass is one everyone routes around. What is
 * worth enforcing is that a file never gets worse, and that no file enters
 * unmeasured: a mutated file with no recorded score fails rather than being
 * adopted at whatever it happens to score.
 *
 * `--record` adopts the last run's scores into `mutation-baseline.json`,
 * merged over what is there, since a run covers only the scope it was given.
 * It is a decision made after reading what survived, which is why nothing
 * here adopts on its own.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPORT = "reports/mutation/mutation.json";
const BASELINE = "mutation-baseline.json";

/**
 * How far a score may fall before it counts. Not slack: Stryker's timeout is
 * wall-clock and counts as detected, so how many mutants tip over it moves a
 * score with no code changed. Helix measured 5, 36 and 72 timeouts across
 * three runs of one tree, and the per-file drift stayed under half a point
 * once the static-only schema left the scope.
 *
 * So record from a quiet machine. A run with more timeouts scores higher, and
 * adopting it leaves the next quieter run failing an honest commit.
 */
const TOLERANCE = 0.5;

// A compile or runtime error is not a mutant the tests could have detected.
const COUNTED = { Killed: "killed", Timeout: "timeout", Survived: "survived", NoCoverage: "noCoverage" };

function countsOf(mutants) {
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0 };
  for (const { status } of mutants) if (status in COUNTED) counts[COUNTED[status]] += 1;
  return counts;
}

/** Stryker's own definition: detected over everything that could be detected. */
export function scoreOf(mutants) {
  const { killed, timeout, survived, noCoverage } = countsOf(mutants);
  const valid = killed + timeout + survived + noCoverage;
  return valid === 0 ? 100 : Number((((killed + timeout) / valid) * 100).toFixed(2));
}

export function scoresFromReport(report) {
  return Object.fromEntries(Object.entries(report.files ?? {}).map(([file, entry]) => [file, scoreOf(entry.mutants ?? [])]));
}

/**
 * The entries `--record` writes: the counts behind each score, so a number can
 * be re-derived, and the tree it was measured on, per file, because a run
 * covers only its scope and one stamp for the document would claim the rest.
 */
export function recordedFrom(report, measuredOn, measuredDate) {
  return Object.fromEntries(Object.entries(report.files ?? {}).map(([file, entry]) => {
    const mutants = entry.mutants ?? [];
    return [file, { score: scoreOf(mutants), ...countsOf(mutants), measuredOn, measuredDate }];
  }));
}

/**
 * @param {Record<string, number>} measured file -> score from this run
 * @param {{ files: Record<string, { score: number }> }} baseline
 * @param {(file: string) => boolean} exists injected so a stale entry is testable
 */
/** Read whole, with no look first: a check and a later write was a race code scanning named. */
function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { files: {} };
    throw error;
  }
}

export function evaluate(measured, baseline, exists = existsSync) {
  const recorded = baseline.files ?? {};
  const problems = [];
  const improvements = [];
  for (const [file, score] of Object.entries(measured)) {
    const previous = recorded[file]?.score;
    if (previous === undefined) problems.push(`UNRECORDED ${file} scored ${score.toFixed(2)}: read what survived, then \`npm run mutation:record\`.`);
    else if (score < previous - TOLERANCE) problems.push(`WORSE ${file}: ${previous.toFixed(2)} -> ${score.toFixed(2)}. Kill what now survives, or say in the commit why the file covers less.`);
    else if (score > previous + TOLERANCE) improvements.push(`${file}: ${previous.toFixed(2)} -> ${score.toFixed(2)}`);
  }
  for (const file of Object.keys(recorded)) {
    if (!exists(file)) problems.push(`STALE ${file} is recorded but gone: delete its entry.`);
  }
  return { problems, improvements };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(REPORT)) {
    console.error(`No mutation report at ${REPORT}. Run the mutation gate first.`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  const baseline = readBaseline();

  if (process.argv.includes("--record")) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const entries = recordedFrom(report, head, new Date().toISOString().slice(0, 10));
    const merged = Object.entries({ ...baseline.files, ...entries }).sort(([a], [b]) => a.localeCompare(b));
    writeFileSync(BASELINE, `${JSON.stringify({ files: Object.fromEntries(merged) }, null, 2)}\n`);
    for (const [file, { score }] of Object.entries(entries)) {
      const before = baseline.files?.[file]?.score;
      console.log(`${score.toFixed(2).padStart(6)}  ${before === undefined ? "new" : `was ${before.toFixed(2)}`}  ${file}`);
    }
    console.log(`Recorded ${Object.keys(entries).length} file(s) into ${BASELINE}.`);
    process.exit(0);
  }

  const { problems, improvements } = evaluate(scoresFromReport(report), baseline);
  if (improvements.length > 0) {
    console.log(`Above the recorded score, record only if tests you added earned it:\n  ${improvements.join("\n  ")}`);
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`No mutated file detects less than ${BASELINE} records.`);
}
