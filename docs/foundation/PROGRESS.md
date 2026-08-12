# Foundation Reset Progress

This file is the cold-resume log for the unattended foundation reset on
`chore/foundation-reset`. Read it before resuming work.

## 2026-08-12 — Workspace safety established

- Did: confirmed the current branch is `chore/foundation-reset`, its HEAD is
  `1c22d5f`, it tracks `origin/chore/foundation-reset`, and the worktree is
  clean. Confirmed `main`, `origin/main`, and
  `safety/pre-context-reset-20260812` remain at rollback anchor `98a4789`.
- Proved: `git branch --show-current`, `git status --short --branch`,
  `git log -5 --oneline --decorate`, and `git worktree list --porcelain` all
  agree on the isolated branch and worktree.
- Left: complete Phases 0–2, run the required gate after each phase, commit and
  push each concern, then run the final gate and record the rollback command.

## 2026-08-12 — Memory-file checkpoint verified

- Did: ran the required control-plane, type, and test gate before committing
  the reset logs.
- Proved: `npm run control:check` checked all 34 installed skills; `npx tsc
  --noEmit` exited cleanly; `npx vitest run` passed 110 files / 970 tests in
  5.22 seconds.
- Left: commit and push this checkpoint, then begin Phase 0 evidence recovery.

## 2026-08-12 — Missing specification reconstructed

- Did: read every file containing a section citation plus the direct domain,
  repository, sync, auth, privacy, and integration tests that assert those
  contracts. Reconstructed only the cited sections in `docs/SPEC.md`.
- Proved: the 14 `spec §` source files account for the prompt's count; a wider
  citation search also found direct `§2.8` references, so the spec includes that
  tenth cited section and records the discrepancy in Decision D003.
- Left: verify Phase 0 after the baseline and security inventory are committed.

## 2026-08-12 — Baseline measurements captured

- Did: ran fresh timed unit, typecheck, coverage, clean web-export, and bundle
  checks under Node 22; recorded raw evidence plus coverage/mutation scope in
  `docs/foundation/BASELINE.md`. Inventoried all six named security controls in
  Decision D004.
- Proved: unit run 110 files / 970 tests, 5.57s wall; typecheck 4.40s wall;
  coverage 97.88% statements / 95.29% branches / 100% functions / 99.71%
  lines; bundle 3,380,216 entry JS / 4,009,981 total JS / 7,376,506 export
  bytes, within every enforced budget.
- Left: run the Phase 0 gate, commit the spec separately from measurement and
  decision evidence, and push both commits.

## 2026-08-12 — Phase 0 gate passed

- Did: ran `npm run control:check && npx tsc --noEmit && npx vitest run` after
  all Phase 0 artifacts were present.
- Proved: control check validated 34 skills and both lock/bridge layers;
  TypeScript exited cleanly; Vitest passed 110 files / 970 tests in 5.30s.
- Left: commit and push the reconstructed spec and the baseline/control record
  as separate concerns, then begin the instruction-layer audit.

## 2026-08-12 — Instruction layer consolidated

- Did: audited `AGENTS.md`, `CLAUDE.md`, all 34 installed skill names, and every
  upstream reference to a missing sibling. Reduced Claude's entry point to one
  imported source of truth, tightened routing to real tie-breaks, and stated a
  local substitute for each unavailable sibling without editing vendored
  content.
- Proved: lockfile, `.agents/skills/`, and `.claude/skills/` each resolve the
  same 34 skills; package, workflow, migration, browser/native E2E, and
  property-test evidence gives every installed specialist a distinct task
  surface. Decisions D005–D007 record why none were removed.
- Left: run the Phase 1 gate, commit and push the instruction audit, then begin
  the repository-hygiene inventory.

## 2026-08-12 — Phase 1 gate passed

- Did: ran `npm run control:check && npx tsc --noEmit && npx vitest run` after
  consolidating agent instructions and resolving missing-sibling routing.
- Proved: control check validated all 34 vendored skills, the Claude bridge,
  and the lockfile; TypeScript exited cleanly; Vitest passed 110 files / 970
  tests in 5.24 seconds.
- Left: commit and push the instruction-layer checkpoint, then inventory Phase
  2 hygiene candidates and prove every executable deletion independently.

## 2026-08-12 — Repository hygiene inventory completed

- Did: scanned empty directories, tracked-file hashes, assets, root scripts and
  configuration, source entry points, workflow references, and historical
  compatibility markers. Ran knip as advisory evidence and traced every
  candidate through source, tests, E2E, scripts, workflows, config, and the
  architecture rationale.
- Proved: knip's non-zero result named only two files inside immutable vendored
  skills and no repository-owned code or dependency; the only tracked duplicate
  hashes are the documented native-splash/OTA-brand pairs; the only empty
  directories are ignored Supabase CLI state. No safe deletion exists, so no
  deletion commit is warranted. Decision D008 records the full judgment.
- Left: commit the proposal-only source-move report, run the Phase 2 gate, then
  perform the required second sweep and final verification.

## 2026-08-12 — Source moves proposed, not executed

- Did: read the architecture contract and ranked three changes in
  `docs/foundation/PROPOSED-MOVES.md` by value and risk: backup/restore
  ownership, live-query internals, and category-icon policy placement.
- Proved: each proposal names its present dependencies, intended interface,
  preserved callers, risk, and approval conditions. The report also excludes
  intentional duplicate assets, root navigation aliases, root configuration,
  and size-only file splitting.
- Left: run the Phase 2 gate. No file, import, rename, or layer under `src/` was
  changed.

## 2026-08-12 — Phase 2 gate passed

- Did: ran `npm run control:check && npx tsc --noEmit && npx vitest run` after
  the hygiene verdict and proposal-only move report were complete.
- Proved: control check validated all 34 skills and both control-plane layers;
  TypeScript exited cleanly; Vitest passed 110 files / 970 tests in 5.25
  seconds. The Phase 2 diff contains documentation only.
- Left: commit and push the Phase 2 report, perform the required second sweep,
  run final verification, and record final status plus rollback instructions.

## 2026-08-12 — Second sweep tightened routing

- Did: rechecked every cited spec section, raw baseline transcript, changed
  path, commit, installed/bridged/locked skill name, and upstream skill-name
  reference across the complete branch diff.
- Proved: the branch changes only two root instruction files and five new
  documentation artifacts; source, tests, dependencies, configs, assets,
  workflows, and vendored skills remain byte-unchanged. Local/remote `main` and
  the peeled safety tag remain at `98a4789`. The sweep found two unresolved
  upstream aliases, now closed by Decision D010 and `AGENTS.md`.
- Left: obtain the independent review verdict, run final verification, record
  the ending status and rollback command, then commit and push the final log.

## 2026-08-12 — Independent review findings corrected

- Did: accepted the review's Important finding that `grill-me` and the missing
  `grilling` fallback formed a loop. Used the skills registry and CLI to add
  Matt Pocock's official `grilling` primitive for both Codex and Claude. Also
  corrected reconstructed §2.7 to match the dashboard's tested no-deduplication
  behavior and corrected the live-hook importer count from 35 to 34.
- Proved: registry/upstream evidence identifies `grilling` as the shared
  primitive behind `grill-me` and `improve-codebase-architecture`;
  `tests/dashboard-model.test.ts` expects 250.00 outgoing when the same 125.00
  subscription exists in both inputs; an exhaustive `rg -l` finds 34 source
  importers of `data/hooks`.
- Failure and recovery: a Claude-only CLI install created a copied skill
  directory, and `control:check` correctly failed because Helix requires a
  symlink. The directory was removed with the skills CLI and the skill was
  re-added in one Codex+Claude CLI operation, which produced the required
  canonical copy and symlink. A fresh control check then passed for 35 skills.
- Left: receive the review's final verdict, commit and push these corrections,
  run final verification, and record final status plus rollback instructions.

## 2026-08-12 — Clean-export evidence gap closed

- Did: accepted the review finding that `BASELINE.md` contained the bundle
  check but not the clean web-export transcript that produced `dist`. Reran
  `/usr/bin/time -p npx expo export -p web --clear` under Node 22 and inserted
  its complete raw output before the existing bundle transcript.
- Proved: the clean export completed 66 static routes and three web bundles in
  25.62 seconds wall time; its entry hash and sizes match the artifact measured
  by the recorded bundle check. Decision D013 records why the evidence was
  supplemented after review.
- Left: receive the final review verdict, commit and push all corrections, run
  final verification, and record final status plus rollback instructions.

## 2026-08-12 — Pinned-head review completed

- Did: received the independent read-only review of `1c22d5f..177661c`. Its
  verdict was not ready, with no Critical findings, three Important substantive
  findings, one Important expected finish-state gap, and one Minor count error.
- Proved: the substantive findings map exactly to the corrections above:
  missing/circular skill routing, the incorrect §2.7 deduplication claim, the
  missing clean-export transcript, and the hook-importer count. The remaining
  finish-state finding is resolved only by the final gate and status entry.
- Left: commit and push the evidence/spec corrections, obtain a scoped
  re-review, run final verification, and record rollback instructions.

## Current phase status

- Phase 0: done — gate passed (34 skills; clean typecheck; 110/970 tests).
- Phase 1: done — gate passed (34 skills; clean typecheck; 110/970 tests).
- Phase 2: done — no safe deletion; proposals recorded; gate passed (34 skills;
  clean typecheck; 110/970 tests).
- Final verification: pending.
