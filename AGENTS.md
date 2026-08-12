# Helix

Helix is a single-developer, offline-first personal finance application.
User-facing text is Turkish; code and identifiers are English.

Source, tests, migrations, and installed package versions override general
skill advice. Do not restate facts that can be read from those sources.
`docs/ARCHITECTURE.md` owns stable module boundaries and their rationale; read
it before a change crosses a boundary, not for routine work.

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
source, tests, migrations, or installed package versions, the repository wins.
When several skills cover the same need, prefer Anthropic, Matt Pocock, Vercel,
then Karpathy; prefer an official upstream over a mirror, and adoption over
novelty.

Two skills are explicit-invocation only (`disable-model-invocation: true`) and
never fire on their own — ask for them by name:

- `grill-me` — a relentless interview that sharpens a plan or design before
  any code is written.
- `improve-codebase-architecture` — scans for deepening opportunities, reports
  them, then grills through the one you pick. Uses `codebase-design` for its
  vocabulary.

`find-skills` covers requests with no installed specialist.

## Routing

Each skill's description carries its own triggers, so read one skill, not the
shelf. This section adds only what a description cannot: the order of work and
the tie-breaks. Take one lead skill; add a support skill only when it is
independently necessary.

Multi-step implementation runs this loop:
`brainstorming` (what is actually being asked) → `writing-plans`
(decomposition and done-criteria) → `executing-plans` or
`subagent-driven-development` (execution) → `requesting-code-review` →
`verification-before-completion`. Do not skip a triggered skill. A user-supplied
approved design or plan satisfies that skill's approval checkpoint, but not an
applicable specialist or final verification. Broad sweeps get a second scan
after the fix for anything the change moved.

Process skills set the approach and the specialist then carries it out:

| Overlap | Lead |
|---|---|
| SQL, schema, migration, index, RLS | `supabase-postgres-best-practices`; add `supabase` only for service, auth, CLI, or logs |
| Native UI, routing, performance | `expo-native-ui`, `expo-router`, or `vercel-react-native-skills`, according to the changed surface |
| Diff review, finished-work review, review feedback | `code-review`, `requesting-code-review`, or `receiving-code-review`, according to the workflow stage |
| Clarity refactor versus module seams | `code-simplification` for the former; `codebase-design` for the latter |
| Agent instructions versus project documentation | `writing-for-agents` for the former; `documentation-and-adrs` for the latter |

Some skills name a sibling this repository does not install. Substitute:

- A `superpowers:<name>` pointer → the installed `<name>` skill when it exists.
- `test-driven-development` and `debugging-and-error-recovery` → `tdd` and
  `systematic-debugging`, including namespaced references.
- `code-review-and-quality` → `code-review` for a fixed Git range or
  `requesting-code-review` for a completed-work reviewer.
- `api-and-interface-design` and `domain-modeling` → `codebase-design`; record
  lasting decisions with `documentation-and-adrs`.
- `deprecation-and-migration` and `shipping-and-launch` →
  `git-workflow-and-versioning` plus `documentation-and-adrs`; the authorization
  rule below still governs any release action.
- `using-git-worktrees` and `finishing-a-development-branch` → neither applies:
  work in the authorized checkout and end at `verification-before-completion`
  plus the authorization rule below.
- `setup-matt-pocock-skills` → do not run it; for `code-review`, use the task's
  issue or specification for the Spec axis and this file for Standards.
- `frontend-design` → `expo-native-ui`; `mcp-builder` → `find-skills`.
- `elements-of-style:writing-clearly-and-concisely` and
  `report-writing:writing-style` → `writing-for-agents` or
  `documentation-and-adrs`, according to the document.
- `eas-app-stores` → `find-skills`, and install an official store-release skill
  only for explicitly authorized production-store work.
- `expo-skill-feedback` → use the feedback command embedded in the Expo skill
  that detected the repeated failure.

## Checks

Use `npm run verify` as the routine completion gate. Use `npm run verify:full`
when web export, bundle, browser behavior, or release surfaces changed. Report
failed measurements as well as passed ones, and make no success claim without
fresh command output.

## Git

The project default is in-place work on `main`; an exact user-authorized branch
overrides it. Do not create a branch or worktree because a generic skill says
to. Editing, staging, testing, and read-only inspection are normal. Commit,
push, deploy, OTA, release, and database publish need explicit authorization
for the exact action in the current task. Release jobs additionally require a
manual workflow dispatch naming its target and the existing `helix` deployment
environment.
