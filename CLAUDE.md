@AGENTS.md

## Claude Code

Claude Code discovers skills under `.claude/skills/`, so that directory holds
one symlink per installed skill pointing into `.agents/skills/`. The symlinks
are the discovery bridge, not a second copy: `npm run control:check` fails if
any entry is a real directory, resolves elsewhere, or has no matching skill.
Add and remove skills only with the `npx skills` commands in `AGENTS.md`, which
maintain both trees.
