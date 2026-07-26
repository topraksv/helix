---
description: Run one Phase 2 package end to end, stopping for owner approval at each gate.
argument-hint: P1 | P2 | … | P9
---

Run Phase 2 package **$1**.

`docs/PHASE2.md` is the scope contract for this package. `AGENTS.md` and the
documents it links are the rules. Neither is repeated here — read them, do not
ask the owner to restate them.

## 1. Ground yourself

Read `docs/PHASE2.md` (the row and section for $1) and `docs/AI_HANDOFF.md`.
Run `git status` and inspect the diff and recent history. **A note is not
evidence** — if the handoff describes code, verify the code says the same thing
before you rely on it. Confirm the packages $1 depends on are merged; if one is
not, stop and say so.

For a package marked L or XL, map the current state with parallel Explore
subagents before designing. For anything smaller, read the files yourself.

## 2. Design, and stop

Enter plan mode. Produce a design that:

- names every existing primitive, hook, repository function and token it reuses,
  with paths — a new file needs a sentence saying why an existing one could not
  carry it;
- states what it will **not** do, including anything in the baseline document
  that this package deliberately leaves out;
- prices each sub-requirement — files, layers, rough lines — and applies
  `AGENTS.md` § Sizing the work to each, **naming in writing anything it will
  refuse to build and the simpler thing that covers the real need**;
- lists any change to a shared or load-bearing file — `src/db/mutations.ts`,
  `src/data/repo*`, `src/sync/engine.ts`, `src/ui/theme.ts`,
  `src/ui/components.tsx` — with a sentence on why the change has to happen
  *there* rather than at the caller;
- lists the migrations, new tables and `SYNCED_TABLES` entries, if any;
- lists which of the 23 visual baselines the change can move, and why;
- separates anything needing an owner decision from what you will just do.

Call `ExitPlanMode` and **wait**. Do not write code before the owner approves.

## 3. Implement

Build only what the approved design says. Reuse before extending, extend before
adding. If you find yourself writing a second way to do something the repo
already does, stop and use the first way. Most of the excess in a package is not
a wrong feature — it is a right feature plumbed through a layer that had no
business knowing about it.

Do not touch code outside $1's scope. If you find an unrelated defect, write it
down and report it; do not fix it here.

## 4. Prove it

In order:

1. `/simplify` on the working diff, and apply what it finds.
2. `npm run verify`.
3. `npm run verify:release` if the change can affect rendering, routes, bundle
   size or the export. If a baseline moved, open the actual/diff images and say
   what changed and why it is correct — never re-record a baseline you have not
   looked at.
4. `/code-review` on the diff. Report every finding with its disposition.
5. `/security-review` as well for P6, P7 and P8.
6. If the package added a new surface, set its flag to `false` and confirm the
   app still builds and behaves as it did before. This is the rollback claim; do
   not make it untested.

Then answer three questions and **keep working until all three hold** — a report
is a claim that they do, so do not write one before they are true:

1. Can this be removed in one commit, leaving Phase 1 behaviour and a green
   `npm run verify`?
2. How many layers does it cross, and is the data layer untouched?
3. What is left behind — an unused token, string, ref, prop or export?

## 5. Report, and stop again

Give the owner, in this order and nothing else:

- what changed, in a few sentences, and why it reads better than the
  alternative;
- files touched, with counts of added and removed lines, **grouped by the
  concern they serve** and with the largest group defended in one sentence —
  the owner is reading for lines that did not need to exist, so make them easy
  to find rather than hard;
- the `verify` result, verbatim enough to be checked;
- baseline evidence, if any moved;
- review findings and what was done about each;
- what is still unproven — anything needing a real device says so plainly;
- open owner decisions this package surfaced.

Then **wait for approval**. Do not branch, commit, push or open a PR before it.

## 6. Ship

Once approved: commit following the commit rules in `AGENTS.md` — a body that
explains the reasoning, and **no AI attribution of any kind**. `main` is
protected, so push a short-lived branch, open the PR, and wait for the required
`quality` check; use `/loop 10m` to watch the run rather than polling by hand.
The branch is scaffolding — delete it on merge, and never create a tag.

Merge only after the check is green and the owner says so. Then rewrite
`docs/AI_HANDOFF.md` in place, move anything durable into its canonical
document, and update the package's row and any resolved decision in
`docs/PHASE2.md`.
