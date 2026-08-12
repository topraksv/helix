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

### D003 — Reconstruct §2.8 despite its omission from the prompt's section list

The prompt says to create one heading per cited section and not to create
uncited sections. `§2.8` is directly cited by three source files and
`tests/balance.test.ts`, including one of the 14 files counted by the prompt.
The repository evidence therefore overrides the apparently incomplete list of
nine section numbers; `docs/SPEC.md` includes §2.8 and no uncited section.

### D004 — Preserve the deliberate security-control inventory

- **Session epoch** — prevents late sync, maintenance, FX, or notification work from account A writing after sign-out or into account B; lives in `src/sync/session-epoch.ts` and is enforced by `src/sync/engine.ts` / `src/auth/session.ts`.
- **`tombstone_version`** — prevents a stale offline client's newer wall clock from resurrecting a remotely deleted row; lives in local/server schema migrations and `src/sync/merge-policy.ts`, with enforcement in `src/sync/engine.ts`.
- **Verification brake** — bounds repeated real sign-in attempts during sensitive password verification without carrying account A's cooldown into account B; lives in `src/auth/verification-brake.ts` and `src/auth/session.ts`.
- **Account freeze** — marks and proves the synced freeze before ending the session, and rolls the flag back on every failed path so the account cannot be half-frozen; lives in `src/auth/freeze.ts` and the account-security/guard flow.
- **Chunked SecureStore** — keeps oversized Supabase auth sessions inside native secure storage with bounded chunk count, complete-read checks, stale-chunk cleanup, and legacy single-value compatibility; lives in `src/sync/secure-chunked-storage.ts`.
- **Install-script allowlist** — fails the test suite if a new dependency begins executing code during `npm ci`, while retaining the two reviewed native build-tool families that require hooks; lives in `tests/install-scripts.test.ts` (`esbuild`, `unrs-resolver`).

### D005 — Keep all 34 installed skills

No installed skill is genuinely inapplicable or redundant. The repository has
active Expo native and web targets, Supabase migrations and auth, Playwright
and native E2E suites, property-based tests, CI/release workflows, security and
supply-chain controls, and documented architecture. Apparent overlaps describe
different workflow stages or surfaces (for example, diff review versus
receiving feedback, native UI versus native performance, and Supabase services
versus Postgres schema work). Removing one would leave a real task class
without its specialist. No skill was added, removed, copied, or edited.

### D006 — Make `AGENTS.md` the single instruction source

Anthropic's current guidance favors concise, specific, non-derivable project
instructions and warns that contradictory instruction files produce arbitrary
selection. `CLAUDE.md` therefore contains only its supported import of
`AGENTS.md`. `AGENTS.md` retains Helix-specific language, safety, routing,
verification, and authorization rules; it drops explanatory duplication and
records exact fallbacks for every uninstalled sibling named by an upstream
skill.

### D007 — Resolve missing skill references locally

Vendored skill bodies must remain upstream-clean, so their missing sibling
references are resolved in `AGENTS.md`, not patched in place. Existing Helix
skills cover testing, debugging, design, documentation, review, and Git
fallbacks. Store release remains a separately authorized task; Expo feedback
uses the command already embedded in the installed Expo skills. This preserves
upstream updateability without leaving routing ambiguous.
