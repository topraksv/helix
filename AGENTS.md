# Helix — agent notes

## Cross-agent continuity (Codex + Claude)

This repository is the shared memory between agents. No agent may assume it
can see another agent's private chat or model-specific memory. Continuity and
cross-checking happen through the working tree, Git history, this file, and
[`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md).

At the start of every task, every agent must:

1. Read this file and `docs/AI_HANDOFF.md` completely.
2. Inspect `git status`, the relevant diff, and recent Git history. Git and the
   current files are authoritative if a handoff note is stale.
3. Treat existing uncommitted changes as another agent's/user's work: understand
   and preserve them unless the user explicitly asks to replace them.
4. Verify relevant claims from a previous agent against code/tests; a note that
   something is fixed or shipped is not proof by itself.

At the end of every completed task, the acting agent must refresh
`docs/AI_HANDOFF.md` with the branch and pre-change/base commit, active work,
files changed, verification performed, deployment/OTA state, decisions, and
unresolved risks. (A file cannot name the hash of the commit that contains
itself; `git log` is always the authority for the resulting HEAD.)
`Recent handoffs` keeps at most the **last 5** entries; when adding a sixth,
move the oldest into `docs/handoffs/<year-month>.md`. The handoff file is read
in full at the start of every session by every agent, so it must stay small —
Git history owns the complete chronology.
Update this `AGENTS.md` whenever a durable architecture invariant, toolchain
requirement, design rule, hard-won lesson, or shipping procedure changes. Keep
`CLAUDE.md` aligned with the same protocol, but do not duplicate the full
architecture there—`AGENTS.md` remains the canonical instruction source.

An agent may say work was "cross-checked" only after independently inspecting
the diff and running the relevant checks. If both agents have not actually run,
say that the work is ready for the other agent to verify; never imply direct
agent-to-agent communication that did not occur.

## Toolchain (READ FIRST)

- **Expo SDK 54** — read the versioned docs at
  https://docs.expo.dev/versions/v54.0.0/ before writing code. (Downgraded
  from 57 so the project matches the App Store build of Expo Go, which is
  pinned to SDK 54.)
- **Node 22 is required** for local builds/exports:
  `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`. SDK 54's tooling chokes
  on Node 24/26 native TypeScript stripping (it tries to load
  `expo-modules-core/src/index.ts`). CI is pinned to Node 22.
- `expo-sharing` is **not** in `app.json` plugins (SDK 54 ships no config
  plugin for it; leaving it there breaks `expo export`).
- `xlsx` is pinned to SheetJS's official CDN tarball (the npm registry version
  lags). `npm audit` and Dependabot do **not** see it — check for a newer
  release manually whenever import code is touched.
- iOS on a real phone: `npx expo run:ios --device` (free Apple ID, re-sign
  every 7 days). Expo Go can't open the project across SDK lines reliably.

## Architecture invariants

- **All SQLite access is async**, through `getSqliteAsync()` / drizzle's
  `sqlite-proxy` driver. Never reintroduce the synchronous API — it needs
  SharedArrayBuffer + COOP/COEP on web and froze mobile browsers.
- **Cross-platform tables use `src/ui/sticky-table.tsx`**, not CSS
  `position: sticky` (which iOS ignores). It splits the fixed columns out of
  the horizontal ScrollView under one vertical ScrollView; row heights are
  fixed so the halves stay aligned.
- **The ledger back-anchors** (`resolveLedgerAnchor`): history entered before
  the configured opening month still renders — the start extends to the
  earliest data and the opening balance is back-computed.
- **Every user write goes through `writeRows`** (outbox + `last_entry_at` +
  atomic). Deletes are tombstones (`softDelete`), never hard deletes.
- **`src/data/repo.ts` is the stable repository facade.** Route/UI callers
  import only that public surface; focused I/O implementations live under
  `src/data/repo/`. Keep cross-domain helpers internal to that folder and do
  not recreate a monolith or introduce circular service imports.
- **Imports are all-or-nothing.** JSON backups are completely validated before
  one `writeRows`; Excel replace builds old tombstones, new rows, import-batch
  metadata, column membership and opening settings into that same transaction.
  Keep file/row/cell limits and import batch ownership intact. JSON restore
  accepts only UUID-shaped ids, one source account, unique rows and references
  resolvable from the bundle or the current account before any write begins.
- **Expected payments are derived lifecycle rows.** Rule edits reconcile only
  unpaid derivatives; paid/skipped history is immutable. Watch-only rules never
  create balance-affecting expected rows. Deleting a subscription/income rule
  and its pending/late rows is one write and undo restores the same snapshot.
  Recurring incomes declare `monthly | weekly | biweekly`; weekly cadences use
  an explicit ISO calendar-date anchor and advance by 7/14 days, never by a
  timezone timestamp. Missing anchors fail closed instead of inventing dates.
- **Category budgets are monthly targets, not financial movements.** One
  deterministic synced row exists per user/month/live expense category. Budget
  progress is derived from realized expense flows (refunds reduce spending);
  creating or editing a budget must never alter balance, forecast or ledger.
- **Referenced persons/payment sources cannot be directly deleted.** Count and
  show live usages, then require an explicit atomic reassignment (a payment
  source may be cleared because its references are nullable) before tombstoning.
- **iOS app data is sealed while the device is locked.** `app.json` declares
  the `com.apple.developer.default-data-protection` entitlement as
  `NSFileProtectionComplete`, so app-created files (the SQLite database,
  caches, downloaded updates) are unreadable on a locked device. This is safe
  because the app does no background file work: sockets close on background,
  notifications are local, and JS starts in `didFinishLaunching` (not during
  prewarm). The entitlement activates on the next local `npx expo run:ios
  --device` build. If that build ever fails on the Data Protection capability,
  or the app gains real background tasks, revisit this entitlement FIRST.
- **Every authenticated background task is session-scoped.** Auth activates an
  epoch with `startSyncSession`; sign-out/account deletion awaits
  `stopSyncSession`. Maintenance, FX, notifications, or any other async work
  that can outlive a render must run through `runSyncSessionTask`. A late
  response from user A must never write after user B becomes active.
- **Live SQLite reads expose state, not ambiguous empty arrays.** New
  data-critical screens consume the `*State` hooks (`loading`, `ready`,
  `refreshing`, `stale`, `error`), keep the last good snapshot, and offer the
  shared retry notice. The legacy array/value hooks are compatibility facades;
  never use an initial `[]`/`null` as proof that the account is empty.
- **External financial data is bounded and dated.** FX fetches follow the
  session abort signal, time out, validate response size/shape and persist the
  provider's declared business date (never a fabricated "today"). The in-memory
  FX cache is user-scoped. Missing rates stay missing; never interpret a foreign
  amount as TRY. Live market quotes expire only after the whole feed goes silent
  for 60 seconds (Harem re-sends a symbol only when its price CHANGES, so a
  stable/unchanged quote must keep showing while any other symbol still ticks —
  never drop a quote just because it did not move). The socket runs
  only while an unlocked authenticated app is active. The converter reuses a
  fresh live USD/EUR quote, then falls back to the dated user-scoped FX cache;
  it must never open a second market request for the same conversion.
- **Notification consent is device-local and opt-in.** Do not request
  notification permission during boot. Disabled notifications clear legacy
  schedules; sign-out/account switch clears scheduled and presented account
  details. Lock-screen content is neutral by default; names and amounts require
  a separate device-local confirmation. Turning details off or leaving an
  account cancels existing previews before any reschedule, and the next 60
  notifications are the bounded platform queue. Subscription logos resolve automatically: utilities and unknowns
  stay local; a known/stored domain may use Google's favicon service only after
  strict public-host validation/encoding, with disk cache and a local fallback.
- **Sensitive UI is covered outside the active app.** Keep the root
  `PrivacyCover`: native `inactive`/`background` states render an isolated modal
  before app-switcher capture, and framed web pages expose only the safe direct-
  open explanation. Do not put financial values in that cover.
- **Every back action has a deterministic parent.** Use `HeaderBackButton` for
  stack headers and `navigateBack` for explicit close/done actions; raw
  `router.back()` is not sufficient for direct links with no history. Nested
  Settings/Cash Flow stacks declare `index` as their initial route. Do not set a
  root `(tabs)` initial route: it mounts protected hooks on anonymous auth pages.
- **Sync ordering is server-authoritative.** Supabase normalizes `updated_at`;
  every push selects and conditionally merges that acknowledgement before its
  exact outbox events are removed. Never advance a pull cursor past an invalid
  row and never silently discard malformed/foreign outbox data—quarantine it
  in `sync_dead_letters`.
- **Supabase migration history must be reproducible.** Never name a timestamped
  migration with the reserved `_init.sql` suffix: the CLI skips it. After any
  migration change, `supabase migration list --linked` must show identical
  local/remote versions and `supabase db lint --linked` must stay clean. After
  the linked migration is applied, regenerate `src/sync/database.types.ts`
  with `npx --no-install supabase gen types typescript --linked`; that file is
  generated from the remote schema and must not be edited by hand.
- **Money is integer minor units** (kuruş) everywhere; format only at the edge
  with `formatMinor` (hero/detail figures, always full) or `formatMinorCompact`
  (fixed-width table cells, which abbreviate to deterministic `M`/`B` above
  `COMPACT_THRESHOLD_MINOR` so a large value never wraps). The single entry
  ceiling is `MAX_ABS_AMOUNT_MINOR` (~1 trillion major); the calculator/input
  cap follows `MAX_AMOUNT_MAJOR_DIGITS`, so raise the limit only in one place.
  Transaction reversals/refunds keep their original type
  and category with signed negative `amount_minor`/`amount_try_minor`; every
  other amount is positive. Income/expense categories must match transaction
  type; transfers use an expense-kind category. Dates are `YYYY-MM-DD` ISO
  strings, months `YYYY-MM`. New user-entered amounts must pass
  `isSupportedMinorAmount`; editable text uses the shared `INPUT_LIMITS` policy
  in both UI and repository boundaries. Do not apply those input limits while
  reading an otherwise valid legacy backup—old data must remain recoverable.
- **Analytics follows transaction type, not category appearance.** Expenses
  alone feed expense totals/distribution; transfers stay separate. Fixed
  expenses are installment/subscription-linked, and ordinary expenses default
  to variable. Credit cards require both statement and due days. Purchases keep
  their real `purchase_date`, belong to a persisted `credit_card_statements`
  period, and affect the ledger only on that statement's `due_date`. Upcoming
  charges collapse by the persisted statement; incomplete/ambiguous legacy
  rows never get a synthetic payment date.
  Non-card loan/installment rows remain standalone obligations on their real
  scheduled dates.
- **Current-balance reconciliation uses `balance_adjustments`.** It replaces one
  deterministic row per day; never rewrite the opening/start month to match a
  current balance. Adjustments are separate from income/expense analytics,
  visible and undoable. The current model has one aggregate Helix balance, not
  independently seeded balances per payment source.
- **Password recovery uses Supabase PKCE.** Web reset redirects must retain the
  Router `/helix` base path; installed builds use the existing `helix://` scheme.
  Recovery routes are intentionally exempt from normal signed-in/onboarding
  guards. Never expose whether a reset-request e-mail belongs to an account.
- **New subscriptions require a live expense category.** The repo validates it,
  not only the form. The friendly default is the deterministic, reusable
  `Abonelikler` category; legacy categoryless rows remain readable.
- **Cell notes have one natural identity per real month/category cell.** Save
  them through `src/data/cell-notes.ts`; never attach notes to UI-only pseudo
  groups such as `uncategorized`, and never reintroduce random note ids.
- **Onboarding draft ownership is index-safe.** Person index zero is the
  deterministic self person. Removing a watched person reassigns that person's
  draft payment sources to self and shifts later owner indices; repository
  seeding rejects a missing or ambiguous self and dangling source owners.
- **Haptics go through `src/ui/haptics.ts` and are iOS-only.** Selection
  feedback fires only when the choice changes; calculator digits stay quiet;
  success/warning/error notifications describe completed outcomes. Native
  haptic failures must never block the underlying action.
- **Production diagnostics stay silent.** App-owned diagnostics go through
  `src/services/logger.ts`; raw detail emits only in development. Production
  persists only the bounded, device-local `{time,scope,severity,category}`
  event shape and the user can export a PII-free health snapshot. Never persist
  or export tokens, passwords, row payloads, notes, e-mails, ids or amounts; do
  not reintroduce direct console logging in application code.
- **Workbook bytes are hostile until preflight passes.** Keep XLSX as a dynamic
  import, inspect ZIP central-directory entry/size/ratio limits before SheetJS
  inflates it, then enforce the existing sheet/row/cell/text limits. Large JSON
  restores validate completely first and consume bounded batches inside one
  SQLite transaction; do not trade all-or-nothing behavior for chunking.
- **UI strings live only in `src/i18n/tr.ts`.** Code is English, UI is Turkish.
- **Forms with an in-memory draft use `useDirtyExitGuard`.** Compare the real
  persisted/default snapshot, not merely whether an editor is open; successful
  save/delete exits call the returned `allowExit` wrapper. Never prompt for a
  derived async default or for an untouched inline editor.
- **Accessibility behavior lives in shared primitives.** Fields expose
  persistent labels and announced inline errors; custom modals isolate their
  contents, focus a heading and return focus where a trigger ref exists; charts
  expose a complete textual value summary and never rely on color alone. Keep
  modal container Pressables `accessible={false}` so they do not swallow their
  children. Physical VoiceOver/TalkBack remains a release acceptance check.
- **Color tokens separate accents from readable foregrounds.** Use
  `primary/positive/negative/warning` for fills, chart marks and essential
  boundaries; use the matching `*Text` token for text. Inputs use
  `controlBorder`, and primary/danger button copy uses `onPrimary`/`onNegative`.
  Every light/dark role pair stays under the automated contrast contract.
- **No manual `useMemo`/`useCallback` for derivations** — the React Compiler is
  enabled; hand-rolled memoization on unstable deps makes it bail out (lint
  error `preserve-manual-memoization`). Keep `useMemo` only where a hook rule
  demands a stable identity.
- Shared primitives live in `src/ui/components.tsx`; reuse them, don't restyle
  inline. Design tokens are in `src/ui/theme.ts`.
- The static web export is release-budgeted by `npm run bundle:check`; keep the
  CI step after `expo export` and change a threshold only with a measured export
  and an explanation in the package handoff.

## Directory layout

Root holds only what tooling **requires** there (Metro, Babel, Expo, TS,
ESLint, Drizzle, Vitest all resolve config from the project root) — don't try
to "tidy" configs into subfolders, it breaks the build. Everything else is
grouped:

```
src/app/        expo-router routes (file-based). (tabs)/ = tab screens,
                (auth)/ + (onboarding)/ = pre-login, modals at the top level.
src/ui/         shared visual primitives + design tokens (theme.ts). One
                component built once, reused everywhere. Never inline-restyle.
src/domain/     pure functions with unit tests (balance, installments,
                analytics, dates, money, recurrence). No React, no I/O.
src/db/         drizzle schema, async client, migrations.
src/data/       hooks + stable repo facade; repo/ contains focused I/O services.
src/sync/       Supabase outbox engine + status + generated remote DB types.
src/services/   side-effecting integrations (fx, markets, notifications,
                import/export).
src/i18n/tr.ts  every user-facing string (Turkish). Code stays English.
assets/brand/   the brand kit (symbols, lockups). assets/images/ = only the
                icons app.json references (icon/favicon/splash/adaptive).
tests/          vitest suites for src/domain.
```

## Design language

The look is **Warm Organic Editorial / Vintage Botanical Modernism** (moved off
the old indigo fintech palette 2026-07). Keep it; don't regress to indigo.

- **Palette (aligned to Claude's design tokens, 2026-07-10)** — the locked
  hexes now live in `src/ui/theme.ts`: clay/terracotta `#d97757` (primary, both
  themes) over a warm gray ramp — light bg cream `#faf9f5`, white surfaces
  `#ffffff`, alt `#f0eee6`, border `#e8e6dc`, ink `#1a1918`; dark bg `#141413`,
  surface `#262624`, alt `#30302e`, border `#3d3d3a`, text `#faf9f5`. Semantics
  (positive green, negative brick, warning amber, focus blue): exact hexes live
  ONLY in `src/ui/theme.ts` — copies written here drifted from the code once
  already, so cite the file instead of restating values. Chart series in `src/ui/charts.tsx`
  (index 1 = income/sage, index 5 = expense/brick) are a separate validated
  categorical set. (Previous linen/`#C9623F` palette retired 2026-07-10 for the
  Claude-token clay/warm-gray system; the *fonts* below are unchanged — Anthropic
  Sans/Serif are proprietary, so Inter + Fraunces remain the closest shippable
  match.)
- **Typography:** headings and amounts are the serif **Fraunces**
  (`@expo-google-fonts/fraunces`), body is **Inter**. Font tokens (`font.serif`
  etc.) and `type.*` scales live in `theme.ts`. A 2.5 s font-load grace in
  `_layout.tsx` falls back to system fonts (prevents the mobile-web white
  screen).
- **Motion:** `Animated.spring` only — `useSpringPress(0.96)` +
  `AnimatedPressable` for press feedback, `FadeIn` for list transitions. Shared
  motion primitives honor the system reduced-motion preference through
  `src/ui/motion.ts`; do not add screen-local accessibility listeners.
  Interruptible, React-Compiler-safe (no manual memo on unstable deps).
- **Radii/shadow:** soft — `radius` tokens 12–22, `cardShadow` very low opacity.
- **Logo:** the botanical DNA-helix mark. `src/ui/brand.tsx` `BrandMark` renders
  the theme-aware transparent symbol (`assets/brand/symbol-{light,dark}-t.png`);
  full lockups in `assets/brand/` for future use. (`src/ui/logo.tsx` is
  unrelated — it fetches subscription *merchant* favicons.)

## UI/UX rules the user enforces (non-negotiable)

The user is a visual perfectionist. Every UI package must satisfy these, and
after finishing you must sweep the **whole** app for them, not just the
reported items:

- **Never truncate text with an ellipsis (`…`).** If it doesn't fit, wrap it,
  shorten it, or change the layout — don't hide it behind `numberOfLines`.
  Dates, labels, button text must always be fully readable.
- **Vertically center every row control** (toggle / edit / delete) within its
  row — `alignItems: "center"`, aligned with *all* the row's content, not just
  the title.
- **No static / special-cased columns.** Everything a user sees in a table must
  be add/edit/delete-able by them; no bespoke per-column logic. Only Ay Başı
  and Güncel Bakiye are inert system calculations. Missing-category legacy data
  belongs in an actionable repair row outside the matrix, never a fake column.
- The Mali Tablo column editor must expose both ordinary category columns and
  user-defined computed columns. Both can be renamed, hidden, deleted and
  reordered. `isColumn=false` overrides imported `column_years` membership;
  recorded years may preserve membership/order but never defeat visibility.
- **Matching status chips share identical size and alignment** (equal
  height/width, symmetric).
- **Aggressively trim bottom safe-area padding** on mobile — no dead space at
  the end of a scroll (use `Math.max(insets.bottom, …)`, but don't overshoot).
- The **current month auto-focuses/centers** in tables.
- Do not present a vertically draggable editor as an iOS sheet: its native
  dismiss pan competes with row reorder even when dismissal is disabled. Use a
  normal stack card (or a true full-screen presentation when modal semantics
  are required), while keeping one shared editor/data path across entry points.

## Shipping updates (do this after every change — the agent owns it)

Two separate targets. **Pushing to `main` only ships the web app.** The phone
does NOT update by itself — you must publish the mobile OTA too, or the user
keeps seeing the old version (this is a recurring confusion; own it).

- **Web** — automatic: the `deploy-web` GitHub Action rebuilds and publishes to
  Pages on every push to `main`. Nothing else to do.
- **Mobile (JS/asset-only changes — the usual case)** — publish an EAS Update:
  ```
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  npx eas-cli update --channel preview -m "<short summary>" --non-interactive
  ```
  The machine is logged in as `topraksv`; the `preview` channel points to the
  **`preview`** branch (runtime `1.0.0`, from `runtimeVersion.policy:appVersion`).
  Local CNG builds embed the same channel through
  `updates.requestHeaders.expo-channel-name` in `app.json`; EAS build profiles
  declare their channel in `eas.json`.
  Do this after the commit/push whenever app code changed. The phone applies it
  on the **next cold start** (expo-updates downloads on launch, swaps in on the
  launch after) — tell the user to fully close and reopen the app once.
- **Native rebuild required** (not OTA-able) when: a native module / `app.json`
  plugin is added, the app icon/splash/adaptive icon changes, the Expo SDK or
  `runtimeVersion` bumps, or the free-Apple-ID signing has hit its 7-day expiry.
  That is a local, user-machine step — the user runs
  `npx expo run:ios --device` (their phone + Xcode; free Apple ID re-signs every
  7 days). EAS Build can't do device builds on a free Apple ID, so don't push
  users toward it; a local run build is the path. After a native rebuild, OTA
  updates flow again as long as the runtime version matches.

## Before you commit

Run all three; they must be clean:

```
npm run typecheck && npm test && npx expo lint
```

Verify web changes end-to-end with the Playwright flow (see the scratchpad
`flow.js`) against a static export, not just unit tests.

`main` is protected. Work on a package branch, open a PR, wait for the required
`quality` check, then merge; never bypass the check or force-push. The same
workflow publishes Pages only after quality succeeds. The exact release and
rollback procedure lives in `docs/RELEASE.md`.

## Commit message standard

Conventional-commit style, imperative mood, present tense:

```
<type>(<scope>): <summary ≤ 72 chars>

<body: what changed and WHY, wrapped ~72 cols. Bullet lists for
multiple independent changes. Reference the spec item when relevant.>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `ui`, `chore`, `docs`, `test`.
- **scope** (optional): the area touched — `cashflow`, `db`, `sync`, `ui`,
  `import`, `deploy`…
- The summary says what the change does, not what you did ("add calculator
  tab", not "added a calculator tab").
- The body explains the reasoning a diff can't; skip it only for trivial
  one-liners.

## What works well here (keep doing)

- **One reusable primitive over per-screen copies.** `StickyTable`, `Segmented`,
  `DateField`, `CardList` (list-in-a-card: dividers only *between* rows, nothing
  when empty), the calculator popup, `Logo` — each is built once and reused;
  Mali Tablo and Analiz share the same table. Add to `src/ui/`, don't inline.
- **Pure domain functions + unit tests** for anything with logic (balances,
  installments, the ledger anchor, spreadsheet parsing). They're cheap to test
  and caught real bugs.
- **Headless Playwright against a static export** for UI verification — but
  select chips/labels by partial text (they're emoji-prefixed) to avoid
  chasing phantom "bugs" that are really selector misses.
- **Deterministic ids for singletons** (the self person) so multi-device sync
  and double-taps converge instead of duplicating.
- **Derive, don't freeze, async defaults** — compute the default person/category
  from the live query each render instead of seeding state before it resolves.

## What to avoid (past hard structures we removed)

- The **synchronous sqlite bridge** (SAB + COOP/COEP + a service worker +
  main-thread busy-wait) — it white-screened and froze phones. Async only.
- **Node 24/26 locally** for this SDK — silent `expo export` failures.
- **`position: sticky`** for tables — works on web, dead on iOS.
- **Manual `useMemo` on unstable deps** — fights the React Compiler.
- **Free-text date inputs** — replaced by the calendar `DateField` to stop
  typos; prefer pickers/toggles over raw text for constrained values.
