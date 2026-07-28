# Helix — agent rules

Canonical, stable rules for every coding agent (Claude, Codex, others). Keep it
short: this file is loaded into every session. Anything that is not a rule lives
in the documents below and is read on demand.

| Need | Canonical document |
|---|---|
| Structure, data flow, domain model, design language, rejected approaches | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Quality commands, test layers, device acceptance | [`docs/TESTING.md`](docs/TESTING.md) |
| Branches, PR gate, Pages, OTA, native builds, Supabase, rollback | [`docs/RELEASE.md`](docs/RELEASE.md) |
| Trust boundaries, RLS, secrets, verification matrix | [`docs/SECURITY.md`](docs/SECURITY.md) |
| User-facing data behaviour | [`docs/PRIVACY.md`](docs/PRIVACY.md) |
| Skill routing, provenance and update policy | [`docs/AI_ENGINEERING_SKILLS.md`](docs/AI_ENGINEERING_SKILLS.md) |
| Current work state, blockers, next package | [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) |
| Phase 2 scope, package order, how a package runs, rollback | [`docs/PHASE2.md`](docs/PHASE2.md) |
| Public presentation | [`README.md`](README.md) |

A fact belongs to exactly one of those files. If you need to state it somewhere
else, link instead of copying. Agent-facing files (`AGENTS.md`, `CLAUDE.md`,
`docs/ARCHITECTURE.md`, `docs/AI_HANDOFF.md`, `docs/PHASE2.md`) are written in
English; the owner-facing contracts under `docs/` are Turkish. Code is English, UI is Turkish.

## Who Helix is for

One person uses this app: its owner. They are also its only reviewer, its only
tester and its only support channel. Nothing here is validated by a second
opinion, an analytics dashboard or a bug report from a stranger.

The intended path is staged — the owner today, a close circle later, possibly a
real product after that. It is written down so you know the direction, **not so
you build for it**.

- **Build for the stage the project is in.** No analytics, no crash service, no
  multi-tenant abstraction, no scale work, no framework for a feature that has
  one caller. "It will need this later" is not a reason; later has its own
  package, and it can afford its own change.
- **Do not foreclose the next stage either.** Money stays integer minor units,
  ids stay UUIDs, RLS stays owner-scoped and provable, sync stays
  server-authoritative and idempotent. These already survive more than one user
  and cost nothing to keep — breaking them to save a day is the one shortcut
  that cannot be bought back.
- **The UI bar is high because one person sees every screen, every day.** There
  is no second user whose different taste averages out a careless decision, and
  no usage metric that will surface it later. A rough edge stays rough until
  someone notices it by hand, so it does not ship rough.
- **A defect reaches the owner by the owner hitting it.** There is no telemetry
  and no error inbox — see `docs/PRIVACY.md` for why that is deliberate. This is
  the whole reason the evidence rules below are strict rather than fussy.

## Working protocol

The repository is the only shared memory between agents. No agent can see
another's chat or model memory.

**Start of every task:** read this file and `docs/AI_HANDOFF.md`; inspect
`git status`, the relevant diff and recent history. Git and the current files
win over any note. Treat uncommitted changes as someone else's work — understand
and preserve them unless told otherwise. Verify a previous agent's claims
against code and checks; "fixed" in a note is not proof.

**End of every completed task:** rewrite `docs/AI_HANDOFF.md` in place — current
state, work in progress, open items, next package. It is disposable: replace it,
do not append a log, and move anything durable into its canonical document. Keep
only the evidence a rollback would need (last release commit, Pages run, EAS
group). A file cannot name the hash of the commit containing it — `git log` is
the authority for the resulting HEAD.

Say work was "cross-checked" only after independently inspecting the diff and
running the relevant checks. Never imply agent-to-agent communication that did
not happen. Do not speculatively rewrite working code, and do not run
destructive Git or database operations (force-push, history rewrite, hard
delete, `db reset` against linked) without an explicit instruction.

## End-of-task repository hygiene

- Before the final response, inspect only the files created or changed by the
  task and remove its unused screenshots, image copies, video, trace, report,
  coverage, log, cache, debug output, temporary files, empty directories and
  helpers.
- Verify every new asset, test, dependency, config, script and document has a
  real caller or consumer; remove it if the completed task does not use it.
- Keep generated output out of Git with the narrowest accurate `.gitignore`
  pattern, then check moved or deleted files for remaining code, config, test,
  route, script and documentation references.
- Keep this daily check delta-focused. Do not rescan the whole repository after
  a small change.
- Use `$repo-cleanup` on the affected scope when a task adds or changes many
  files, dependencies, assets, tests or directories. Run a full repository
  cleanup after a large feature, release preparation, long agent session or
  substantial generated output.
- Use `$codebase-design` only when the owner explicitly requests architecture
  work or the task changes module seams or dependency directions. Never use
  cleanup as a pretext for an automatic architecture refactor.
- Hygiene must not change product behaviour, introduce a large refactor,
  upgrade dependencies or delete owner work.
- Run the relevant lint, type-check, test and build checks. Mention cleanup in
  one or two final bullets; do not create a repository cleanup report.

## What counts as evidence

Every rule here was bought with a wrong answer that had already been reported as
right. They are cheap to follow and expensive to skip.

- **Measure the claim; do not reason it out.** A colour is a computed contrast
  ratio, a width is the string measured in the real font, a provider's response
  is the endpoint actually called, a dependency's behaviour is the published
  tarball actually opened, and "it does not ship to users" is a search of the
  export. Arithmetic that sounds right is how a wrong number gets committed.
- **Read every call site before declaring a class of bug fixed.** One matching
  file is where the search starts, not where it ends. Fixing the first of
  seventeen guards and reporting the class closed is a false claim, not a
  partial one.
- **Run the gate, not the part of it you changed.** A green single test file
  proves nothing about the typecheck, the lint or the visual suite. `npm run
  verify` is the floor.
- **A recorded disposition is a snapshot, not a fact.** Before relying on a note
  that an upstream fix does not exist, or that a version cannot be taken, check
  upstream again and say when you checked. Notes go stale silently; the next
  agent inherits the staleness as certainty.
- **Ship a whole slice or none of it.** A feature split across three mechanisms
  is not three deliverables. Build the parts that carry the value or argue the
  feature down — never ship the leftover and report it as done.
- **Delete the scaffolding with the thing it scaffolded.** A flag, a shim or a
  compatibility branch that outlives its package becomes furniture nobody dares
  move.
- **Report the measurement that failed as readily as the ones that passed.** A
  delivery note that lists only successes is not a record, and the owner cannot
  price what they cannot see.

## Sizing the work

The smallest change that fully solves the problem wins. A feature request, a
backlog note or a scope document is a **wish list, not a specification**: price
each requirement — files, layers, rough lines — and argue in writing against any
whose cost is out of proportion to what the user gets, before building it. A
need the user can already meet with a control they can see is not a requirement.
Faithfully satisfying a brief is not the goal.

- **Presentation never enters the data layer.** `src/db/mutations.ts` and
  `src/data/repo*` say what is written, never how a screen feels while it
  happens — no progress callback, no UI-owned `AbortSignal`. Every user write
  funnels through `writeRows`; a parameter added there is one every call site
  must now reason about. A screen reports the phases it already knows.
- **Progress counts the user's units** — months, entries, files — never rows.
- **A state you cannot reach is not a feature.** Name the case where a user sees
  it, or delete the machinery behind it.
- **One mechanism per behaviour.** A second delay, guard or cache that call
  sites switch off means the first one sits at the wrong level.
- **Defensive code needs a reachable failure.** Name the sequence it prevents,
  or drop it.
- **A module's header comment is part of the module.** Change what it does and
  the rationale above it becomes a lie the next agent will trust. Comments here
  earn their place by explaining a *why* the code cannot — the constraint, the
  incident, the rejected alternative. A comment that restates the line below it
  is noise; match what the surrounding files already do.
- **Correct, secure, fast enough and consistent with what is here is finished.**
  Polishing past that is the same mistake as building past the requirement.

## Toolchain

- **Expo SDK 54** — read <https://docs.expo.dev/versions/v54.0.0/> before
  writing code.
- **Node 22 is required** locally: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- `expo-sharing` must stay out of `app.json` plugins.
- `xlsx` comes from the SheetJS CDN tarball and is invisible to `npm audit`.
- Dependabot guards the Expo-managed dependency matrix; do not lift a guard
  outside the coordinated `BACKLOG-SDK-01` upgrade.

Details and reasons: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Data and sync invariants

- **All SQLite access is async** (`getSqliteAsync()` / drizzle `sqlite-proxy`).
  Never reintroduce the synchronous API.
- **Every user write goes through `writeRows`** — data + outbox + `last_entry_at`
  in one transaction. Deletes are tombstones (`softDelete`), never hard deletes.
- **`src/data/repo.ts` is the stable facade.** Routes and UI import only it;
  implementations live in `src/data/repo/` and must not form import cycles.
- **Sync ordering is server-authoritative.** Push selects and merges Supabase's
  normalized `updated_at` before removing its exact outbox events. Never advance
  a pull cursor past an invalid row; quarantine malformed or foreign data in
  `sync_dead_letters`.
- **Imports are all-or-nothing.** Validate the whole JSON bundle (UUID ids, one
  source account, unique rows, resolvable references) or the whole Excel replace
  plan before the single write. Keep the file/row/cell and ZIP preflight limits;
  XLSX stays a dynamic import. Large restores use bounded batches inside one
  transaction — never trade atomicity for chunking.
- **Do not apply input limits when reading a valid legacy backup.** Old data
  must stay recoverable.
- **Supabase migration history must be reproducible.** Never use the reserved
  `_init.sql` suffix. After any migration change, `migration list --linked` must
  show identical local/remote versions, `db lint --linked` must stay clean, and
  `src/sync/database.types.ts` must be regenerated (never hand-edited).
- **Every authenticated background task is session-scoped** — `startSyncSession`
  / `stopSyncSession` / `runSyncSessionTask`. A late response from user A must
  never write after user B becomes active.

## Domain invariants

- **Money is integer minor units**; format only at the edge (`formatMinor`,
  `formatMinorCompact`). Entry ceiling `MAX_ABS_AMOUNT_MINOR`, input cap
  `MAX_AMOUNT_MAJOR_DIGITS` — raise a limit in one place only. New amounts pass
  `isSupportedMinorAmount`; editable text uses `INPUT_LIMITS` in both UI and
  repository boundaries.
- **Refunds and reversals keep their type and category with a negative amount.**
  Every other amount is positive. Income/expense categories must match the
  transaction type; transfers use an expense-kind category.
- **Dates are `YYYY-MM-DD`, months `YYYY-MM`.**
- **Analytics follows transaction type, not category appearance.**
- **Credit-card purchases affect the ledger on the statement's `due_date`**, from
  a persisted `credit_card_statements` period; ambiguous legacy rows never get a
  synthetic payment date.
- **The ledger back-anchors** — data before the opening month still renders.
- **A month total and its breakdown come from one accessor.** The balance chain
  stays realized-only, but `byCategory` also carries planned rows — so any
  surface showing a month total beside its flows uses `monthFlowTotals`, and a
  computed column uses `monthColumnBasis`. Never pair `closingMinor` with
  `byCategory`.
- **Expected payments are derived lifecycle rows.** Reconcile only unpaid
  derivatives; paid/skipped history is immutable. Watch-only rules never create
  balance-affecting rows. Weekly/biweekly incomes advance 7/14 days from an
  explicit ISO anchor; a missing anchor fails closed.
- **Category budgets never move money.** Deleting a category soft-deletes its
  budgets in the same write; the budgets hook joins live categories, and
  maintenance tombstones an orphan only when its category row provably exists as
  deleted.
- **Current-balance reconciliation uses `balance_adjustments`** — never rewrite
  the opening month to match a current balance.
- **Referenced persons and payment sources cannot be deleted directly.** Show
  live usages and require an explicit atomic reassignment first (a payment source
  may be cleared, its references are nullable).
- **New subscriptions require a live expense category** — validated in the repo,
  not just the form. Default to the deterministic reusable `Abonelikler`.
- **Cell notes have one natural identity per real month/category cell**
  (`src/data/cell-notes.ts`). Never attach them to pseudo groups such as
  `uncategorized`, never use random note ids.
- **Onboarding draft ownership is index-safe** — person index zero is the
  deterministic self person; removing a watched person reassigns its draft
  sources to self and shifts later indices.

## Freshness and external data

- **Live reads expose state, not empty arrays.** Data-critical screens use the
  `*State` hooks (`loading`/`ready`/`refreshing`/`stale`/`error`) and the shared
  retry notice. An initial `[]`/`null` is never proof the account is empty.
  `useLive` drops its snapshot when `deps` change; `readSyncedFlag`'s `null`
  means unresolved and must not collapse to `false`.
- **External financial data is bounded and dated.** FX follows the session abort
  signal, times out, validates size/shape and stores the provider's declared
  business date. The FX cache is user-scoped. Missing rates stay missing — a
  foreign amount is never read as TRY.
- **Market quotes separate DISPLAY from CONVERSION.** The card keeps showing the
  last-known quote with its timestamp through silence and restarts; conversion
  freshness follows each quote's own `receivedAt` and expires 60 s after that
  quote was last confirmed live. Live continuity may extend a still-fresh
  quote's receipt time, but an expired or snapshot-hydrated quote must never be
  re-stamped by another symbol's tick. The converter reuses the card's quote (no
  second market request) and badges a last-known rate visibly; the dated FX cache
  is used only when strictly newer. Ledger-writing conversions keep the strict
  60 s `marketSellRateTry` contract. The socket runs only while an unlocked,
  authenticated app is active.

## Privacy and platform invariants

- **Notification consent is device-local and opt-in.** Never request permission
  during boot. Lock-screen content is neutral by default; names and amounts need
  a separate device-local confirmation. Turning details off, signing out or
  switching accounts cancels existing previews before any reschedule. The
  bounded queue is the next 60 notifications.
- **Subscription logos:** utilities and unknowns stay local; a known domain may
  use Google's favicon service only after strict public-host validation and
  encoding, with disk cache and local fallback. The web CSP `img-src` must keep
  allowing `https://*.gstatic.com`. All variants render in one shared frameless
  tile (near-square, `size/3` radius, no border).
- **Sensitive UI is covered outside the active app.** Keep the root
  `PrivacyCover`; never put financial values in it.
- **iOS app data is sealed while the device is locked**
  (`NSFileProtectionComplete`). It is safe only because the app does no
  background file work — revisit it first if that changes.
- **Production diagnostics stay silent.** Use `src/services/logger.ts`; raw
  detail only in development. Never persist tokens, passwords, payloads, notes,
  e-mails, ids or amounts. No direct console logging in application code.
- **Password recovery uses Supabase PKCE.** Web redirects keep the `/helix` base
  path; installed builds use `helix://`. Recovery routes are exempt from the
  signed-in/onboarding guards. Never reveal whether a reset e-mail has an account.

## UI and navigation rules

- **UI strings live only in `src/i18n/tr.ts`.**
- **Shared primitives live in `src/ui/`** (`components.tsx`, tokens in
  `theme.ts`). Reuse them; never inline-restyle. Cross-platform tables use
  `src/ui/sticky-table.tsx`, never CSS `position: sticky`.
- **No manual `useMemo`/`useCallback` for derivations** — the React Compiler is
  enabled. Keep `useMemo` only where a hook rule demands a stable identity.
- **Every back action has a deterministic parent.** Use `HeaderBackButton` and
  `navigateBack`, not raw `router.back()`. Nested Settings/Cash Flow stacks
  declare `index` as the initial route and reset on tab blur. **A push into a
  nested tab stack from outside it must pass `{ withAnchor: true }`.** A screen
  reachable from more than one place records its source at the push site and
  resolves with `resolveBackTarget`. **An exact back target is a `replace` to a
  rebuilt URL, so it must carry the returned-to screen's own params with it** —
  that screen's recorded origin (`knownSource`, re-validated against the same
  allowlist) and the record it was editing (`classifyRecordId`). Dropping them
  demotes the screen to a deep link, or a half-edited form to a blank new one.
  Never set a root `(tabs)` initial route.
- **Route params are hostile input.** Validate with the domain predicate
  (`isMonthKey`), query a safe substitute and `navigateBack` — an unchecked
  param crashes during render.
- **Forms with an in-memory draft use `useDirtyExitGuard`** against the real
  persisted snapshot; successful save/delete goes through `allowExit`. Never
  prompt for a derived async default or an untouched inline editor.
- **Accessibility behaviour lives in shared primitives** — persistent field
  labels, announced inline errors, isolated modals that focus a heading and
  return focus, charts with a complete textual value summary and no
  colour-only meaning. Keep modal container Pressables `accessible={false}`.
- **Colour tokens separate accents from foregrounds.** Fills use
  `primary/positive/negative/warning`, text uses the matching `*Text`,
  interactive controls use `controlBorder`, button copy uses
  `onPrimary`/`onNegative`. Never repaint a row in a control's own state colour
  and never hand-roll an `hsl()` fill under text. Change colours only together
  with `tests/theme-contrast.test.ts`.
- **Haptics go through `src/ui/haptics.ts` and are iOS-only.** Selection
  feedback fires only on a real change; calculator digits stay quiet; a native
  haptic failure must never block the action.

### Non-negotiable UX rules

The owner is a visual perfectionist. After any UI package, sweep the whole app
for these, not only the reported items.

- **Never truncate text with an ellipsis.** Wrap, shorten, or change the layout.
- **Vertically centre every row control** with all of the row's content.
- **No static or special-cased columns.** Everything visible in a table is
  add/edit/delete-able; only Ay Başı and Güncel Bakiye are inert system
  calculations. Missing-category legacy data belongs in an actionable repair row
  outside the matrix.
- The Mali Tablo column editor exposes ordinary and computed columns alike, both
  renameable, hideable, deletable and reorderable. `isColumn=false` overrides
  imported `column_years` membership.
- **Matching status chips share identical size and alignment.**
- **Trim bottom safe-area padding aggressively** (`Math.max(insets.bottom, …)`).
- **The current month auto-focuses in tables.**
- Never present a vertically draggable editor as an iOS sheet — its dismiss pan
  fights row reorder. Use a stack card or a true full-screen presentation, with
  one shared editor path across entry points.

## Quality gate

`npm run verify` before every commit; `npm run verify:release` before a release —
it mirrors the CI `quality` job's order. Playwright's committed baselines are
rendered on macOS: local diffs stay capped at 1%, Linux CI allows the measured
4% glyph-edge budget, and neither threshold moves without inspecting the
uploaded actual/diff evidence. The static export is release-budgeted by
`npm run bundle:check`; keep that step after `expo export` and change a
threshold only with a measured export and a recorded explanation. GitHub Pages
serves a copy of the root `dist/index.html` as `dist/404.html` — never Expo
Router's `+not-found` output.

Scope, layers and device acceptance: [`docs/TESTING.md`](docs/TESTING.md).

## Shipping

**`main` is the only branch.** It is protected — required `quality` check,
signed commits, linear history, `enforce_admins` — so a change reaches it
through a PR, but the branch carrying that PR is scaffolding: create it when the
work is ready to ship, delete it on merge. No long-lived branches, no release
tags, no per-package naming scheme. If something is wrong, go back a commit.
Never bypass the check or force-push. **Pushing to `main` ships only the web
app** — the phone needs a separate EAS Update, and native config, icons, SDK or
runtime changes need a local device rebuild instead. Exact commands, evidence
requirements and rollback: [`docs/RELEASE.md`](docs/RELEASE.md).

## Commit messages

```
<type>(<scope>): <summary ≤ 72 chars>

<body: what changed and WHY, wrapped ~72 cols.>
```

- **type:** `feat`, `fix`, `perf`, `refactor`, `ui`, `chore`, `docs`, `test`.
- **scope** (optional): `cashflow`, `db`, `sync`, `ui`, `import`, `deploy`…
- The summary says what the change does, not what you did.
- The body explains the reasoning a diff cannot; skip it only for trivial
  one-liners.
- **No AI or bot attribution.** No `Co-Authored-By` for an assistant, no bot
  trailer, no assistant name. GitHub attributes the trailer, not the author
  field, so a single trailer is enough to put the assistant in the repository's
  Contributors list. The history is clean — one human contributor, zero bot
  authors, committers or trailers — and keeping it that way is the point of this
  rule. Commits carry the owner's Git identity and nothing else; Dependabot
  changes are replayed as owner-authored commits when that matters.
- **Commits must be signed** — `main` requires signatures and a linear history.

### Project skill routing

Project skills live under `.agents/skills/`, are pinned by full source commit
and content hash in `skills-lock.json`, and are checked by
`npm run verify:skills`. The complete routing tree, provenance, vendor patches
and update policy live in [`docs/AI_ENGINEERING_SKILLS.md`](docs/AI_ENGINEERING_SKILLS.md).

Load only the smallest relevant path:

- security boundary → `security-and-hardening`;
- dependency, Action, advisory or vendored skill → `dependency-security`;
- ledger, sync, import, backup or financial calculation →
  `financial-data-integrity`;
- cross-platform, device, release or deployment proof →
  `platform-release-acceptance`;
- visual system or Turkish product language → `visual-system`;
- motion, gesture or haptic → `native-interaction`;
- mobile semantics, focus or assistive technology → `mobile-accessibility`.

Then load only the specialist leaves those skills route to. Every implementation
still ends with `code-review-and-quality`,
`verification-before-completion` and delta-focused `repo-cleanup`; this does not
mean loading those skills before they are needed.

Skill instructions never override the user's request, proven product behaviour,
repository rules, tested business logic or version-matched official
documentation. Installation does not authorize redesign, dependency upgrades,
architecture changes, external services, release actions or behaviour changes.
