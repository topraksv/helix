# Helix

Helix is a single-developer, offline-first personal finance application.
User-facing text is Turkish; code and identifiers are English.

This file is the shared contract for every coding agent. Claude Code adds its
own mechanics in `CLAUDE.md`, which imports this file.

## Sources of truth

Source, tests, migrations, and installed package versions define behavior.
`docs/SPEC.md` reconstructs the product sections cited by source files;
`docs/ARCHITECTURE.md` records only boundaries and decisions that are not safe
to infer. Read the latter before changing a boundary or removing an apparently
redundant control.

Do not restate in documentation what `package.json`, config files, or the
directory layout already state. Record the reason a choice was made, not the
value a lookup would give.

## The code graph

`graphify-out/` is a local index of this repository. Use it to find where
something lives or what depends on it: `graphify query "<question>"`,
`graphify explain "<symbol>"`, and `graphify path "<a>" "<b>"` answer with
`file:line` citations in less time than a broad search. Prefer it for
"where is this used" and "what would this change touch".

It is a lead generator, never an authority. An EXTRACTED edge is parser
evidence; an INFERRED or AMBIGUOUS one is the tool's guess. Open the cited
source and confirm before acting on any of them, and cite the source rather
than the graph.

Never assume the index is current. `graphify-out/GRAPH_REPORT.md` names the
commit it was built from; compare that with `git rev-parse HEAD` before relying
on it. A checkout may carry a local `.git/hooks/post-commit` that rebuilds the
graph in the background, but hooks are not committed, so their presence differs
per machine and proves nothing about freshness. When the graph is behind, run
`graphify update .` — seconds, no network, no API key — or report it as stale.
If `graphify-out/` is absent the tool is not installed here: use the normal
file tools and do not install anything.

`docs/ARCHITECTURE.md` records how the index and the Obsidian vault are set up.

## Skills

Skills are unmodified upstream bodies in `.agents/skills/`, locked in
`skills-lock.json`. Codex reads that directory directly; Claude Code reaches
the same bodies through the bridge described in `CLAUDE.md`. Never edit, copy,
or delete a skill body. Use `npx skills add`, `npx skills update`, or
`npx skills remove` so every agent and the lock stay aligned.
`npm run control:check` enforces this.

Use the installed skill whose description matches the task; do not reproduce
its general workflow in repository documentation. Repository source and tests
override generic skill advice.

For work with more than one step: `brainstorming` → `writing-plans` →
`executing-plans` or `subagent-driven-development` → `requesting-code-review`
→ `verification-before-completion`. Collapse a stage only when the work is
genuinely one step; never collapse the final verification stage.

### Names upstream prose uses that are not installed here

Skill bodies cite sibling skills by their publishers' names. A `superpowers:`
prefix means the installed unprefixed skill when one exists. These names have
no local skill and resolve as follows:

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
- `setup-matt-pocock-skills` is not run here; use the task specification plus
  this file as `code-review` inputs. Expo feedback uses the command embedded in
  the Expo skill that requested it.

## Verification

Use the Node version in `.nvmrc`; `docs/ARCHITECTURE.md` records why it is
pinned.

```sh
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

`npm run verify` is the routine completion gate. Run `npm run verify:full` when
the change reaches web export, bundle, browser behavior, or a release surface;
`scripts/classify-changes.mjs` and its test are the authority for which paths
CI escalates. Report failed measurements as well as passed ones; do not claim
success without fresh output.

## Git and release authority

Work in the checkout and branch the user explicitly authorized. Do not create
a branch or worktree merely because generic guidance suggests one. Commit and
push require the user's explicit authorization. A user-authorized push to
`main` also authorizes the risk classifier's automatic web and Expo Go
deployments from that push; they share the existing `helix` deployment
environment and need no second authorization. Manual workflow dispatch, direct
deploy/OTA or release commands, and linked database publication require
authorization for the exact target. Never force-push or rewrite history.

`docs/RELEASE.md` is the runbook for those targets: delivery surfaces, the
migration order, rollback, and the evidence a release must record.
