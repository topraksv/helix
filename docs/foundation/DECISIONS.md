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

### D008 — Execute no Phase 2 deletion

The deletion proof produced no repository-owned candidate. `npm run
audit:unused` exited 1 only for two files inside vendored skill bodies, which
are outside the editable scope; it reported no unused application file or
dependency. A tracked-file hash scan found only the two splash/brand image
pairs whose separate native and OTA lifecycles are documented in
`ARCHITECTURE.md`. Every asset is referenced by app configuration, source,
README, font generation, or a contract test. The only empty directories found
belong to ignored Supabase CLI state. Root scripts and configuration are
reached by package scripts, app configuration, tests, workflows, or their
tool's root-discovery contract. Deleting nothing is safer than turning an
advisory absence of imports into authority.

### D009 — Rank only moves that improve an actual seam

`PROPOSED-MOVES.md` proposes three changes with concrete dependency evidence:
consolidating backup persistence ownership, isolating live-query internals
behind the current interface, and relocating pure category-icon policy. Large
files were not proposed for splitting when they already concentrate related
behavior behind a small interface. All three remain owner-approval work; this
reset changes no path or import under `src/`.

### D010 — Resolve namespaced and legacy review-skill names generically

The second routing sweep found `superpowers:verification-before-completion` and
`code-review-and-quality` in upstream prose. The former is a namespace alias
for the installed same-named skill; the latter splits cleanly between Helix's
installed fixed-range `code-review` and completed-work
`requesting-code-review`. A generic namespace rule plus the explicit legacy
review mapping closes these gaps without copying or editing vendored skills.

### D011 — Install the official `grilling` sibling

Independent review proved the original `grilling` → `grill-me` fallback was
circular: `grill-me` is only a user-invoked wrapper that redirects to
`/grilling`. The upstream Matt Pocock registry now publishes `grilling` as the
model-invoked primitive used by both `grill-me` and
`improve-codebase-architecture`, so it was added with `npx skills add
mattpocock/skills --skill grilling --agent codex claude-code -y`. The CLI
produced the canonical `.agents/skills/grilling` body, the Claude symlink, and
the locked upstream hash. This increases the installed set from 34 to 35 and
resolves the wrapper without modifying any upstream body.

### D012 — Let tested behavior overrule a stale projection comment

`src/domain/balance.ts` says callers deduplicate pending transactions and
expected payments, but `src/domain/dashboard.ts` appends both and
`tests/dashboard-model.test.ts` explicitly requires both amounts in the
forecast. The reconstructed §2.7 therefore states the tested behavior: the
projection sums every supplied flow and the dashboard currently performs no
identity deduplication. The stale source comment was corrected to the same fact
without removing any measurement, incident, or rationale.

### D013 — Complete the baseline with a raw clean-export transcript

Independent review confirmed the Phase 0 progress claim named a clean export
but the baseline artifact persisted only the downstream bundle-check output.
The exact Node 22 command was rerun with `--clear`; its complete raw transcript
and wall time now precede the existing raw bundle-budget transcript in
`BASELINE.md`. This makes the provenance of the measured `dist` bytes explicit
without changing an application artifact.
