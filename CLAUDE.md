@AGENTS.md

# Claude continuity contract

- Read `docs/AI_HANDOFF.md`, `git status`, the relevant diff, and recent history
  before changing anything. The repository is the shared memory with Codex;
  private conversations are not shared.
- Preserve pre-existing uncommitted work and distinguish it from changes made
  in the current task.
- Independently verify Codex-authored work from the implementation and relevant
  checks before calling it confirmed. Record what was actually verified; do not
  infer that two agents communicated directly.
- At the end of every completed task, refresh `docs/AI_HANDOFF.md`. Update
  `AGENTS.md` when durable architecture, toolchain, UX, testing, or shipping
  knowledge changes. Update this file only for Claude-specific coordination
  instructions so the two instruction files do not drift through duplication.
