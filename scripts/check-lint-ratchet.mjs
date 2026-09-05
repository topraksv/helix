#!/usr/bin/env node
/**
 * Fail when a lint rule fires more often than it did last time.
 *
 * `npx expo lint` exits 0 on warnings, so 262 of them accumulated with nothing
 * recording that the number was supposed to be going down rather than up. Two
 * of the rules involved are not style: `react-hooks/set-state-in-effect` costs
 * a second render pass and is how a screen comes to flash the wrong value
 * before correcting it, and `complexity` is at 100 occurrences. Neither is
 * worth failing the build over TODAY — that would stop every commit until 262
 * findings were cleared — but a new one is worth failing over, which is what a
 * ratchet says and a threshold cannot.
 *
 * Per rule rather than per file. A per-file baseline would have to be rewritten
 * every time a file moved, and the question worth asking is "did this commit
 * introduce a kind of problem", not "which line is it on".
 *
 * `--record` adopts the current counts. That is a decision made after reading
 * the diff, exactly as `mutation-baseline.json` is, and it is why nothing here
 * adopts automatically.
 *
 * WHY IT SHELLS OUT TO `expo lint` rather than importing ESLint: `expo lint`
 * is what `npm run verify` and the CI gate run, and it resolves the flat config
 * through Expo's own loader. A direct `npx eslint .` in this repository reports
 * a different set — measured on 2026-09-05 — so a ratchet built on it would be
 * counting something the gate does not.
 *
 * ALSO WHY THE CACHE MATTERS. `expo lint` passes `--cache`, and a warm
 * `.eslintcache` reports nothing for unchanged files: the same tree read 262
 * warnings on one run and 407-plus-one-error on the next, and the error was
 * mine, in a scratch file the cache had never seen. A ratchet fed by a partial
 * run would ratchet down to whatever happened to be cached. So this always
 * lints cold.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const BASELINE = "lint-baseline.json";

/** ESLint's JSON, out of a command that also prints its own env preamble. */
export function parseLintReport(output) {
  const start = output.indexOf("[{");
  const end = output.lastIndexOf("}]");
  if (start < 0 || end < 0) throw new Error("no ESLint JSON report in the lint output");
  return JSON.parse(output.slice(start, end + 2));
}

export function countsFrom(report) {
  const rules = {};
  let errors = 0;
  for (const file of report) {
    errors += file.errorCount ?? 0;
    for (const message of file.messages ?? []) {
      if (message.severity !== 1) continue;
      const rule = message.ruleId ?? "(no rule)";
      rules[rule] = (rules[rule] ?? 0) + 1;
    }
  }
  return { rules, errors };
}

/**
 * @param {Record<string, number>} measured
 * @param {{ rules: Record<string, number> }} baseline
 */
export function evaluate(measured, baseline) {
  const recorded = baseline.rules ?? {};
  const problems = [];
  const improvements = [];
  for (const [rule, count] of Object.entries(measured)) {
    const previous = recorded[rule];
    if (previous === undefined) {
      problems.push(`NEW RULE ${rule} fired ${count} time(s) and has no recorded baseline.`);
    } else if (count > previous) {
      problems.push(`WORSE ${rule}: ${previous} -> ${count}.`);
    } else if (count < previous) {
      improvements.push(`${rule}: ${previous} -> ${count}`);
    }
  }
  for (const [rule, previous] of Object.entries(recorded)) {
    if (measured[rule] === undefined) improvements.push(`${rule}: ${previous} -> 0`);
  }
  return { problems, improvements };
}

function runLint() {
  // Cold, for the reason in the header. `expo lint` exits non-zero on a real
  // error, and the report still has to be read in that case.
  rmSync(".eslintcache", { force: true });
  try {
    return execFileSync("npx", ["expo", "lint", "--", "--format", "json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.includes("[{")) return error.stdout;
    throw error;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const report = parseLintReport(runLint());
  const { rules, errors } = countsFrom(report);
  const total = Object.values(rules).reduce((sum, count) => sum + count, 0);

  const record = process.argv.includes("--record");
  if (record) {
    writeFileSync(BASELINE, `${JSON.stringify({ total, rules }, null, 2)}\n`);
    console.log(`Recorded ${total} warning(s) across ${Object.keys(rules).length} rule(s) in ${BASELINE}.`);
    process.exit(errors > 0 ? 1 : 0);
  }

  if (!existsSync(BASELINE)) {
    console.error(`No ${BASELINE}. Read the current findings, then run \`npm run lint:record\`.`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { problems, improvements } = evaluate(rules, baseline);

  for (const rule of Object.keys({ ...baseline.rules, ...rules }).sort()) {
    const now = rules[rule] ?? 0;
    const was = baseline.rules?.[rule];
    const mark = was === undefined ? "  new" : now > was ? " WORSE" : now < was ? " better" : "     ok";
    console.log(`${mark}  ${String(now).padStart(4)}  (was ${was ?? "unrecorded"})  ${rule}`);
  }
  console.log(`\n${total} warning(s), ${errors} error(s).`);

  if (improvements.length > 0) {
    console.log(
      `\n${improvements.length} rule(s) fired less than the baseline:\n  ${improvements.join("\n  ")}\n` +
        `  Lock them in with \`npm run lint:record\` once the fix is committed.`,
    );
  }

  if (errors > 0) {
    console.error("\nLint reported errors, which are not ratcheted: they fail outright.");
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error(`\n${problems.join("\n")}\n\nFix the new findings, or explain in the commit why the count legitimately grew.`);
    process.exit(1);
  }
  console.log("\nNo lint rule fires more than its recorded baseline.");
}
