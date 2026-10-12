import broadConfig from "./stryker.config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The delivery gate's mutation scope: what a push changed, dealt to the
 * runners `.github/workflows/ci.yml` holds. Only the three constants below
 * are per repository. `npm run test:mutation` mutates `stryker.config.mjs`'s
 * scope, for a local audit.
 *
 * The whole inventory on every gate was the first choice: static mutants, each
 * a whole-suite run, dominated its time. A file the push did not touch keeps
 * the score it was recorded at, and the ratchet reads every file it mutates.
 *
 * The broad break threshold is the one setting not inherited: applied to
 * whatever a push touched it was unreachable.
 */

// This repository's scope.

/**
 * What a push that changed nothing in scope mutates: the files that proved
 * the gate on its first real diff, across auth, domain and the repository.
 */
const SENTINEL_SCOPE = [
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

// Where a record's meaning, storage, sync or sign-in lives. `src/data`'s
// hooks and live state are React glue over the repository and stay out.
const MUTATION_RELEVANT = /^src\/(?:domain|data\/repo|db|sync|auth|services)\/.*\.(?:[cm]?js|tsx?)$/;

// Files in that scope with no logic to mutate: generated migrations; the schema,
// whose mutants are all static and test a mirror of what Postgres enforces;
// generated Supabase types; server and web stand-ins that only throw.
const MUTATION_EXCLUDED = /^src\/(?:db\/(?:migrations\/|schema\.ts$|expo-sqlite\.server\.js$|devtools-absent\.js$)|services\/notifications-absent\.js$|sync\/(?:database\.types\.ts|realtime-absent\.js)$)/;

// Everything below is the same file in both repositories.

/**
 * Whether a path is inside the gate at all. Exported so the rule can be asked
 * about a file the current change adds, which no committed diff can show yet.
 */
export function isMutationScoped(file) {
  return MUTATION_RELEVANT.test(file) && !MUTATION_EXCLUDED.test(file);
}

/**
 * The `src/` modules a test imports — not those it mocks, which it does not
 * test — by path as written: a test is named for a behaviour, not for its
 * source, and a deleted test has none. Read from the checkout, which is `head`
 * on a runner: a `git show` per test made a long range take seconds.
 */
function importedSources(test, cwd) {
  try {
    return [...readFileSync(resolve(cwd, test), "utf8").matchAll(/(?:from\s+|import\(\s*)["'](?:\.\.\/)+(src\/[\w./-]+?)["']/g)].map((match) => /** @type {string} */ (match[1]));
  } catch {
    return [];
  }
}

/**
 * The files a push changed in source, in a test that imports them, or in
 * their recorded floor, measured from the last green run so a failed run's
 * changes are mutated again. A push that changed none of them mutates the
 * sentinels, so a dependency or config change that breaks the runner —
 * Vitest 5 did, silently — is still found by the push that made it.
 */
export function selectMutationScope({ base, head, eventName = "local", cwd = process.cwd() }) {
  if (!base || !head) {
    if (eventName === "push") throw new Error("Missing mutation diff base or head for a push event.");
    return SENTINEL_SCOPE;
  }
  if (/^0+$/.test(base)) throw new Error("Mutation diff base is the zero SHA; refusing a sentinel-only push gate.");
  try {
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = git("diff", "--no-renames", "--name-only", `${base}..${head}`).split("\n").filter(Boolean);
    const tested = paths
      .filter((file) => file.startsWith("tests/"))
      .flatMap((file) => importedSources(file, cwd))
      .flatMap((source) => [source, `${source}.ts`, `${source}.tsx`]);
    // A raised floor is a claim about a file's tests, so the file is mutated.
    const floors = (ref) => {
      try {
        return JSON.parse(git("show", `${ref}:mutation-baseline.json`)).files ?? {};
      } catch {
        return {};
      }
    };
    const [before, after] = paths.includes("mutation-baseline.json") ? [floors(base), floors(head)] : [{}, {}];
    const refloored = Object.keys(after).filter((file) => before[file]?.score !== after[file]?.score);
    const changed = [...paths, ...tested, ...refloored]
      .filter(isMutationScoped)
      .filter((file) => existsSync(resolve(cwd, file)));
    return changed.length > 0 ? [...new Set(changed)].sort() : SENTINEL_SCOPE;
  } catch (error) {
    throw new Error(`Mutation diff base could not be resolved; refusing a sentinel-only push gate: ${error}`);
  }
}

/**
 * The part of the scope one runner mutates, when `MUTATION_SHARD` is `k/n`.
 * Files are dealt largest first to the lightest shard, weighed in bytes —
 * close enough to a mutant count, and known to every runner from the checkout
 * alone, so each deals the same hand and the shards together are the scope.
 */
export function shardOfScope(files, spec, sizeOf) {
  if (!spec) return files;
  const match = /^(\d+)\/(\d+)$/.exec(spec);
  const index = Number(match?.[1]) - 1;
  const count = Number(match?.[2]);
  if (!match || index < 0 || index >= count) throw new Error(`MUTATION_SHARD must be k/n with 1 <= k <= n, got "${spec}".`);
  const shards = Array.from({ length: count }, () => ({ files: [], bytes: 0 }));
  for (const file of [...files].sort((a, b) => sizeOf(b) - sizeOf(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((best, shard) => (shard.bytes < best.bytes ? shard : best));
    lightest.files.push(file);
    lightest.bytes += sizeOf(file);
  }
  return shards[index].files.sort();
}

export default {
  ...broadConfig,
  mutate: shardOfScope(
    selectMutationScope({
      base: process.env.MUTATION_BASE_SHA,
      head: process.env.MUTATION_HEAD_SHA,
      eventName: process.env.MUTATION_EVENT_NAME,
    }),
    process.env.MUTATION_SHARD,
    (file) => statSync(resolve(process.cwd(), file)).size,
  ),
  // Reported, not enforced here: `scripts/check-mutation-ratchet.mjs` owns
  // the pass and the fail.
  thresholds: { ...broadConfig.thresholds, break: null },
};
