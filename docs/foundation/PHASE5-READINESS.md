# Phase 5 readiness survey

Date: 2026-08-13

Original survey measurement commit:
`ea872eda2c03c6115ae30c312238438e62bcfc0b`. Final-review budget and
seven-file coverage measurements use the test tree at
`fd83a8da7ab77ba4f2f761c23fa583b162be4bb3`; documentation corrections began
at `69d877bf35171d91a8bd0a1b47c2adbf0bc21785`.

Branch: `chore/foundation-reset`

## Outcome

Phase 5 has concrete security and reliability work to plan. This is a
repository survey, not a clean security verdict and not authorization to make
the proposed changes.

The immediate facts are:

- the committed lockfile produces a red native advisory audit: 15 findings,
  comprising 11 high and four moderate vulnerabilities;
- the installed registry tree passes npm's signature command, which reports
  1,130 verified registry signatures and 244 verified attestations, but this
  does not cover the CDN-sourced `xlsx` tarball or establish package safety;
- the five most recent `security.yml` runs shown by GitHub completed
  successfully on `main`, but they predate and do not exercise this branch's
  workflow change;
- all six controls indexed by `docs/ARCHITECTURE.md` still have their cited
  authority and an implemented defense; no authority-path drift was found;
- the server authorization design is owner-only RLS, explicit grants and
  owner-aware relational constraints, but this survey did not query the linked
  project and therefore does not prove deployed policy/configuration parity;
- the repository-write safety net is partial: 9/17 non-declaration repository
  implementations are mutation-hardened, `budgets.ts` is improved-partial, and
  fresh current V8 coverage remains thin for seven implementations while their
  mutation evidence remains the Phase 3 baseline; and
- the known cross-table outbox idempotency collision remains a production sync
  data-loss defect. This survey does not remediate it.

## Scope and evidence boundary

The survey read the committed manifests and lockfile, security workflow,
Supabase config/migrations/pgTAP source, auth/session/sync/storage/recovery/
notification/input boundaries, `docs/SECURITY.md`, and the Phase 3B closeout.
It ran only the requested native audit, signature, workflow-history, and normal
gate commands. No comprehensive dependency collector, `audit fix`, dependency
install/change, linked Supabase query, advisor, database test, workflow
dispatch, rerun, cancellation, deployment, or remediation occurred.

The npm output is a known-advisory match against the committed dependency
resolution. It does not prove vulnerable code is reachable. A successful
signature audit checks registry signatures and available attestations; it does
not prove that a package is benign, and lack of an attestation is not by itself
evidence of compromise. Repository migrations and pgTAP source express and
test the intended database state, but only a linked-state comparison can prove
the production project currently matches them.

## C1 — native dependency evidence

Both commands used Node `v22.23.2` and npm `10.9.8`.

### `npm audit`

Exit: **1**

```text
# npm audit report

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install drizzle-kit@0.18.1, which is a breaking change
node_modules/@esbuild-kit/core-utils/node_modules/esbuild
  @esbuild-kit/core-utils  *
  Depends on vulnerable versions of esbuild
  node_modules/@esbuild-kit/core-utils
    @esbuild-kit/esm-loader  *
    Depends on vulnerable versions of @esbuild-kit/core-utils
    node_modules/@esbuild-kit/esm-loader
      drizzle-kit  0.19.0 - 1.0.0-beta.1-fd8bfcc
      Depends on vulnerable versions of @esbuild-kit/esm-loader
      node_modules/drizzle-kit

image-size  *
Severity: high
image-size: ICNS parser allows denial of service through an infinite loop - https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
image-size: JXL and HEIF parsers allow denial of service through infinite loops - https://github.com/advisories/GHSA-5p2g-fcmc-qvqq
fix available via `npm audit fix --force`
Will install react-native@0.72.17, which is a breaking change
node_modules/metro/node_modules/image-size
  metro  >=0.22.1
  Depends on vulnerable versions of image-size
  Depends on vulnerable versions of metro-config
  Depends on vulnerable versions of metro-transform-worker
  node_modules/metro
    @expo/metro  *
    Depends on vulnerable versions of metro
    Depends on vulnerable versions of metro-config
    Depends on vulnerable versions of metro-transform-worker
    node_modules/@expo/metro
      @expo/cli  >=0.25.0-canary-20250612-338ef55
      Depends on vulnerable versions of @expo/metro
      Depends on vulnerable versions of @expo/metro-config
      node_modules/expo/node_modules/@expo/cli
      @expo/metro-config  >=0.21.0-canary-20250630-547cd82
      Depends on vulnerable versions of @expo/metro
      node_modules/expo/node_modules/@expo/metro-config
        expo  52.0.0-canary-20240625-2333e70 - 52.0.0-canary-20241018-f71b3e0 || >=54.0.0-canary-20250611-f0afe80
        Depends on vulnerable versions of @expo/cli
        Depends on vulnerable versions of @expo/metro
        Depends on vulnerable versions of @expo/metro-config
        node_modules/expo
    @react-native/community-cli-plugin  *
    Depends on vulnerable versions of metro
    Depends on vulnerable versions of metro-config
    node_modules/@react-native/community-cli-plugin
      react-native  >=0.73.0-nightly-20230506-1af868c52
      Depends on vulnerable versions of @react-native/community-cli-plugin
      node_modules/react-native
        react-native-reanimated  4.1.7 || >=4.2.3
        Depends on vulnerable versions of react-native
        node_modules/react-native-reanimated
    metro-config  *
    Depends on vulnerable versions of metro
    node_modules/metro-config
    metro-transform-worker  >=0.60.0
    Depends on vulnerable versions of metro
    node_modules/metro-transform-worker

15 vulnerabilities (4 moderate, 11 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force
```

The lockfile resolves the cited `esbuild` instance to `0.18.20`, dev-only
under `@esbuild-kit/core-utils`/`@esbuild-kit/esm-loader`/`drizzle-kit`. It
resolves the cited `image-size` instance to `1.2.1` under Metro. The output's
suggested force resolutions cross the repository's declared Expo/React Native
or Drizzle Kit compatibility choices; they are not safe remediation evidence.
`docs/SECURITY.md` already records the narrower accepted reachability claims
and the `image-size` re-review deadline of 2026-09-08. Those dispositions need
fresh Phase 5 validation; this survey did not re-prove reachability.

The raw combined stdout/stderr is retained in the ignored artifact
`.superpowers/sdd/phase0-4-closeout-plan/task-16-npm-audit.log` (3,183 bytes,
SHA-256 `ea26d4b87673ceb11056928c3f1b1a6ba564d7fa254b162d89debd609394d693`).
The exit artifact is `task-16-npm-audit.exit` (2 bytes, SHA-256
`4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`).

### `npm audit signatures`

Exit: **0**

```text
audited 1130 packages in 7s

1130 packages have verified registry signatures

244 packages have verified attestations
```

The workflow comment records an earlier measurement of 1,339 verified
signatures and 240 attestations. The current command reports 209 fewer verified
signatures and four more attestations. The command still exits zero, and the
workflow does not assert either count. The delta requires investigation before
using the comment as a regression threshold; this survey does not infer that
209 packages became untrusted because the installed-tree composition and npm
measurement semantics also affect the count.

The raw combined stdout/stderr is retained in
`.superpowers/sdd/phase0-4-closeout-plan/task-16-npm-audit-signatures.log`
(118 bytes, SHA-256
`31ed3bb4eb45a53ddd6f2766803bb383bfea5454beb077c8d9c0b35421fb4b45`).
The exit artifact is `task-16-npm-audit-signatures.exit` (2 bytes, SHA-256
`9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`).

## C2 — `security.yml` status evidence

Command: `gh run list --workflow=security.yml --limit 5`

Exit: **0**

```text
completed success chore(quality): refresh recovery evidence             security main push 31589187401 1m11s 2026-08-12T10:50:22Z
completed success fix(ci): install execution guard before quality gate   security main push 31582905875 1m37s 2026-08-12T09:26:23Z
completed success refactor: simplify RUN 2 production code               security main push 31581488730 1m43s 2026-08-12T09:07:32Z
completed success chore: harden AI execution authority                   security main push 31528866234 1m39s 2026-08-11T19:38:26Z
completed success fix(control-plane): align freshness boundaries         security main push 31498700249 1m47s 2026-08-11T13:54:58Z
```

The raw tab-delimited output is retained in
`.superpowers/sdd/phase0-4-closeout-plan/task-16-gh-security-runs.log`
(600 bytes, SHA-256
`08a878ceffaf3ea92389f2937c2d1ec51e548210722f48ae523c47b317911959`).
The exit artifact is `task-16-gh-security-runs.exit` (2 bytes, SHA-256
`9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`).

These five successful runs are evidence for earlier `main` commits only.
Current `main` is `98a4789`, while this branch is `ea872ed`. This branch changes
the dependency job from the disposition-aware checker on `main` to
`npm audit --audit-level=high`. The C1 result contains 11 high findings, so the
current branch's dependency job is expected to be red if exercised unchanged.
That is an inference from the workflow and native audit, not a workflow run;
no workflow was dispatched or rerun.

## C3 — six durable security controls

Exactly the six rows in `docs/ARCHITECTURE.md` were re-verified. All cited
paths exist. **Authority-path drift: 0/6.**

| Control | Current implementation evidence | Result |
| --- | --- | --- |
| Session epoch | `src/sync/session-epoch.ts` binds an abort signal and monotonically changing epoch to one user, invalidates it on account change/stop, and drops late task results. `src/sync/engine.ts` checks the token before/after network and transaction boundaries, registers account-scoped background tasks, and waits for them during stop. `src/auth/session.ts` stops the epoch before workspace wipes/switches and re-registers recovery work only under the same user. | Present; cited authorities and stated defense agree. |
| `tombstone_version` | Migration 12 adds a non-negative generation to the original 16 synced tables and makes the server trigger preserve newer generations; migration 16 creates the three investment tables with the same column and trigger. `src/sync/merge-policy.ts` makes generation precedence dominate timestamps, and the engine validates non-negative safe integers before merge. | Present; cited shorthand “migration 12” remains accurate for the control's introduction. |
| Verification brake | `src/auth/verification-brake.ts` keys the five-failure/30-second cooldown to one account. `src/auth/session.ts::verifyPassword` checks and updates that state and rejects a successful re-auth result belonging to another user. | Present; no ownerless cooldown drift. |
| Account freeze | `src/auth/freeze.ts` writes the flag, requires successful sync and an empty outbox, signs out, and attempts rollback on returned and thrown failures while reporting rollback failure. `src/app/account-security.tsx` supplies the real effects; `tests/account-freeze.test.ts` covers the failure phases. | Present; failure paths remain explicit. |
| Chunked SecureStore | `src/sync/secure-chunked-storage.ts` limits values to 64 chunks of 1,900 characters, validates the marker, rejects missing chunks and oversize values, and bounds cleanup. `src/sync/supabase.ts` uses it for native persisted sessions. | Present for bounded/complete reads. Interrupted replacement of an already chunked value is not generation-tagged or checksummed and has no explicit crash-atomicity test; treat that as a Phase 5 proof gap, not as evidence that mixed data is accepted by Supabase. |
| Install-script allowlist | `tests/install-scripts.test.ts` walks the installed tree, fails on a new package family with `preinstall`/`install`/`postinstall`, and also fails when an allowlisted package disappears. The current allowlist is exactly `esbuild` and `unrs-resolver`. | Present; it controls which installed packages execute hooks, not whether their code is safe. |

## C4 — authorization, session and repository-write map

Here **INSIDE** means a source file is actually included in the critical
per-file V8 gate and/or has file-level Stryker evidence accepted for a
hardening verdict. The four newly hardened repository files have scoped
zero-timeout results; auth recovery's file-level result is the zero-timeout row
from the historical one-shot broad artifact at `6c8f4aa`. A regular Vitest
case is useful behavior evidence, but it remains **OUTSIDE** that hardened net
when its source has neither form of evidence.

| Boundary / owner | Existing safety net | Test-net placement | Evidence limit or gap |
| --- | --- | --- | --- |
| Supabase authorization | Nineteen synced public tables have owner-only SELECT/INSERT/UPDATE policies restricted to `authenticated`; UPDATE has both `USING` and `WITH CHECK`. Explicit grants remove anon access and client DELETE. Owner-aware composite foreign keys prevent cross-owner references. `diagnostic_events` is owner-scoped and append-only to clients. `delete_own_account()` accepts no target id, uses `auth.uid()`, and has an explicit authenticated-only execute grant. | **OUTSIDE the normal app gate and deployed-parity proof.** `supabase/tests/owner_integrity_and_rls.sql` declares 138 pgTAP assertions. `.github/workflows/database.yml` runs the local-stack suite separately; `tests/release-config.test.ts` checks that workflow wiring, not the SQL assertions themselves. Neither `npm run verify` nor the exact prompt gate executes pgTAP. | This survey inspected migrations/test source and did not run a Supabase stack, linked tests, migration parity, or advisors. Production RLS/grant parity is unproved here. |
| Supabase Auth configuration and recovery | Repo config uses exact recovery redirects, one-hour JWT expiry, refresh-token rotation with a ten-second reuse interval, confirmed e-mail, secure password change, anonymous sign-in off and an eight-character minimum. The client uses PKCE and only public Expo variables. | **MIXED.** `src/auth/recovery.ts` is **INSIDE Stryker** and mutation-hardened at 98.31% (116 killed, 0 timeout, 2 survived, 0 no coverage). That is the zero-timeout per-file row from the historical one-shot broad artifact at `6c8f4aa`, not a current scoped rerun; the source is outside the critical per-file V8 list. `tests/auth.test.ts` and `tests/password-recovery-security.test.ts` provide regular recovery/config tests. Broader auth files exercised by `tests/auth.test.ts`, `tests/verification-brake.test.ts`, and `tests/account-freeze.test.ts` are **OUTSIDE** per-file coverage and Stryker. | `supabase/config.toml` is local desired/config evidence, not proof of dashboard settings. CAPTCHA, password requirements beyond length, DB network restriction and SSL enforcement are not enabled in this file; leaked-password protection, session timebox, MFA and production SMTP remain plan/owner decisions recorded in `docs/SECURITY.md`. |
| Auth/session and local workspace | `LOCAL_OWNER_KEY` binds SQLite to one account. A different owner stops sync, clears account device state and wipes the workspace before activation. Sign-out first protects pending outbox rows, then stops/awaits account work, clears notifications and workspace, and ends the session. Remote `SIGNED_OUT` cleanup captures the owner and leaves a wipe-pending marker if local deletion fails. Recovery sessions are bound to the exact account. | **OUTSIDE the hardened net.** `tests/password-recovery-session.test.ts`, `tests/session-reauth.test.ts`, and `tests/session-delete-failure.test.ts` exercise `src/auth/session.ts`; `tests/session-epoch.test.ts` and `tests/session-task.test.ts` directly exercise `src/sync/session-epoch.ts`; `tests/session-cleanup-order.test.ts` pins cleanup ordering. Those session, epoch, engine and cleanup surfaces are absent from both the critical per-file list and Stryker, and the session tests mock `src/sync/engine.ts` rather than mutation-testing its orchestration. | Offline bootstrap deliberately trusts the persisted local owner when the network is unavailable; local confidentiality therefore rests on the device/browser boundary and optional biometric lock. Web Supabase session storage inherits browser-profile access, an accepted residual risk. |
| Local repository writes | `writeRowBatchesAtomically` stamps the active `userId`, refuses ownership conflicts, preserves immutable creation time, resolves tombstone generations, and writes each row plus its outbox snapshot inside the same serialized transaction. `writeRowsValidated`, live-row and restorable-row guards place relation/state checks inside that transaction. | **MIXED: 9/17 INSIDE.** The real-SQLite suites including `tests/accounts-repository.test.ts`, `tests/categories-repository.test.ts`, `tests/computed-repository.test.ts`, and `tests/transactions-repository.test.ts` underpin nine mutation-hardened repository implementations. `budgets.ts` remains partial at 88.50% branch coverage and 93.81% scoped mutation. The seven **OUTSIDE/untouched** implementations are `expected.ts`, `imports.ts`, `installments.ts`, `investments.ts`, `maintenance.ts`, `onboarding.ts`, and `rules.ts`; Phase 3B now records their fresh current V8 counts. | Local ownership/outbox assertions are RLS-adjacent defense in depth, not execution of Postgres policies. The partial budget result and seven untouched writers prevent a repository-wide hardening claim. |
| Outbound sync | Events are selected per table, parsed, owner-checked and reduced to the newest row snapshot. `prepareOutboundBatch` rejects unknown columns and invalid domain shapes; rejected rows enter `sync_dead_letters`. Acknowledgements are revalidated for shape/owner and do not overwrite a newer local event. Session tokens are checked around I/O and transactional acknowledgement. | **MIXED, with orchestration OUTSIDE.** Hardened domain schemas and the 9/17 repository writers cover part of the owner-bearing row shape. Regular `tests/sync-outbound.test.ts` and `tests/multi-client-sync.test.ts` exercise `src/sync/outbound-validation.ts`. However `src/sync/engine.ts`, `src/sync/outbound-validation.ts`, and the dead-letter orchestration are outside per-file coverage and Stryker. | `idempotency_key` is only `{rowId}:{updatedAt}`. Two tables using the same table-local ID at the same timestamp collide; the conflict update changes only payload/time and leaves the first table identity. One event is displaced. This known production data-loss defect is still open. |
| Pull/merge | PostgREST access relies on RLS; the client additionally requires a UUID-shaped id, matching `user_id`, valid timestamp, non-negative generation and full import-row shape before merging. Unknown server columns are ignored. A page is fully validated and transactionally merged before its composite cursor advances. | **OUTSIDE sync hardening.** `tests/sync-merge.test.ts`, `tests/tombstone-generation.test.ts`, `tests/sync-dead-letters.test.ts`, and `tests/multi-client-sync.test.ts` provide regular policy/schema behavior tests, but `src/sync/merge-policy.ts`, `src/sync/status.ts`, and `src/sync/engine.ts` are absent from the per-file and mutation scopes. | Client checks are defense in depth, not authorization. A deployed RLS/grant drift would remain a server-boundary incident even if a client happens to reject the returned row. |
| Direct diagnostics write | The upload port filters rows to the current user. Server RLS re-checks ownership, constraints reject free text/device identifiers, and client roles cannot update/delete the incident log. | **OUTSIDE server-policy proof in the normal gate.** `tests/diagnostics-upload.test.ts` covers client filtering and failure behavior; the authoritative owner/write policy remains in the unexecuted-here pgTAP surface. | Upload failure is deliberately non-blocking and no external alerting exists. This is an accepted observability limit, not proof that failures are absent. |

The outbox collision is both a reliability and security-boundary concern: it
can silently omit one owner-authorized financial mutation even though RLS and
per-row validation are correct. RLS cannot recover a client event that never
reaches the server.

## Trust-boundary inventory for Phase 5

- **Recovery links:** bearer material crosses from an external URL into Auth.
  `src/auth/recovery.ts` requires the exact production web origin/base route or
  `helix://reset-password`, rejects userinfo/ports/sibling routes, and accepts
  only a PKCE code or a recovery-typed token pair. Session code then rejects a
  recovery identity different from the open workspace.
- **Native session storage:** Supabase session JSON crosses SecureStore's
  multi-key adapter. Reads are bounded and require every declared chunk;
  interrupted overwrite behavior needs explicit Phase 5 evidence.
- **Remote sync rows/outbox:** SQLite JSON and PostgREST rows cross in both
  directions. Table-aware schema/owner checks, dead letters, RLS and epoch
  guards exist; the outbox identity defect bypasses none of them and instead
  loses an event before transmission.
- **Imports and forms:** repository validation is the write boundary; UI
  `maxLength` is not treated as authority. JSON restore has 15 MiB/100,000-row
  bounds and validates all relationships before writing. Workbook parsing has
  upload, ZIP entry/expansion/ratio, sheet/row/column/cell and text bounds.
- **External rates/market feed:** fixed HTTPS/WSS hosts feed bounded/validated
  rate and quote parsers. These values can influence financial calculations,
  so payload size/cardinality, date and freshness remain security-reliability
  inputs rather than trusted provider facts.
- **Notifications:** current notifications are local schedules. The OS payload
  contains title/body only—no route, row id or action data. Detail is a
  device-local opt-in; disabling it or crossing an account boundary clears
  scheduled and delivered notifications. Any future notification response or
  navigation data would create a new untrusted deep-link boundary.

## Grounded candidate Phase 5 proposals

These are candidate scopes, not an execution order or approval to change code,
dependencies, Supabase, delivery workflows, or device configuration.

1. **Resolve dependency and workflow posture.** Reproduce the two advisory
   paths under the actual build/dev surfaces, decide whether the existing
   `esbuild` and `image-size` dispositions still satisfy the release policy,
   and test only Expo-compatible matrix changes. Reconcile the branch's raw
   high-severity audit job with the recorded accepted-advisory mechanism so CI
   blocks new reachable findings without becoming permanently red. Investigate
   the 1,339-to-1,130 signature-count delta and define a reproducible assertion
   if the count is intended as a guard. Check `xlsx@0.20.3` against the vendor
   advisory source because npm audit/signatures do not cover its CDN release.

2. **Correct the cross-table outbox identity defect.** Design the identity and
   stored-key migration together, with real-SQLite tests for same-id,
   same-timestamp writes across different tables and for existing queued rows.
   Preserve atomic row/outbox behavior and per-table push order. This is the one
   known production defect in the survey; no incorrect collision outcome
   should be normalized as expected behavior.

3. **Attest RLS/Auth against deployed state.** Under separate linked-project
   authority, compare migration versions, lint `public`, run the 138-assertion
   pgTAP suite, run Supabase advisors, and inventory actual grants, policies,
   functions and Auth settings. Explicitly cover all 19 synced tables,
   `diagnostic_events`, `delete_own_account()`, default privileges, redirect
   allowlists and token/session settings. Record dashboard-only differences
   instead of treating `config.toml` as production evidence.

4. **Close the repository-write evidence gap by risk.** Continue from Track
   A/B's truthful 9/17 result: finish `budgets.ts` without using the impossible
   same-table duplicate fixture, then prioritize the seven untouched write
   implementations by ownership, graph breadth and rollback impact. Keep
   real-SQLite row/outbox/no-write/rollback assertions and scoped zero-timeout
   mutation evidence as the bar; do not lower thresholds or convert timeouts
   into improvement claims.

5. **Strengthen mobile bearer and deep-link evidence.** Exercise native
   SecureStore interruption/replacement and device-lock/reinstall cases; decide
   whether generation-tagged or integrity-checked chunks are needed from the
   result. Exercise cold/warm exact-target recovery links, one-time code races,
   foreign-account recovery, replay/expiry and browser-to-Expo handoff on real
   builds. Keep recovery credentials out of the Expo Go handoff.

6. **Attest notification privacy on devices.** Verify permission remains
   settings-initiated, detail remains opt-in, OS lock-screen previews match the
   neutral/detailed choice, and account switch/sign-out clears scheduled and
   delivered content on iOS and Android. If response payloads or navigation are
   introduced, specify an allowlisted typed payload before adding them.

7. **Finish trust-boundary validation where data can affect writes.** Extend
   adversarial/property evidence around sync rows, backup/remap relationships,
   workbook containers and provider payload size/cardinality/freshness. Focus
   on paths feeding repositories or financial conversion, and preserve current
   fail-closed size and ownership limits. This is bounded boundary work, not a
   generic validation rewrite.

## Readiness disposition

Phase 5 is ready for scoped planning, not for an unqualified release-security
claim. The first plan must account for the red native audit/current workflow
mismatch and the open outbox collision. RLS/Auth attestation and the partial
repository test net bound every later claim. No finding in this survey grants
authority to apply a fix, change a provider setting, publish a migration, or
dispatch a workflow.
