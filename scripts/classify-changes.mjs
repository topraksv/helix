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
 *   deploy_web    the web app can have changed, so Pages must be republished
 *   deploy_mobile shared React Native code changed, so preview needs an OTA
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
  // Shared UI primitives every screen renders through.
  /^src\/ui\/(components|theme|sticky-table|haptics)\.tsx?$/,
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

const matches = (path, patterns) => patterns.some((pattern) => pattern.test(path));

export function classify(files) {
  // An empty diff still runs the gate: an empty result must never be read as
  // "nothing to check", which is exactly how a broken diff command would look.
  if (files.length === 0) {
    return { run_ci: true, full_e2e: true, deploy_web: false, deploy_mobile: false, reason: "empty diff" };
  }

  const relevant = files.filter((file) => !matches(file, NO_APP_IMPACT));
  if (relevant.length === 0) {
    return { run_ci: false, full_e2e: false, deploy_web: false, deploy_mobile: false, reason: "no application impact" };
  }

  const highRisk = relevant.filter(
    (file) => matches(file, HIGH_RISK) || !matches(file, KNOWN_NORMAL),
  );
  const shipping = relevant.filter((file) => !matches(file, NOT_SHIPPED));

  return {
    run_ci: true,
    full_e2e: highRisk.length > 0,
    deploy_web: shipping.length > 0,
    deploy_mobile: shipping.some((file) => /^(src\/|assets\/images\/|app\.json$|package(-lock)?\.json$)/.test(file)),
    reason: highRisk.length > 0 ? `high risk: ${highRisk.slice(0, 5).join(", ")}` : "normal change",
  };
}

function changedFiles(base, head) {
  // A first push, a force-pushed base or a shallow clone all leave the base
  // commit unresolvable. Treat that as high risk rather than as no changes.
  const args = base && base !== "0000000000000000000000000000000000000000"
    ? ["diff", "--name-only", `${base}..${head}`]
    : ["show", "--name-only", "--pretty=format:", head];
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const [first, ...rest] = process.argv.slice(2);
if (first !== undefined) {
  let files;
  if (first === "--files") {
    files = rest;
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
