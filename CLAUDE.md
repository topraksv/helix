@AGENTS.md

# Claude-specific notes

Everything shared with other agents is in [`AGENTS.md`](AGENTS.md) (imported
above) and the documents it links. Only Claude Code differences belong here.
Codex reads `AGENTS.md` natively, so there is no separate Codex instruction
file — do not create one.

- **Commit trailers.** Claude Code's default template appends
  `Co-Authored-By: Claude`. This project forbids it, and that overrides the
  default in every commit and PR body. See the commit rules in `AGENTS.md`.
- **Context continuation.** A summarized or resumed session is not evidence.
  Re-read `docs/AI_HANDOFF.md` and re-inspect `git status` and the diff before
  continuing work described in a summary.
- **Tool defaults.** Prefer Read/Edit/Grep over shell equivalents, and keep
  temporary scripts and scratch output in the session scratchpad directory —
  never in the repository. Anything written under the project must be a
  deliberate, reviewable file.
- **Subagents.** A subagent starts cold and cannot see this session. Give it the
  file paths and the invariants it needs, and independently verify what it
  reports before acting on it.
