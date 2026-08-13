# Phase 6 — Risk-tiered delivery pipeline

## Result

One successful `main` gate can now publish both Helix surfaces without a
second dispatch or a duplicate quality run. Every push retains the light gate;
only correctness-sensitive, dependency, delivery, or unrecognised paths add
coverage, mutation, and the sharded full browser suite. A change confined to
route leaves, `src/ui/`, or `src/i18n/` therefore does **not** run mutation or
the full browser matrix.

No product source, runtime policy, EAS build profile, dependency version,
database schema, protected tag, or action pin changed in this phase.

## Track A — restored and modernised classifier

`scripts/classify-changes.mjs` was reconstructed from the version before
`fd81726`, then adapted to the current tree. It emits:

- `run_ci` — preserves the visible no-impact/impact distinction;
- `light_gate` — always true, because every `main` push proves the baseline;
- `full_gate` — adds coverage, mutation, and full E2E for high risk;
- `run_web_build`, `deploy_web`, and `deploy_mobile` — independent artifact and
  publication decisions; and
- `reason` — the concrete tier or first five high-risk paths for the run log.

An absent, zero, invalid, or otherwise unresolvable base produces the safe
answer: light and full gates, a web build, and both deploy targets. An unknown
path also escalates to full and both targets. A deploy-web result cannot be
true unless the same run produces the Pages artifact.

### Pattern re-verification

The classifier test walks the current source tree rather than pinning an old
file list. The final tracked-tree survey was:

| Current area | Files | Full | Light-only |
| --- | ---: | ---: | ---: |
| `src/domain/` | 43 | 43 | 0 |
| `src/data/repo/` | 18 | 18 | 0 |
| `src/db/` | 29 | 29 | 0 |
| `src/sync/` | 9 | 9 | 0 |
| `src/auth/` | 8 | 8 | 0 |
| `src/services/` | 12 | 12 | 0 |
| `src/ui/` | 66 | 0 | 66 |
| `src/i18n/` | 1 | 0 | 1 |
| `src/app/**/*.tsx` route leaves | 40 | 0 | 40 |

Across all 790 tracked paths, isolated changes classify as 187 full, 279
light-impact, and 324 no-application-impact paths. The last category still
runs the light gate when it is part of a `main` push. Route layouts and
`src/app/+html.tsx` are explicit high-risk exceptions to route-leaf handling.
`src/domain/category-icons.ts` is covered by the current domain rule. The two
brand-symbol PNGs imported by `src/ui/brand.tsx` are shipped light-tier assets;
only the horizontal lockups used exclusively by `README.md` are no-impact.

Representative CLI results:

| Synthetic diff | Full | Web build | Web deploy | Mobile deploy | Reason |
| --- | --- | --- | --- | --- | --- |
| `src/ui/components.tsx`, `src/app/upcoming.tsx`, `src/i18n/tr.ts` | false | true | true | true | ordinary change; light gate |
| `src/domain/money.ts` | true | true | true | true | high risk |
| `package-lock.json` | true | true | true | true | high risk |
| `future-system/policy.ts` | true | true | true | true | high risk, unknown path |
| `assets/brand/symbol-light-t.png` | false | true | true | true | ordinary shipped asset |
| `assets/brand/horizontal-light.png` | false | false | false | false | README-only asset; light retained |
| `docs/foundation/PHASE5-READINESS.md` | false | false | false | false | no application impact; light retained |

The real `main..branch-tip` range classified as full with web build and both
deploys. This is expected: the range contains delivery files and
correctness-sensitive production paths from the foundation program.

The old `quality_checks` output was removed deliberately. No workflow consumed
it, and its specialist labels duplicated the installed-skill routing now owned
by `AGENTS.md`. Retaining it would create a second routing table that neither
CI nor agents needed.

## Track B — one gate, two automatic targets

`.github/workflows/ci.yml` now has these responsibilities:

1. `classify` checks out full history, runs the classifier, and publishes its
   decisions as job outputs. A manual dispatch retains fail-open full testing
   while its `none|web|mobile|both` input narrows publication explicitly.
2. `light-gate` always runs control, typecheck, lint, and the full Vitest unit
   suite. `e2e-smoke` always runs the Chromium/Firefox smoke selection.
3. `full-gate`, `e2e-build`, and the three `e2e-full` shards run only when
   `full_gate=true`. One E2E export is shared by every shard.
4. `web-build` runs only when web bytes can change. It exports once, applies
   the bundle budget, creates the deep-link fallback, and uploads those exact
   checked bytes.
5. `gate` accepts tier-driven skips but rejects every failure or cancellation.
6. `deploy-web` and `deploy-mobile` consume the same classifier and gate.
   They may run together. Web deploys the existing artifact and retains its
   live root/sub-route/bundle smoke; mobile retains the `EXPO_TOKEN` guard and
   publishes only `eas update --branch preview --platform all`.

The Pages job retains `pages: write`, `id-token: write`, a direct dependency on
the build job, and the `helix` environment, matching GitHub's custom Pages
workflow requirements:
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

Classifier job outputs are mapped through `$GITHUB_OUTPUT` and consumed through
`needs`, matching GitHub's documented job-output mechanism:
https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idoutputs

The existing EAS command remains OTA-only. Expo's CLI reference confirms the
`--branch`, `--platform`, `--clear-cache`, and `--non-interactive` update flags:
https://docs.expo.dev/eas/cli/#eas-update

### Mutation gate versus broad audit

The canonical `npm run test:mutation` still points at the 59-file broad
inventory whose recorded current-tree baseline is red: 79.65% against break
98. Using that known-red command unchanged as an automatic deploy prerequisite
would make every high-risk release impossible; silently narrowing the command
would make the audit lie. The two authorities therefore have distinct names:

- `npm run test:mutation` remains the unchanged broad gap inventory; and
- `npm run test:mutation:ci` uses `stryker.ci.config.mjs`, inherits every broad
  setting and the unchanged 98 break threshold, and selects high-risk
  production files changed after the Phase 6 cutover.

Phase 6 itself changes no product source. For this first long-lived-branch
cutover, config-only changes, and a manual redeploy with no diff, the delivery
command uses an eleven-file sentinel scope already proven above 98: auth
recovery, domain investments, and the nine mutation-hardened repositories.
Every later edit under `src/domain/`, `src/data/repo/`, `src/db/`, `src/sync/`,
`src/auth/`, or `src/services/` replaces that sentinel with the exact changed
production files. A weak changed file therefore fails the unchanged threshold
instead of being diluted by unrelated green files. The selector uses
`--no-renames`, a full-history checkout, and an exported function covered by a
temporary-repository rename/diff test.

An explicitly supplied zero, missing, or shallow push base fails the mutation
selector closed; it cannot silently downgrade to sentinels. Only a dispatch
with no diff inputs intentionally uses the redeploy sentinel.

Partial repositories, including budgets, remain visible in the broad config
and are not relabelled as hardened. A future edit to one is directly selected
by the delivery command and must meet 98 before publication.

Stryker's official configuration reference confirms both that `mutate`
selects the production-file subset and that `thresholds.break` produces a
non-zero exit below the configured score:
https://stryker-mutator.io/docs/stryker-js/configuration/

Fresh delivery-mutation result:

```text
Files mutated   11
Mutants         1,533
Killed          1,520
Timeout         0
Survived        11
No coverage     2
Errors          0
Score           99.15% (99.28% covered)
Break           98% unchanged
Exit            0
```

## Track C — every other workflow reviewed

| Workflow | Decision | Evidence and reason |
| --- | --- | --- |
| `security.yml` | **Keep; delivery remains independent** | Its last five observed `main` push runs succeeded. CodeQL query packs and registry advisories can change without this commit, and the current branch audit evidence already includes unresolved high findings. Weekly/path-triggered visibility remains useful; making it an automatic deployment prerequisite would turn a time-varying advisory feed into a retroactive release verdict. Its stale claim that CI also ran audit was corrected. |
| `database.yml` | **Keep unchanged in scope** | The current tree has 29 migrations and a 138-assertion pgTAP authority. `supabase/**`, weekly, and manual triggers cover migrations, config, and the assertion file without waking a local Postgres stack for ordinary app code. The latest four observed runs succeeded; the older startup failure is preserved in history. Only the stale 136 count was corrected. |
| `keepalive.yml` | **Keep** | Its last five scheduled runs succeeded and the required secret names exist. Repository and linked-project metadata do not expose the hosted billing plan, and no Supabase access token was available to query it; a move off free tier therefore cannot be proven. `docs/SPEC.md` still records the credential-scoped heartbeat as a hosted-project availability requirement, so deletion would be guesswork. |
| `nightly.yml` | **Keep** | Its last five scheduled runs succeeded. It catches accumulated drift across light-tier changes, deploys nothing, and remains independent of per-push classification. Its rationale was updated from “full E2E is dispatch-only” to the new risk-selected reality. |

No workflow was added or removed. Every `uses:` entry remains pinned to a
40-character SHA, every checkout retains `persist-credentials: false`, and the
GitHub-owned-actions-only policy remains intact. `actionlint 1.7.12` accepted
all five workflow files with exit 0.

## Track D — authority documentation

`AGENTS.md` now separates three authorities:

- commit and push still require explicit user authorization;
- an authorized `main` push also authorizes the classifier-selected automatic
  web and Expo Go deployments from that push; and
- manual dispatch, direct deploy/OTA/release commands, and linked database
  publication still require exact-target authorization.

`docs/RELEASE.md` carries the same operational reality and preserves the
forward-only database and revert-based rollback rules. It is retained because
those external authority and rollback decisions are not derivable safely from
the workflow alone.

## Local execution evidence

### Light-gate equivalent

```sh
npm run control:check && npm run typecheck && npx expo lint && \
  npx vitest run && npm run test:e2e:smoke
```

```text
control/typecheck/lint  exit 0
Vitest                  133 files; 1,175 passed; 2 todo
Playwright smoke        24 passed (Chromium + Firefox), 55.8s
Overall                 exit 0
```

### Full-gate additions

```sh
npm run test:coverage && npm run test:mutation:ci && npm run test:e2e
```

```text
Coverage tests          133 files; 1,175 passed; 2 todo
Coverage S/B/F/L        99.81 / 99.01 / 100 / 100
Mutation                99.15%; 1,520 K / 0 T / 11 S / 2 NC; exit 0
Full Playwright         114 passed (Chromium + Firefox), 4.3m
Overall                 exit 0
```

The post-review normal gate exited 0 with 133 files, 1,180 passing tests, and
exactly two existing todos. No todo or skip was added by this phase.

## Commits and merge boundary

Incremental branch commits:

- `4e5aa6b` — classifier and current-tree contracts;
- `e8cae20` — initial passing delivery mutation scope, later made diff-aware
  without changing the broad audit;
- `a33cc79` — risk-tiered shared gate and automatic dual deploy; and
- `824cb9d` — auxiliary-workflow rationale and release authority alignment.

All were pushed to `origin/chore/foundation-reset`. Before the final report and
review, local `main` and `origin/main` were still
`98a4789e4b940d80fee20b47cd827fc4e0f4364d`, and the safety tag still peeled to
that same commit. The authorized final operation is a fast-forward of `main` to
the verified branch commit containing this report. The exact resulting SHA and
the triggered workflow result can only be observed after that push; they are
reported in the final handoff rather than asserted here before execution.
