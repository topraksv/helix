---
description: Run one Phase 2 package end to end, stopping for owner approval at each gate.
argument-hint: P6 | P7 | P9
---

Run Phase 2 package **$1**.

The six steps are in `docs/PHASE2.md` § How a package runs, and they are the
same for every agent on this repository. Follow them there rather than from
memory; the rules they rest on are in `AGENTS.md` and the documents it links.
Neither is repeated here — read them, and do not ask the owner to restate them.

Claude-only additions to those steps:

- **Step 2** happens in plan mode, and the approval gate is `ExitPlanMode`.
- **Step 4** runs `/simplify` on the working diff first and applies what it
  finds, then the verify commands, then `/code-review`; add `/security-review`
  for P6 and P7.
- **Step 6** may use `/loop 10m` to watch the CI run instead of polling by hand.
- For an L or XL package, map the current state with parallel Explore subagents
  before designing. For anything smaller, read the files yourself — a subagent
  starts cold and costs more than it returns on a small surface.
