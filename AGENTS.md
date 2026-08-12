# Helix

Helix is a single-developer Expo SDK 54 application: React Native plus React
Native Web, Supabase/Postgres with Drizzle and local `expo-sqlite`, Turkish
user-facing text, English code and identifiers.

Behavior is defined by the source and the tests, not by this file. There is no
separate rulebook, invariant document or handoff ritual: read the code, run the
checks, and let the installed skills carry the practice.

## Skills

Skills are vendored unmodified from upstream publishers into `.agents/skills/`.
`.claude/skills/` holds one symlink per skill and `skills-lock.json` records
each upstream source. Never edit a skill body or create a second copy; add,
update or remove one with the `skills` CLI and commit the result:

```sh
npx skills add <owner/repo> --skill <name>
npx skills update <name>
npx skills remove <name>
```

Skills are general-purpose guidance. Where one disagrees with this repository's
source, tests, migrations or installed package versions, the repository wins.

Preferred publishers, in order, when a skill could come from several places:
Anthropic, Matt Pocock, Vercel, Karpathy. Prefer an official upstream over a
mirror, and adoption over novelty.

Two skills are explicit-invocation only (`disable-model-invocation: true`) and
never fire on their own — ask for them by name:

- `grill-me` — a relentless interview that sharpens a plan or design before
  any code is written.
- `improve-codebase-architecture` — scans for deepening opportunities, reports
  them, then grills through the one you pick. Uses `codebase-design` for its
  vocabulary.

`find-skills` covers the rest: when something here has no skill, it searches the
registry and installs one.

## Routing

Each skill's description carries its own triggers, so read one skill, not the
shelf. This section adds only what a description cannot: the order of work and
the tie-breaks. Take one lead skill; add a support skill only when it is
independently necessary.

Work that is more than one step runs the loop before it runs the fix:
`brainstorming` (what is actually being asked) → `writing-plans`
(decomposition and done-criteria) → `executing-plans` or
`subagent-driven-development` (execution) → `requesting-code-review` →
`verification-before-completion`. Collapse a stage when the work genuinely is
one step; never collapse the last one, which gates every completion claim.
A broad request ("scan the project and fix X") is the case this loop exists
for: plan it, sweep it, verify it, then sweep again for what the fix moved.

Process skills set the approach and the specialist then carries it out:

| Overlap | Lead |
|---|---|
| SQL, schema, migration, index, RLS policy | `supabase-postgres-best-practices` |
| Supabase auth, Edge Functions, Storage, Realtime, CLI, logs | `supabase` |
| Slow list, re-render, animation, native module | `vercel-react-native-skills` |
| Bundle size, startup, caching, network, memory | `performance-optimization` |
| Reviewing the diff since a point | `code-review` |
| Wanting a reviewer on finished work | `requesting-code-review` |
| Acting on review feedback | `receiving-code-review` |
| Correct but overgrown, duplicated or dead code | `code-simplification` |
| Module seams and interface depth | `codebase-design` |
| A screen or component on native | `expo-native-ui` |
| The web target's markup and accessibility | `web-design-guidelines` |
| `AGENTS.md`, `CLAUDE.md`, a skill body | `writing-for-agents` |
| `docs/`, decision records, release notes | `documentation-and-adrs` |

Some skills name a sibling this repository does not install. Substitute:

- `test-driven-development` and `debugging-and-error-recovery` → `tdd` and
  `systematic-debugging`.
- `using-git-worktrees` and `finishing-a-development-branch` → neither applies:
  `main` is the only branch, so work happens in place and the run ends at
  `verification-before-completion` plus the authorization rule below. An
  instruction to branch, merge or clean up a worktree does not survive here.

## Checks

```sh
npm run verify        # skills, typecheck, coverage, lint
npm run verify:full   # verify + web export + bundle budget + browser E2E
npm run test:e2e:smoke
```

Report failed measurements as well as passed ones, and make no success claim
without fresh command output.

## Git

`main` is the only branch. Editing, staging, testing and read-only inspection
are the normal workflow. Commit, push, deploy, OTA, release and database
publish need the user's explicit authorization for the exact action in the
current task; release jobs additionally require a manual workflow dispatch that
names its target and the existing `helix` deployment environment.
