---
name: code-review-and-quality
description: Conducts an independent evidence-first review of a proposed Helix change. Use when the user explicitly asks for a code review, risk review, or pre-merge findings.
---

# Code review

## Scope

Review the change as a reviewer. Do not implement fixes, run a generic
refactor, or repeat specialist procedures unless the user asks for that next
step. Helix lands directly on `main`; do not assume a pull-request workflow.

## Procedure

1. Read `git status`, the complete relevant diff, changed call sites and the
   nearest tests. State the reviewed paths and any unreviewed boundary.
2. Classify the change with `node scripts/classify-changes.mjs --files ...` when
   the risk is not obvious.
3. Check, in order: behavior and failure paths; data/account/security
   boundaries; API and module ownership; accessibility/geometry for UI; and
   test evidence. Follow `.ai/INVARIANTS.md` for domain meaning.
4. Use at most one specialist skill when its trigger is independently met.
   Do not duplicate its full procedure in this review.
5. Report findings ordered by severity with file/line, concrete consequence,
   and a minimal safe remedy. Separate verified findings from questions.

## Required evidence

- Every finding has a source path, caller/test evidence, and a reproducible
  reason it matters.
- “Looks cleaner”, a graph edge, or a passing typecheck is not proof of
  correctness, absence of dead code, or safe deletion.
- If no finding remains, state the inspected scope and the commands actually
  run; do not imply that unrun platform or release checks passed.

## Acceptance

The output is a concise finding list (or an explicit no-findings result),
reviewed paths, checks run with results, and unresolved limits. A review is
complete only when another developer can act on each finding without guessing.
