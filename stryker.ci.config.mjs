import broadConfig from "./stryker.config.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The delivery gate's mutation scope: what a push changed, dealt to the
 * runners `.github/workflows/ci.yml` holds. Helix and Gital run this same
 * file; only the three constants below differ, and each says why it is what
 * it is. `npm run test:mutation` keeps the broad inventory for a local audit.
 *
 * The whole inventory on every gate was the first choice. On 2026-10-02 it
 * took Gital 16 min 19 s while every other job was done in two, and 339 static
 * mutants, each a whole-suite run, were 86% of it. A file the push did not
 * touch keeps the score it was recorded at, and the ratchet reads every file
 * it mutates.
 *
 * The broad break threshold is the one setting not inherited. Applied to
 * whatever a push touched it was unreachable — Helix's first real product diff
 * scored 54.22 against 98 — and a release shipped around it.
 */

// Helix's scope.

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

/**
 * Files inside that scope that carry no logic to mutate.
 *
 * `src/db/migrations/migrations.js` is a generated import manifest — a list of
 * `.sql` files and nothing else. Stryker cannot even parse it (its Babel setup
 * and this project's collide on the decorator plugins), so the moment a
 * migration is added the whole gate crashes rather than reporting a score.
 * What the migrations actually do is covered by `tests/db/migration-upgrade.test.ts`,
 * which replays every one of them against a real database.
 *
 * `src/db/schema.ts` is the same kind of file and was the gate's whole cost.
 * It is 431 lines of Drizzle table declarations with no function in it, so
 * every one of its 411 mutants is STATIC — each one re-runs the entire suite
 * because there is no per-test coverage to narrow it to. Measured on
 * 2026-08-20: 411 of the run's 712 static mutants, and static mutants were 93%
 * of a 44-minute job that blocked the deploy.
 *
 * What the 242 survivors buy is nothing. Mutating `text("user_id")` to
 * `text("")` or dropping a `.notNull()` tests a MIRROR: this file's own
 * header records that constraints are deliberately not reproduced locally
 * because Postgres enforces them at push time. The real schema is
 * `supabase/migrations`, replayed by `tests/db/migration-upgrade.test.ts`
 * against a real database and checked by `tests/db/relations-contract.test.ts`.
 *
 * `src/sync/database.types.ts` is the fourth of the same kind. It is 1_400
 * lines written by `supabase gen types typescript --linked` — the Row, Insert
 * and Update shape of every table and view, and nothing else. There is no
 * function in it, it is regenerated wholesale rather than edited, and what it
 * describes is the LINKED DATABASE's schema, so a mutant that renames a column
 * type does not test this repository's behaviour: it tests whether TypeScript
 * still compiles against a description of somebody else's Postgres. The thing
 * worth checking about this file is that it MATCHES the live schema, which is
 * a regeneration and a typecheck, not a mutant.
 *
 * `src/db/expo-sqlite.server.js` is the fifth, and the only one that is not a
 * data file. It is what `expo-sqlite` resolves to while a page is rendered on
 * the server, and it is three functions that throw plus one that returns an
 * empty subscription — a statement that the database is unreachable there.
 * There is no behaviour to mutate: killing a mutant would mean asserting that
 * a throw still throws. `metro.config.js` decides when it is substituted, and
 * `tests/repo/release-config.test.ts` holds the two together.
 *
 * `src/sync/realtime-absent.js` is the fifth and the second of that kind. It
 * is what `metro.config.js` resolves `@supabase/realtime-js` to, because
 * `createClient` builds a socket client whether or not anything subscribes and
 * nothing here ever does — 65_769 bytes of entry chunk, measured. What it
 * contains is one empty method and four throws, so a mutant could only assert
 * that a throw still throws. The premise underneath it is the thing worth
 * checking and `tests/repo/release-config.test.ts` checks it: the day a `.channel(`
 * appears in `src`, that suite goes red rather than a device going quiet.
 *
 * `src/services/notifications-absent.js` is the third: what the web resolves
 * `expo-notifications` to, one empty handler with everything else a throw. The
 * same suite holds it to every function `src` calls on the package.
 *
 * `src/db/devtools-absent.js` is the fourth: what a release resolves
 * `expo/devtools` to, one throw that `expo-sqlite` reaches only under
 * `__DEV__`. The same suite holds the substitution and that premise together.
 *
 * The exclusion stays narrow: everything under `domain`, `data/repo`,
 * `services`, `sync` and `auth` is still mutated, including files whose
 * mutants are mostly static. `domain/statement-import.ts` is 219 static
 * mutants of Turkish month names and amount-splitting regexes — real logic,
 * so it keeps paying for itself.
 */
const MUTATION_EXCLUDED = /^src\/(?:db\/(?:migrations\/|schema\.ts$|expo-sqlite\.server\.js$|devtools-absent\.js$)|domain\/brand-mark-audit\.ts$|services\/notifications-absent\.js$|sync\/(?:database\.types\.ts|realtime-absent\.js)$)/;

// Everything below is the same file in Helix and Gital.

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
    // A raised floor is a claim about a file's tests: Gital's 581bb68 raised
    // wishes.ts's and CI mutated the sentinels instead.
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
