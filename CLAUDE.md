@AGENTS.md

Claude compatibility bridge only:

- Project skills are discovered from `.claude/skills/` and symlink to the
  canonical `.ai/skills/` bodies.
- `.claude/settings*.json`, hooks and Claude memory are local execution state;
  shared project state belongs in `.ai/AI_HANDOFF.md` and tracked truth files.
- There is no second `.claude/CLAUDE.md` rulebook.
