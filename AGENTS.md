# Helix

Helix is a single-developer, offline-first personal finance application.
User-facing text is Turkish; code and identifiers are English.

Source, tests, migrations, and installed package versions define behavior.
`docs/SPEC.md` reconstructs the product sections cited by source files;
`docs/ARCHITECTURE.md` records only boundaries and decisions that are not safe
to infer. Read the latter before changing a boundary or removing an apparently
redundant control.

## Skills

Skills are unmodified upstream bodies in `.agents/skills/`, bridged to Claude
by `.claude/skills/`, and locked in `skills-lock.json`. Never edit, copy, or
delete a skill body directly. Use `npx skills add`, `npx skills update`, or
`npx skills remove` so both agents and the lock stay aligned.

Use the installed skill whose description matches the task; do not reproduce
its general workflow in repository documentation. `grill-me` and
`improve-codebase-architecture` are explicit-invocation-only skills.

Repository source and tests override generic skill advice. An upstream skill
name prefixed with `superpowers:` refers to the installed unprefixed skill when
that skill exists.

Uninstalled names used by upstream prose resolve as follows:

- `test-driven-development` → `tdd`; `debugging-and-error-recovery` →
  `systematic-debugging`.
- `code-review-and-quality` → `code-review` for a fixed range or
  `requesting-code-review` for a finished change.
- `api-and-interface-design` and `domain-modeling` → `codebase-design`.
- `deprecation-and-migration` and `shipping-and-launch` →
  `git-workflow-and-versioning`, with `documentation-and-adrs` when a durable
  decision is required.
- `using-git-worktrees` and `finishing-a-development-branch` → the authorized
  checkout plus `verification-before-completion`; do not create or merge a
  worktree implicitly.
- `frontend-design` → `expo-native-ui`; `mcp-builder`, `eas-app-stores`, and an
  unknown specialist → `find-skills`.
- `elements-of-style:writing-clearly-and-concisely` and
  `report-writing:writing-style` → `writing-for-agents` or
  `documentation-and-adrs`, according to the document.
- `setup-matt-pocock-skills` is not run here; use the task specification and
  this file as `code-review` inputs. Expo feedback uses the command embedded in
  the Expo skill that requested it.

## Routing

For work with more than one step, use `brainstorming` → `writing-plans` →
`executing-plans` or `subagent-driven-development` → `requesting-code-review`
→ `verification-before-completion`. Collapse a stage only when the work is
genuinely one step; never collapse the final verification stage.

## Verification

Use Node 22:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

`npm run verify` is the routine completion gate. Use `npm run verify:full` when
web export, bundle, browser behavior, or a release surface changed. Report
failed measurements as well as passed ones; do not claim success without fresh
output.

## Git and release authority

Work in the checkout and branch the user explicitly authorized. Do not create
a branch or worktree merely because generic guidance suggests one. Commit and
push require the user's explicit authorization. A user-authorized push to
`main` also authorizes the risk classifier's automatic web and Expo Go
deployments from that push; they share the existing `helix` deployment
environment and need no second authorization. Manual workflow dispatch,
direct deploy/OTA or
release commands, and linked database publication require authorization for
the exact target. Never force-push or rewrite history.
