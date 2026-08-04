#!/usr/bin/env node
/**
 * Decide what a push has to prove before it can ship.
 *
 * CI used to run one serial chain for every commit, so a README typo paid for
 * a full production export and the whole browser suite. This classifies the
 * changed paths instead and emits four booleans the workflow branches on:
 *
 *   run_ci        any application check is worth running at all
 *   full_e2e      the complete Playwright suite, sharded — not just smoke
 *   run_web_build a production Expo export is worth producing
 *   deploy_web    the web app can have changed, so Pages must be republished
 *   deploy_mobile shared React Native code changed, so preview needs an OTA
 *   quality_checks deterministic specialist domains for local agent routing
 *
 * `run_web_build` is separate from `run_ci` because a CI-only or test-only
 * commit still has to be verified but cannot change a single byte of the
 * bundle. Exporting it anyway cost minutes per run to prove nothing.
 *
 * The one rule that matters: a path this file does not recognise is HIGH RISK.
 * Being wrong in that direction costs a slower run; being wrong in the other
 * direction ships an unverified ledger to the only person who uses it.
 *
 * Usage: node scripts/classify-changes.mjs <base-ref> <head-ref>
 *        node scripts/classify-changes.mjs --files a.ts b.ts
 * Writes `key=value` lines to stdout and, when set, to $GITHUB_OUTPUT.
 */
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * Changing any of these can break money, storage, identity or the delivery
 * path itself, and none of those failures is visible in a smoke run.
 */
const HIGH_RISK = [
  // Financial calculation, balance and ledger.
  /^src\/domain\//,
  // Database, storage, migrations.
  /^src\/db\//,
  /^src\/data\//,
  /^drizzle\.config\.ts$/,
  /^supabase\//,
  // Sync, offline behaviour and user isolation.
  /^src\/sync\//,
  /^src\/auth\//,
  /^src\/services\/(session|logger|secure)/,
  // Import, export, backup and restore.
  /^src\/services\/(backup|import|export|spreadsheet|csv)/,
  /^src\/app\/import-wizard\.tsx$/,
  // Dependencies and lockfile.
  /^package(-lock)?\.json$/,
  /^\.npmrc$/,
  // Native, Expo and build configuration.
  /^app\.json$/,
  /^eas\.json$/,
  /^\.eas\//,
  /^(babel|metro|eslint)\.config\.js$/,
  /^tsconfig\.json$/,
  /^vitest\.config\.ts$/,
  /^playwright\.config\.ts$/,
  // Routing infrastructure (a layout, not a leaf screen).
  /^src\/app\/(\([^)]+\)\/)*_layout\.tsx$/,
  /^src\/app\/\+html\.tsx$/,
  // Shared UI primitives every screen renders through. `primitives` is the
  // leaf layer split out of `components`; splitting a file must not quietly
  // downgrade what it renders.
  /^src\/ui\/(components|primitives|motion-primitives|theme|sticky-table|haptics)\.tsx?$/,
  // The delivery machinery itself.
  /^\.github\//,
  /^scripts\//,
];

/** Changes that cannot reach the running application at all. */
const NO_APP_IMPACT = [
  /^README\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^\.vscode\//,
  /^docs\//,
  /^assets\/screenshots\//,
  /^assets\/brand\//,
  // Local-only agent working set; ignored by Git, listed for completeness.
  /^\.(ai|agents|claude|codex)\//,
  /^(AGENTS|CLAUDE)\.md$/,
];

/**
 * Verified in CI, but never shipped to a device or to Pages. Tests and the
 * delivery machinery are high-signal for *whether* to check and irrelevant to
 * *what* gets published — republishing an unchanged bundle is pure noise.
 */
const NOT_SHIPPED = [/^e2e\//, /^tests\//, /^\.github\//, /^scripts\//];

/**
 * Paths whose blast radius is one screen, one string or one test. This list is
 * an allowlist on purpose: everything outside it, and outside the two lists
 * above, escalates to the full suite. A new top-level directory therefore
 * arrives loud rather than silently untested.
 */
const KNOWN_NORMAL = [
  /^src\/i18n\//,
  /^src\/app\/.*\.tsx$/,
  /^src\/ui\//,
  /^src\/services\//,
  /^e2e\//,
  /^tests\//,
  /^public\//,
  /^assets\/images\//,
];

/**
 * Paths that can change the produced bundle: application code and assets, plus
 * anything Metro, Babel, Expo, the budget check or Pages reads while producing
 * or serving it. Deliberately wider than "what ships" — a config that only
 * *might* alter the export still earns one.
 */
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

/** Paths that provably cannot: verification machinery and release plumbing. */
const NEVER_WEB_BUILD = [
  /^tests\//,
  /^e2e\//,
  /^playwright\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /^\.github\//,
  /^\.eas\//,
  /^eas\.json$/,
  /^\.nvmrc$/,
  /^scripts\/(classify-changes|check-advisories)\.mjs$/,
];

/** Paths whose produced JavaScript or shipped assets can change in Expo Go. */
const AFFECTS_MOBILE_UPDATE = [
  /^src\//,
  /^assets\/images\//,
  /^app\.json$/,
  /^package(-lock)?\.json$/,
  /^(babel|metro)\.config\.js$/,
  /^tsconfig\.json$/,
];

/**
 * Deterministic domain hints for agents. These are labels, not an LLM router:
 * CI keeps using the booleans above, while local agents use the smallest
 * specialist procedure justified by the changed paths.
 */
const QUALITY_PROCEDURES = [
  {
    name: "security",
    patterns: [
      /^src\/auth\//,
      /^src\/sync\//,
      /^src\/services\/(session|logger|secure|notifications|device-preferences|diagnostics)/,
      /^src\/app\/\(auth\)\//,
      /^src\/app\/_layout\.tsx$/,
      /^src\/app\/\+html\.tsx$/,
      /^src\/app\/account-security\.tsx$/,
      /^supabase\//,
      /^\.github\//,
      /^app\.json$/,
      /^scripts\/check-advisories\.mjs$/,
    ],
  },
  {
    name: "financial",
    patterns: [
      /^src\/domain\//,
      /^src\/data\//,
      /^src\/services\/(backup|import|export|spreadsheet|csv)/,
      /^src\/services\/picked-file\.ts$/,
      /^src\/app\/import-wizard\.tsx$/,
      /^supabase\//,
    ],
  },
  {
    name: "database",
    patterns: [/^src\/db\//, /^supabase\//, /^drizzle\.config\.ts$/],
  },
  {
    name: "dependency",
    patterns: [/^package(-lock)?\.json$/, /^\.npmrc$/, /^\.github\//, /^scripts\/check-advisories\.mjs$/],
  },
  {
    name: "ui",
    patterns: [/^src\/app\/.*\.tsx$/, /^src\/ui\//, /^src\/i18n\//, /^assets\/images\//, /^public\//],
  },
  {
    name: "platform",
    patterns: [/^app\.json$/, /^eas\.json$/, /^\.eas\//, /^\.github\//, /^src\/app\/.*_layout\.tsx$/],
  },
  {
    name: "browser",
    patterns: [/^e2e\//, /^playwright\.config\.ts$/, /^scripts\/(export-e2e-web|serve-static)\.mjs$/],
  },
  {
    name: "network",
    patterns: [/^src\/services\/(fx-fetch|markets)\.ts$/],
  },
  {
    name: "performance",
    patterns: [/^scripts\/check-web-budget\.mjs$/],
  },
  {
    name: "tooling",
    patterns: [
      /^scripts\//,
      /^\.github\//,
      /^(babel|eslint|metro)\.config\.js$/,
      /^playwright\.config\.ts$/,
      /^tsconfig\.json$/,
      /^vitest\.config\.ts$/,
    ],
  },
];

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

function qualityChecks(files) {
  const relevant = files.filter((file) => !matches(file, NO_APP_IMPACT));
  if (relevant.length === 0) return ["none"];

  const unknown = relevant.some(
    (file) => !matches(file, HIGH_RISK) && !matches(file, KNOWN_NORMAL),
  );
  if (unknown) return ["all"];

  const checks = QUALITY_PROCEDURES.filter(({ patterns }) =>
    relevant.some((file) => matches(file, patterns)),
  ).map(({ name }) => name);
  return checks.length > 0 ? checks : ["routine"];
}

export function classify(files) {
  // No file list is not "nothing changed" — it is "the diff could not be
  // taken", which is what a broken command, a shallow clone and a manual
  // dispatch all look like. Run everything and ship everything: republishing
  // an identical bundle costs a few minutes, and skipping a real one because a
  // diff failed silently is the expensive mistake.
  if (files.length === 0) {
    return {
      run_ci: true,
      full_e2e: true,
      run_web_build: true,
      deploy_web: true,
      deploy_mobile: true,
      quality_checks: ["all"],
      reason: "no diff available",
    };
  }

  const relevant = files.filter((file) => !matches(file, NO_APP_IMPACT));
  if (relevant.length === 0) {
    return {
      run_ci: false,
      full_e2e: false,
      run_web_build: false,
      deploy_web: false,
      deploy_mobile: false,
      quality_checks: ["none"],
      reason: "no application impact",
    };
  }

  const highRisk = relevant.filter(
    (file) => matches(file, HIGH_RISK) || !matches(file, KNOWN_NORMAL),
  );
  const shipping = relevant.filter((file) => !matches(file, NOT_SHIPPED));
  // An unrecognised path builds, for the same reason it runs the full suite:
  // the safe side of a guess about the bundle is producing one.
  const buildsWeb = relevant.filter(
    (file) => !matches(file, NEVER_WEB_BUILD) && (matches(file, AFFECTS_WEB_BUILD) || !matches(file, KNOWN_NORMAL)),
  );
  const deployWeb = shipping.length > 0 && buildsWeb.length > 0;

  return {
    run_ci: true,
    full_e2e: highRisk.length > 0,
    run_web_build: buildsWeb.length > 0,
    // Deploying without building would publish the previous run's bytes, so
    // `deploy_web` can never outrun `run_web_build`.
    deploy_web: deployWeb,
    deploy_mobile: shipping.some((file) => matches(file, AFFECTS_MOBILE_UPDATE)),
    quality_checks: qualityChecks(files),
    reason: highRisk.length > 0 ? `high risk: ${highRisk.slice(0, 5).join(", ")}` : "normal change",
  };
}

const UNRESOLVABLE_BASE = "0000000000000000000000000000000000000000";

/**
 * Whether a base commit to diff against exists at all.
 *
 * A manual `workflow_dispatch`, a first push and a shallow clone all arrive
 * without one. Falling back to the single head commit looks reasonable and is
 * the worst option available: it answers confidently about one commit when the
 * question was about an unknown range. There is no honest classification
 * without a base, so there is no classification — everything runs and
 * everything ships, which is also what someone pressing "Run workflow"
 * is asking for.
 */
const hasBase = (base) => Boolean(base) && base !== UNRESOLVABLE_BASE;

function changedFiles(base, head) {
  return execFileSync("git", ["diff", "--name-only", `${base}..${head}`], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const [first, ...rest] = process.argv.slice(2);
if (first !== undefined) {
  let files;
  if (first === "--files") {
    files = rest;
  } else if (!hasBase(first)) {
    // No base, no classification. `classify([])` is the high-risk answer.
    files = [];
  } else {
    try {
      files = changedFiles(first, rest[0] ?? "HEAD");
    } catch {
      files = [];
    }
  }
  const result = classify(files);
  const lines = Object.entries(result).map(([key, value]) => `${key}=${value}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
