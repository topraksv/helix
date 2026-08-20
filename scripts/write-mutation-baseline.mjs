#!/usr/bin/env node
/**
 * Record what the last mutation run measured, so the next one can be compared
 * with it.
 *
 * This is a deliberate act, not a build step. `check-mutation-ratchet.mjs`
 * refuses a file it has never seen precisely so that adopting a score is
 * something a person does after reading what survived. Running this without
 * reading the report first defeats the gate it feeds.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { scoresFromReport, scoreOf } from "./check-mutation-ratchet.mjs";

const REPORT = "reports/mutation/ci-mutation.json";
const BASELINE = "mutation-baseline.json";

/**
 * Read a JSON file, or return `missing` when it is not there.
 *
 * Deliberately not `existsSync` followed by `readFileSync`: that is two trips
 * to the filesystem with a window between them, so the answer to the first
 * can already be wrong by the time the second runs. The window is real here
 * rather than theoretical — Stryker deletes and rewrites its report directory
 * as a run finishes, and this script is invoked straight after one. Asking
 * once and handling the failure is both correct and a syscall cheaper.
 */
function readJsonOrMissing(path, missing) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return missing;
    throw error;
  }
}

const report = readJsonOrMissing(REPORT, null);
if (report === null) {
  console.error(`No mutation report at ${REPORT}. Run \`npm run test:mutation:ci\` first.`);
  process.exit(1);
}
const scores = scoresFromReport(report);

const files = {};
for (const file of Object.keys(scores).sort()) {
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const mutant of report.files[file].mutants ?? []) {
    if (mutant.status in counts) counts[mutant.status] += 1;
  }
  files[file] = {
    score: scoreOf(report.files[file].mutants ?? []),
    killed: counts.Killed,
    timeout: counts.Timeout,
    survived: counts.Survived,
    noCoverage: counts.NoCoverage,
  };
}

// A baseline that does not say which tree produced it cannot be re-derived.
const previous = readJsonOrMissing(BASELINE, { files: {} });
const merged = { ...previous.files, ...files };

writeFileSync(
  BASELINE,
  JSON.stringify(
    {
      measuredOn: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      measuredDate: new Date().toISOString().slice(0, 10),
      files: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);

for (const file of Object.keys(files)) {
  const before = previous.files?.[file]?.score;
  console.log(
    `${files[file].score.toFixed(2).padStart(6)}  ${before === undefined ? "new" : `was ${before.toFixed(2)}`}  ${file}`,
  );
}
console.log(`\nRecorded ${Object.keys(files).length} file(s) into ${BASELINE}.`);
