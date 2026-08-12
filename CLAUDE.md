@AGENTS.md

Claude compatibility bridge only:

- Skills are installed with the `skills` CLI. `.agents/skills/<name>/` holds the
  real, unmodified upstream body; `.claude/skills/<name>` is the symlink Claude
  discovers it through. Edit neither: reinstall or update from the upstream
  source recorded in `skills-lock.json`.
- `.claude/settings*.json` and Claude memory are local execution preferences,
  not project truth.
- `grill-me` and `improve-codebase-architecture` are explicit-invocation only;
  invoke them by name rather than waiting for them to trigger.
