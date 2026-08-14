import broadConfig from "./stryker.config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Why this file exists beside `stryker.config.mjs`.
 *
 * The canonical `npm run test:mutation` points at the 59-file broad inventory,
 * whose recorded current-tree baseline is deliberately red: 79.65% against a
 * break threshold of 98. Using that known-red command unchanged as an automatic
 * deploy prerequisite would make every high-risk release impossible; silently
 * narrowing that command instead would make the audit lie. So the two
 * authorities keep distinct names: `test:mutation` stays the unchanged broad
 * gap inventory, and `test:mutation:ci` (this file) inherits every broad
 * setting and the unchanged 98 break threshold while selecting only the
 * high-risk production files changed after the cutover below.
 *
 * Phase 6 changed no product source. Its cutover commit is therefore the
 * mutation-diff floor for the first long-lived-branch push to main: earlier
 * product changes keep their Phase 3/3B evidence instead of being presented as
 * newly hardened. Every later high-risk production edit is mutated directly.
 */
const CUTOVER_BASE = "4deec006d007bc2162fcd9fe42929fa36944e01a";
const PROVEN_SENTINEL_SCOPE = [
  "src/auth/recovery.ts",
  "src/domain/investments.ts",
  "src/data/repo/accounts.ts",
  "src/data/repo/categories.ts",
  "src/data/repo/cell-notes.ts",
  "src/data/repo/computed.ts",
  "src/data/repo/import-plan.ts",
  "src/data/repo/investment-validation.ts",
  "src/data/repo/rule-validation.ts",
  "src/data/repo/settings.ts",
  "src/data/repo/transactions.ts",
];

const MUTATION_RELEVANT = /^src\/(?:domain|data\/repo|db|sync|auth|services)\/.*\.(?:[cm]?js|tsx?)$/;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function isAncestor(ancestor, descendant, cwd) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function selectMutationScope({ base, head, eventName = "local", cwd = process.cwd() }) {
  if (!base || !head) {
    if (eventName === "push") throw new Error("Missing mutation diff base or head for a push event.");
    return PROVEN_SENTINEL_SCOPE;
  }
  if (/^0+$/.test(base)) throw new Error("Mutation diff base is the zero SHA; refusing a sentinel-only push gate.");

  try {
    const effectiveBase = isAncestor(base, CUTOVER_BASE, cwd) && isAncestor(CUTOVER_BASE, head, cwd)
      ? CUTOVER_BASE
      : base;
    const changed = git(["diff", "--no-renames", "--name-only", `${effectiveBase}..${head}`], cwd)
      .split("\n")
      .filter(Boolean)
      .filter((file) => MUTATION_RELEVANT.test(file))
      .filter((file) => existsSync(resolve(cwd, file)));
    return changed.length > 0 ? [...new Set(changed)].sort() : PROVEN_SENTINEL_SCOPE;
  } catch (error) {
    throw new Error(`Mutation diff base could not be resolved; refusing a sentinel-only push gate: ${error}`);
  }
}

const mutate = selectMutationScope({
  base: process.env.MUTATION_BASE_SHA,
  head: process.env.MUTATION_HEAD_SHA,
  eventName: process.env.MUTATION_EVENT_NAME,
});

export default {
  ...broadConfig,
  mutate,
  jsonReporter: { fileName: "reports/mutation/ci-mutation.json" },
};
