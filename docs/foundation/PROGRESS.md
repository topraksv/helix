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

## Current phase status

- Phase 0: done — gate passed (34 skills; clean typecheck; 110/970 tests).
- Phase 1: done — gate passed (34 skills; clean typecheck; 110/970 tests).
- Phase 2: pending.
- Final verification: pending.
