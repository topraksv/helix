#!/usr/bin/env node
/**
 * Decide what a main-branch push has to prove and which surfaces it can ship.
 *
 * The safe error is a slow run: every unrecognised path receives the full
 * gate, while a missing base receives the full gate and both deploy targets.
 *
 * Usage: node scripts/classify-changes.mjs <base-ref> <head-ref>
 *        node scripts/classify-changes.mjs --files a.ts b.ts
 * Writes `key=value` lines to stdout and, when set, to $GITHUB_OUTPUT.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Money, persistence, identity, sync, native and delivery boundaries. */
const HIGH_RISK = [
  /^src\/domain\//,
  /^src\/data\//,
  /^src\/db\//,
  /^src\/sync\//,
  /^src\/auth\//,
  /^src\/services\//,
  /^supabase\//,
  /^package(-lock)?\.json$/,
  /^\.npmrc$/,
  /^app\.json$/,
  /^eas\.json$/,
  /^\.eas\//,
  /^plugins\//,
  /^drizzle\.config\.ts$/,
  /^(babel|metro|eslint)\.config\.js$/,
  /^tsconfig\.json$/,
  /^vitest(?:\.coverage|\.mutation)?\.config\.ts$/,
  /^stryker(?:\.[^.]+)?\.config\.mjs$/,
  /^playwright\.config\.ts$/,
  /^knip\.json$/,
  /^src\/app\/(?:.*\/)?_layout\.tsx$/,
  /^src\/app\/\+html\.tsx$/,
  /^\.github\//,
  /^scripts\//,
];

/** Repository material that cannot alter either delivered application. */
const NO_APP_IMPACT = [
  /^README\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^\.env\.example$/,
  /^\.vscode\//,
  /^docs\//,
  /^assets\/screenshots\//,
  /^assets\/brand\/horizontal-(?:light|dark)\.png$/,
  /^\.(ai|agents|claude|codex)\//,
  /^(AGENTS|CLAUDE)\.md$/,
  /^skills-lock\.json$/,
];

/** Checked here but never published as Pages or Expo Go application bytes. */
const NOT_SHIPPED = [
  /^e2e\//,
  /^tests\//,
  /^\.github\//,
  /^scripts\//,
  /^supabase\//,
  /^plugins\//,
];

/** Explicit light-tier allowlist; everything else escalates. */
const KNOWN_LIGHT = [
  /^src\/i18n\//,
  /^src\/app\/.*\.tsx$/,
  /^src\/ui\//,
  /^e2e\//,
  /^tests\//,
  /^public\//,
  /^assets\//,
];

/** Inputs capable of changing the production web artifact. */
const AFFECTS_WEB_BUILD = [
  /^src\//,
  /^assets\//,
  /^public\//,
  /^app\.json$/,
  /^package(-lock)?\.json$/,
  /^(babel|metro)\.config\.js$/,
  /^tsconfig\.json$/,
  /^\.npmrc$/,
  /^scripts\/(check-web-budget|export-e2e-web|serve-static)\.mjs$/,
];

/** Verification and release plumbing that provably cannot change web bytes. */
const NEVER_WEB_BUILD = [
  /^tests\//,
  /^e2e\//,
  /^playwright\.config\.ts$/,
  /^vitest(?:\.coverage|\.mutation)?\.config\.ts$/,
  /^stryker(?:\.[^.]+)?\.config\.mjs$/,
  /^\.github\//,
  /^\.eas\//,
  /^eas\.json$/,
  /^plugins\//,
  /^supabase\//,
  /^drizzle\.config\.ts$/,
  /^knip\.json$/,
  /^eslint\.config\.js$/,
  /^\.nvmrc$/,
  /^scripts\/classify-changes\.mjs$/,
];

/** Inputs capable of changing Expo Go JavaScript or shipped assets. */
const AFFECTS_MOBILE_UPDATE = [
  /^src\//,
  /^assets\//,
  /^app\.json$/,
  /^package(-lock)?\.json$/,
  /^(babel|metro)\.config\.js$/,
  /^tsconfig\.json$/,
  /^\.npmrc$/,
];

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

export function classify(files) {
  if (files.length === 0) {
    return {
      run_ci: true,
      light_gate: true,
      full_gate: true,
      run_web_build: true,
      deploy_web: true,
      deploy_mobile: true,
      reason: "no diff available; fail-open full gate and dual deploy",
    };
  }

  const relevant = files.filter((file) => !matches(file, NO_APP_IMPACT));
  if (relevant.length === 0) {
    return {
      run_ci: false,
      // Every main push still proves the inexpensive baseline. `run_ci` keeps
      // the no-impact tier visible without turning documentation into a bypass.
      light_gate: true,
      full_gate: false,
      run_web_build: false,
      deploy_web: false,
      deploy_mobile: false,
      reason: "no application impact; light gate retained",
    };
  }

  const unknown = relevant.filter(
    (file) => !matches(file, HIGH_RISK) && !matches(file, KNOWN_LIGHT),
  );
  const highRisk = relevant.filter(
    (file) => matches(file, HIGH_RISK) || unknown.includes(file),
  );
  const shipping = relevant.filter((file) => !matches(file, NOT_SHIPPED));
  const buildsWeb = relevant.filter(
    (file) => !matches(file, NEVER_WEB_BUILD)
      && (matches(file, AFFECTS_WEB_BUILD) || unknown.includes(file)),
  );

  return {
    run_ci: true,
    light_gate: true,
    full_gate: highRisk.length > 0,
    run_web_build: buildsWeb.length > 0,
    deploy_web: shipping.length > 0 && buildsWeb.length > 0,
    deploy_mobile: shipping.some(
      (file) => matches(file, AFFECTS_MOBILE_UPDATE) || unknown.includes(file),
    ),
    reason: highRisk.length > 0
      ? `high risk: ${highRisk.slice(0, 5).join(", ")}`
      : "ordinary change; light gate",
  };
}

const UNRESOLVABLE_BASE = "0000000000000000000000000000000000000000";
const hasBase = (base) => Boolean(base) && base !== UNRESOLVABLE_BASE;

function changedFiles(base, head) {
  // Rename detection can return only the destination. If a shipped path moves
  // into a no-impact area, classify both the deletion and addition instead.
  return execFileSync("git", ["diff", "--no-renames", "--name-only", `${base}..${head}`], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const [first, ...rest] = process.argv.slice(2);
  let files;
  if (first === "--files") {
    files = rest;
  } else if (!hasBase(first)) {
    files = [];
  } else {
    try {
      files = changedFiles(first, rest[0] ?? "HEAD");
    } catch {
      files = [];
    }
  }

  const lines = Object.entries(classify(files)).map(([key, value]) => `${key}=${value}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
