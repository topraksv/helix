---
name: repo-cleanup
description: Removes or simplifies proven-unused Helix files, artifacts, tests, and maintenance scaffolding safely. Use when the user asks for repository cleanup, dead-code removal, archival, or behavior-preserving simplification.
---

# Repository cleanup and simplification

## Scope

Own explicit maintenance work. The simplification mode is behavior-preserving
and belongs here; it is not a second code-review or performance doctrine.

## Procedure

1. Define exact targets and whether the operation is archive-first or delete.
   Capture `git status`, relevant history, and a recoverable backup when the
   target is ignored or generated.
2. Read the target and its reason before touching it. Search every caller,
   export, dynamic import, package script, test, workflow and documentation
   reference with `rg`; a graph result alone cannot prove deadness.
3. Make one narrow change at a time. Prefer delete, merge, or a direct simpler
   expression over a new abstraction. Preserve ordering, errors, side effects,
   accessibility and data semantics.
4. Remove stale references and scaffolding belonging to the same change. Do
   not clean an adjacent owner’s work or delete migrations, generated output,
   vendor material, or local recovery state without explicit scope.
5. Run the smallest relevant regression check, then the risk-appropriate Helix
   verification gate. Inspect the diff and `git diff --check`.

## Required evidence

Record the resolved target, caller search, archive/delete destination, and
behavioral check. If a suspected file still has a caller or its regenerability
is unproven, leave it in place and report the blocker.

## Acceptance

The final report names every removed/merged/archived path, proves no remaining
caller was left behind, lists checks and failures, and states how to recover
the archived material. A smaller byte count without a behavior and caller
argument is not completion.
