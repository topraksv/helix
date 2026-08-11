# Helix

Helix is a single-developer Expo SDK 54 application. This file is the small
bootstrap shared by Codex and Claude; source, tests and executable checks are
the authority for behavior.

## Authority and recovery

- Product truth: tracked source/tests, `package.json`/lockfile, migrations,
  schema, workflows and release configuration.
- Cross-cutting truth: `.ai/INVARIANTS.md` and `.ai/ROUTING.md`.
- Current operational state: `.ai/AI_HANDOFF.md`; replace it in place and keep
  claims source-linked and commit-aware.
- Skills: `.ai/skills/` is canonical. `.agents/skills/` and
  `.claude/skills/` are discovery symlinks, never separate bodies.
- `graphify-out/` and generated quality reports are advisory evidence/cache.

On a fresh or resumed session, read the handoff and run
`node .ai/scripts/check-memory-freshness.mjs`; then inspect `git status`, the
relevant diff and recent history. Read only the relevant invariant/routing
section and one lead skill.

## Scope and safety

Make the smallest complete change. Do not redesign unrelated product behavior,
refactor adjacent working code or add process for its own sake. Preserve
uncommitted work. Before deleting or archiving anything, prove its callers and
use an explicit, recoverable target. Never use force-push, hard reset, history
rewrite, `git clean -fdX/-fdx`, or destructive linked-database commands.

Domain, data, sync, auth, money, privacy and shared-UI contracts live in
`.ai/INVARIANTS.md`; do not duplicate or weaken them in a skill or local
procedure.

## Routing and research

Choose one lead skill and at most one independently necessary support skill.
Skill descriptions state their own triggers; `.ai/ROUTING.md` resolves
authority and overlap, not every trigger.

For version-sensitive, uncertain or externally defined decisions use:
repository reality → relevant local policy → current official primary source →
implementation. Do not browse ceremonially, but do not rely on remembering a
skill when current documentation is required.

For a codebase question, if `graphify-out/graph.json` exists, first run
`node .ai/scripts/check-graphify-freshness.mjs --required` and then the narrow
read-only `graphify query`, `path` or `explain` command. Verify material graph
claims against source and tests. After source edits, `graphify update .` is an
explicitly mutating refresh; it is not part of read-only query mode.

## Verification and shipping

Run `npm run control:check` and the risk-appropriate gate. Ordinary changes use
`npm run verify` plus the changed-behavior regression and
`npm run test:e2e:smoke`; high-risk or uncertain changes use
`npm run verify:full`. Report failed measurements as well as passed ones.
Before completion, review the diff, run `git diff --check`, update the handoff,
and make no success claim without fresh command output.

`main` is the only branch. Completed tracked changes land with a signed commit
and one push after local gates; CI and the published channels are watched to
completion. Local settings, hooks and private tool memory are execution
preferences, not project truth.

Code and identifiers are English; user-facing application text and final
reports are Turkish. Comments explain non-obvious constraints, not the line
below them.
