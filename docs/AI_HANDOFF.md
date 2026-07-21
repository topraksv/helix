# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Active branch: `audit/package-1-exhaustive`, based on
  `37a296ae538aac3167f4741776b68184ff44447c`; `main` and `origin/main` matched
  that SHA when the package began. Git log is the authority for the branch tip;
  the initial protected PR is the next release step.
- Last rollbackable web release: `37a296a`; Pages run
  [29819173507](https://github.com/topraksv/helix/actions/runs/29819173507)
  and CodeQL run
  [29819173437](https://github.com/topraksv/helix/actions/runs/29819173437)
  succeeded.
- Last recorded mobile release remains preview group
  `57630810-415a-4c21-9462-91e1c7fe12d9`, runtime `1.0.0`, at `2b6791c`.
  There is no production OTA. Installed-device acceptance remains `BLOCKED`.
- Linked Supabase has migrations `…01`–`…09`. Package migrations
  `…10_tombstone_only_client_deletes` and
  `…11_category_transfer_semantics` are intentionally pending protected merge;
  the linked dry-run lists only those two and sequential public-schema lint is
  clean.

## Package 1 work in progress

Every project-owned file has a disposition: 310 starting files plus 15 package
additions, 325/325 reviewed. The temporary audit ledger is
`.codex/package-1-ledger.md`; it is never committed and must be deleted only at
package close.

The worktree fixes proved defects in these groups:

- bounded native auth-session storage and post-refresh session-epoch ownership;
- real calendar-date, backup/import, favicon-host and notification fail-closed
  boundaries;
- tombstone-only authenticated Supabase access and persisted, rename-safe
  transfer-category semantics;
- one repository facade, atomic opening-balance writes and runtime-decoded
  synced settings;
- resolved live-data state, complete retry ownership, dirty-exit guards and
  failure-preserving async editors across every financial screen;
- awaited shared undo, centralized Turkish copy and manifest-wide privacy/test
  discovery;
- dependency compatibility, scoped modern `xcode` UUID, and seven-day routine
  package-publication quarantine;
- two generated composite outbox indexes: a 100,000-row same-harness probe
  changed batch reads 252.873→137.435 ms and acknowledgement reads
  1,123.757→0.943 ms; regression tests assert both query plans.

Current evidence: clean `npm ci`; typecheck; zero-warning lint; all 62 Vitest
files / 459 tests; `expo install --check`; Expo Doctor 18/18; Drizzle check;
Knip with only reviewed framework/generated/dynamic-import false positives; one
justified lazy-calculator Madge cycle; Jscpd reviewed; Semgrep 10 configs / 0
findings; Gitleaks 398 commits plus exact worktree manifest / 0 real secrets;
and OSV findings dispositioned. The final full release gate passed the 52-route
production export, every bundle budget, and 21/21 Playwright
visual/axe/behavior tests without baseline changes.

Production-export route UI-ready p50/p95 over ten rounds was dashboard
119.0/232.4 ms, cash flow 119.4/167.1 ms, Settings 119.0/124.7 ms, and
subscriptions 118.0/131.6 ms. Forty full route loads left documents at 1→1 and
reduced listeners, nodes, and used JS heap. Markdown validation found 9/9 files,
all relative targets/anchors, and all documented package scripts valid.

## Required next steps

1. Push this single branch, open the protected PR, wait for `quality`, and merge
   without bypass.
2. After merge, apply linked migrations 10–11, run list/lint/33-assertion pgTAP,
   regenerate `src/sync/database.types.ts`, and commit the generated result via
   the protected workflow.
3. Verify Pages and live routes; publish preview OTA from the final protected
   `main` SHA because runtime JS changed but native config/runtime did not.
   Record EAS metadata; installed delivery stays `BLOCKED` without device access.
4. Delete the temporary ledger and finish with a clean working tree.

## Known external limits

- Passwordless Supabase CLI pgTAP cannot read the `extensions` schema; use the
  documented Management API rollback transaction after merge if that remains
  true. Never claim 33/33 until it actually runs.
- Physical VoiceOver/TalkBack, Dynamic Type, notification scheduling,
  app-switcher timing and two-device sync require installed devices and remain
  `BLOCKED`, not silently treated as passed.
