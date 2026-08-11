# Helix control-plane routing

This file owns authority, overlap and freshness rules. Skill descriptions own
their individual triggers; this file does not copy them.

## Authority

1. Current repository source, tests, package/lock, migrations/schema, CI and
   release configuration.
2. `.ai/INVARIANTS.md` for source-linked domain, security, privacy and UI
   contracts; `.ai/AI_HANDOFF.md` for current operational state.
3. Current official primary documentation for version/provider-sensitive facts.
4. The selected skill body and its on-demand references.
5. Graphify output, tool-local memory, session history and generated quality
   reports as advisory or historical evidence only.

When a lower layer conflicts with a higher one, follow the higher layer and
repair or narrow the lower layer. Never turn an inferred graph or stale skill
claim into project truth.

## Session sequence

Read `AGENTS.md`, the handoff freshness result, Git state and the relevant
invariant slice. Load skill metadata first, then one lead body. Add one support
body only when its trigger is independently met. A third skill means the task
boundary is not understood and should be split or narrowed.

## Skill bridge and ownership

Canonical bodies live under `.ai/skills/<name>/SKILL.md`. Codex scans
`.agents/skills`; Claude scans `.claude/skills`; both directories contain only
relative symlinks to the canonical directory. `node .ai/scripts/check-skills.mjs`
checks the body contract and bridge target equality. Do not edit a symlinked
adapter or create a tool-specific copy.

Use these ownership boundaries when descriptions overlap:

- `code-review-and-quality`: independent review findings and acceptance;
  `repo-cleanup`: explicit, reversible maintenance and behavior-preserving
  simplification.
- `visual-system`: Helix visual lead, including the on-demand web audit;
  `expo-native-ui`, `native-interaction` and `mobile-accessibility` are
  platform/interaction/accessibility specialists.
- `expo-native-ui`: native surface implementation; `expo-router` is routing
  support; `expo-data-fetching` is network/cache/cancellation support.
- `financial-data-integrity`: ledger/domain meaning; `security-and-hardening`,
  `dependency-security` and `supabase-postgres-best-practices` own their
  respective trust boundaries.
- `playwright-best-practices`, `property-based-testing`, `tdd` and
  `systematic-debugging` are test/debug specialists, not universal gates.
- `platform-release-acceptance` owns delivery-surface evidence. Completion
  requirements live here and in executable checks, not in a universal skill.
- `graphify` is optional structural navigation; it never proves correctness,
  ownership, dead code or quality.

## Research policy

For uncertain, version-sensitive or externally defined technical decisions,
follow repository reality → relevant local procedure → current official
primary source → implementation. Record the source/version and the uncertainty
when it materially affects the decision. Current official documentation outranks
stale local skill prose. Research is required by the decision, not by selecting
a particular skill.

## Completion policy

`npm run control:check` validates the canonical skill bridge and optional
Graphify state. `npm run quality:audit` validates the one tracked
`quality/audit.json` ledger against the current product source snapshot;
`npm run quality:report` is its only HTML writer. The retired Kanban model and
renderer are not inputs to current acceptance. Use `npm run verify` or
`npm run verify:full` according to `AGENTS.md`, plus `git diff --check` and a
fresh handoff before claiming completion.

## Graphify boundary

Before relying on `graphify-out/graph.json`, run:

```sh
node .ai/scripts/check-graphify-freshness.mjs --required
```

The check requires the graph commit to match the source snapshot, or to differ
only by a declared control-plane delta; it also checks manifest coverage and
the manifest scan timestamp. Query/path/explain are read-only. `graphify
update .` is a separate, visible refresh step after source edits; it may mutate
ignored generated output and must never silently run during a query.
