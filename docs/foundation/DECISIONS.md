# Foundation Reset Decisions

This log records judgment calls made during the unattended reset. It is
append-only for the duration of the work so a cold reader can recover both the
decision and its reason.

## 2026-08-12

### D001 — Execute the supplied plan without another approval gate

The owner supplied the scope, phase order, behavioral limits, verification
commands, commit policy, and finish criteria, and explicitly prohibited
questions. That constitutes the approved design and implementation plan. The
repository-specific instruction to work in place also supersedes generic
worktree and branch-finishing guidance. Ambiguities will be resolved here
instead of pausing the unattended run.

### D002 — Treat `98a4789` as immutable rollback ground truth

Read-only Git inspection confirmed local and remote `main` plus the safety tag
at `98a4789`. All edits, commits, and pushes will remain on
`chore/foundation-reset`; history-rewriting operations are out of scope.
