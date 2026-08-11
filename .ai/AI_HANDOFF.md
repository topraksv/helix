# Helix handoff

Replace this file in place. It is the short, current-state handoff for fresh
Codex and Claude sessions; source code, tests and current official docs win over
memory. Stable contracts live in `AGENTS.md`, `.ai/ROUTING.md` and
`.ai/INVARIANTS.md`.

## Current state

updated_at: 2026-08-11T16:45:24+0300
verified_at_commit: 4b2fbfb
working_tree: RUN 1 control-plane reconstruction is locally complete; signed commit and push remain
branch: main, currently at 4b2fbfb
release_mode: single test environment; existing GitHub Pages and Expo Go preview OTA remain the release surfaces
quality_scores:
  - tracked audit: 90/125 controls, 7.20/10; baseline 76/125, 6.08/10
source_paths:
  - AGENTS.md
  - CLAUDE.md
  - .ai/INVARIANTS.md
  - .ai/ROUTING.md
  - .ai/AI_HANDOFF.md
  - .ai/skills/
  - .ai/scripts/check-skills.mjs
  - .ai/scripts/check-graphify-freshness.mjs
  - scripts/quality-audit.mjs
  - quality/audit.json
  - package.json
  - .github/workflows/ci.yml

RUN 1 changes are control-plane only: no `src/` or production app behavior was
changed. Twenty canonical skills now live under `.ai/skills`; `.agents/skills`
and `.claude/skills` are symlink bridges to those same bodies. A Codex canary
discovered the bridge successfully; Claude's local runtime is not installed.

## Last completed

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - .ai/skills/
  - .ai/scripts/check-skills.mjs
  - .ai/scripts/check-memory-freshness.mjs

- Merged code simplification into `repo-cleanup`; merged frontend design and
  web guidelines into `visual-system`; removed inactive prototype, review-
  receiving and duplicate verification/research skill bodies.
- Kept code review as an independent review-only skill. Kept property testing
  on TypeScript plus fast-check and Helix invariants. Kept Playwright bounded to
  Helix React/Expo web browser E2E, accessibility, auth/import and CI concerns.
- Rewrote `AGENTS.md`, `CLAUDE.md`, routing, invariants and the active skill
  bodies as short pointers and procedures. Current official Codex/Claude skill
  discovery was checked before choosing the symlink bridge.
- Made `quality/audit.json` and `scripts/quality-audit.mjs` the only quality
  model/writer path. Removed the retired Graphify quality model and renderer;
  current quality output is `graphify-out/QUALITY_KANBAN.html`.
- Added `control:check` to verify skill parity and optional Graphify freshness;
  wired it into `verify` and CI. Quality evidence is exact at the audited HEAD,
  or explicitly reports a control-plane-only metadata delta.

## Evidence

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - package.json
  - .github/workflows/ci.yml
  - e2e/

- `node .ai/scripts/check-skills.mjs`: 20 canonical skills and both discovery
  bridges pass exact-body, symlink and frontmatter checks.
- `node .ai/scripts/check-memory-freshness.mjs`: 7/7 sections fresh.
- `node .ai/scripts/check-graphify-freshness.mjs --required`: current Graphify
  graph at `4b2fbfb`, with 479 manifest sources.
- `npm run quality:audit`: 90/125, 7.20/10; one current quality writer.
- `npm run verify:full`: 112 test files, 1,023 tests; coverage 97.89%
  statements, 95.29% branches, 100% functions and 99.71% lines; production
  export and bundle budgets passed; full E2E 114/114 passed.
- The first post-edit full-E2E attempt had one transient Chromium `NaN`
  `fontSize` assertion in `e2e/ui-consistency.spec.ts:1108`; the isolated test,
  three repeats, and a fresh full-E2E rerun all passed. No product source
  changed in response; the failed measurement remains recorded here.
- `git diff --check` passed before the final staging review.

## Open work

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - .github/workflows/ci.yml
  - package.json

- Commit and push the pending Graphify freshness fix; the CI checkout fix is
  already in local commit `51794a0` but is not yet on `origin/main`. Then watch
  the replacement CI/release channels to completion. The first remote run
  reached `classify` and `control:check` but stopped at `quality:audit` because
  the quality job's shallow checkout could not resolve the audited parent; the
  security workflow passed.
- Claude runtime activation could not be exercised locally because no `claude`
  binary is installed; official symlink support and the filesystem bridge were
  checked, while Codex discovery was exercised directly.
- Existing product backlog remains unchanged: physical-device/WebKit acceptance,
  SMTP recovery round trip, runtime health observation, backup/PITR drill, DAST/
  MASVS review, rollback drill and weekly income recurrence.

## Known blockers and risks

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - package-lock.json
  - scripts/check-advisories.mjs

- The two accepted `image-size@1.2.1` advisories remain until 2026-09-09;
  there is no patched release in the relevant range and the proposed
  Expo-managed downgrade is not acceptable.
- Graphify output is generated and advisory. Required consumers must run the
  freshness check; `graphify update .` is the only mutating refresh path.
- Bundle budgets remain intentionally narrow. No new production or native
  behavior is included in this slice.

## Rejected approaches that still matter

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - AGENTS.md
  - .ai/ROUTING.md
  - scripts/quality-audit.mjs

- Do not recreate duplicate Codex/Claude skill bodies; use the canonical body
  and a checked symlink/adapter bridge.
- Do not restore prototype, broad review-receiving, duplicate completion or
  duplicate research procedure skills without a recurring, evidenced need.
- Do not treat Graphify, session memory or generated quality HTML as canonical
  project truth. Do not add a second quality model or writer.
- Do not make current-document research a matter of remembering a skill: use
  repository reality, local procedure, current official primary sources, then
  implementation.

## Current release state

updated_at: 2026-08-11T16:11:28+0300
verified_at_commit: 4b2fbfb
source_paths:
  - app.json
  - package.json
  - .github/workflows/ci.yml

- Local `main` is at signed commit `51794a0`; `origin/main` is at `a845382`.
  The RUN 1 control-plane change and CI checkout fix are pushed only through
  `a845382`; the Graphify freshness fix is staged for the next signed push.
- Web remains published on GitHub Pages and mobile remains an Expo Go preview
  OTA; no standalone binary or store submission exists.
- No linked/remote Supabase migration or production database mutation is part of
  RUN 1.
