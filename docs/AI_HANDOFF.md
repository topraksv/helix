# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-17 (Europe/Istanbul)
- Branch: `main`
- Completed package base: `e9e40d4`; application commit: `98fa44f`
- Toolchain used: Node 22
- Verification: typecheck, full tests, zero-warning Expo lint
- Test baseline: 24 files, 214 tests passing

## Active working tree

A four-package audit remediation is underway (Claude, from the 2026-07-17
repository audit). Package 1 (hygiene/docs) shipped as `98fa44f`. Remaining
queued packages: (2) data-layer hardening — Supabase sync indexes, server
CHECK bounds, cell_notes natural-key unique, pull cursor UUID validation,
password-verify cooldown, web CSP; (3) liveliness — markets trailing throttle,
dashboard skeletons, theme-token leaks, service-worker cache pruning; (4)
scale — shared live-query layer, typed SQL helpers, iOS data-protection
entitlement. Explicitly excluded by the user: calculator-tab IA change and
Supabase captcha/signup panel settings. Always re-check `git status`; Git
remains authoritative.

## Current architecture summary

- Expo SDK 54 / React Native / Expo Router; Node 22 is required locally.
- Local-first async SQLite through Drizzle's `sqlite-proxy`; never restore the
  synchronous bridge.
- User mutations go through `writeRows`; deletes are synced tombstones.
- Supabase sync uses an outbox, server RLS, and LWW merging.
- Money is integer minor units; dates/months are ISO strings.
- Pure business logic lives in `src/domain` and receives unit tests.
- Shared UI primitives and tokens live in `src/ui`; Turkish strings live in
  `src/i18n/tr.ts`.
- Web ships from `main`; app-code changes also require an EAS Update to the
  `preview` branch unless a native rebuild condition applies.

Read `AGENTS.md` for the complete, canonical rules and shipping procedure.

## Open audit backlog

No verified code finding from this package remains open. The installed app
still needs a human visual/gesture confirmation for the optically centred back
control, Mali Tablo entry-point drag reorder and exact single-line high-value
total; this session had neither a controllable browser nor an available local
simulator. Accepted constraints: the 17
moderate `npm audit --omit=dev` findings are in Expo SDK 54's build/config chain
and only offer a breaking SDK 57 fix; SDK 54 remains required by the installed
App Store Expo Go line. The `expo`/`expo-updates` patch alignment needs the next
local native iOS build before it exists in the binary. Physical haptic, system
permission and protected-data visual passes still require the installed device.

## Handoff update contract

At the end of each material task, replace stale information above and append a
short entry below. Keep entries factual and compact; Git history owns the full
chronology. **Keep at most the last 5 entries here** — when adding a sixth,
move the oldest into `docs/handoffs/<year-month>.md` (create it if missing).
Every entry must include:

- date and agent (`Codex` or `Claude`);
- branch and the pre-change/base commit (the resulting HEAD comes from Git);
- outcome and why;
- files or subsystems changed;
- checks actually run and their results;
- commit/push/web/OTA/native-build state;
- remaining work, risks, or decisions needed.

Never mark another agent's work confirmed without independently inspecting the
diff and running checks proportionate to the change.

## Recent handoffs

Older entries are archived verbatim in `docs/handoffs/` (currently
`2026-07.md`); only the newest entries live here.

### 2026-07-17 — Claude (audit package 1: hygiene and documentation truth)

- Base `e9e40d4`, branch `main`; clean tree. First of four packages remediating
  the 2026-07-17 repository audit (user excluded the calculator-tab IA change
  and Supabase captcha panel work).
- Enforced Node 22 via `engines` + `engine-strict` (was docs-only); cleaned
  `.gitignore` (orphan `example` line, root-scoped xlsx ignores so fixtures
  stay committable, `*.pem` moved to the signing block); eslint now ignores
  `dist-local`; removed the unused `@/*` tsconfig alias (zero usages).
- Removed `void userId` + its false comment in `sync/engine.ts` (the parameter
  IS used); corrected two more stale comments (`schema.ts` statement_day
  "reserved for Faz 2" while five files use it; `migrate.ts` "exact drizzle
  bookkeeping" while hash stays empty by design).
- README: count-free test badge (hardcoded 209 had drifted from the real 214),
  palette hexes defer to `theme.ts`, added sync-flow mermaid diagram and the
  three correctness guarantees, **Supabase setup now applies all migrations**
  (following the old step broke sync on fresh projects), roadmap filled from
  the real backlog. AGENTS.md: semantic palette pointer instead of drifted
  hexes, xlsx CDN audit blind-spot note, handoff 5-entry pruning rule.
  AI_HANDOFF now keeps the newest entries only; the rest moved verbatim to
  `docs/handoffs/2026-07.md`.
- Checks: `npm run typecheck`, `npm test` (24 files/214), `npx expo lint`
  (exit 0) all pass. Deleted the stale untracked `dist-local/` build copy.
- Shipped as `98fa44f` and pushed; the Pages workflow redeploys the web app.
  **No mobile OTA was published for this package**: the only bundle-affecting
  edits are comment/no-op removals with identical runtime behavior; package 2+
  will carry these bytes in its OTA.

### 2026-07-16 — Codex (back, column drag and high-total UI follow-up)

- Base `4f570c7`, branch `main`; the working tree was clean with no staged work.
  The user supplied three installed-iOS screenshots proving that the previous
  geometric centring, sheet-contained drag and long-total sizing still needed
  correction.
- `HeaderBackButton` keeps one 82×44 hit target but now centres its absolute
  icon/text plane inside the capsule and applies a measured optical offset for
  the chevron's transparent bounds and Inter line box. The labelled **Geri**
  control and deterministic `navigateBack` behavior remain shared across web
  and native.
- Both column entry points still render the same `CategoriesScreen` and
  `ComputedColumnsScreen`, call the same `DraggableList`, and persist the same
  synced `sortOrder`; no duplicate editor or reorder service was added. The Mali
  Tablo route now opens as a normal stack card because an iOS sheet owns the
  vertical pan and can steal the grip gesture even with dismissal disabled.
  This hard-won presentation rule is recorded in `AGENTS.md`.
- Cell totals retain the exact full `formatMinor` value. Long hero figures step
  down further, stay right-aligned in an unconstrained horizontal container and
  therefore cannot split the minus sign, major value and kuruş across lines;
  horizontal access remains as a fallback at exceptionally narrow widths.
- Checks: `npm run typecheck`, `npm test` (24 files/214 tests), `npx expo lint`,
  `git diff --check`, 49-route static web export and the iOS/Android EAS bundle
  exports passed. Browser discovery returned no available profile, so no
  pixel-perfect or physical-gesture result is claimed. Production root,
  Columns Editor and Cell Editor returned HTTP 200.
- Shipped as `b8bc26e`, pushed to `main`; GitHub Pages run `29514391456`
  completed successfully. EAS asset upload hit the known Google Storage DNS
  failure three times; a command-scoped, uncommitted resolver preload using a
  directly verified Google IPv4 endpoint completed the unchanged fourth
  upload. `preview` update group `dc449f63-7497-44d0-8472-d4044a923e3b`
  published on runtime `1.0.0` (iOS
  `019f6bba-2c65-7ea8-a6c9-96d891155e83`, Android
  `019f6bba-2c65-797c-91d3-e87e9f8fec8e`). No native rebuild was required; the
  phone applies it after a complete close and reopen.

### 2026-07-16 — Codex (six UX/UI regressions, verified completion)

- Base `2933e27`, branch `main`. There were no staged changes; the only initial
  unstaged file was Claude's Hermes-safe compact-money formatter in
  `src/domain/money.ts`. It was understood and retained rather than reset.
- Replaced the visible transaction-card heading/accessibility label with the
  single requested **İade** control, while presentation badges now distinguish
  **Gider iadesi**, **Gelir geri ödemesi** and **Yatırımdan çekim**. Descriptions
  state the exact balance and category effect; no "Normal" choice remains.
- Rebuilt `HeaderBackButton` as one fixed 82×44 centred control with a common
  icon/text line box. The existing deterministic `navigateBack` fallbacks and
  navigation tests remain unchanged.
- Confirmed ordinary new transactions already defaulted to today in `27da3db`.
  Fixed the remaining quick-cell bug: typing an arithmetic expression no longer
  marks a current-day entry as a dateless aggregate. The shared
  `dateForMonthEntry` rule uses today for the current month; selecting another
  month remains explicit historical/future intent.
- The Columns Editor failure was an async live-query race, not a second drag
  implementation: ending a drag re-enabled the parent scroll, recreated the
  filtered source array and briefly restored its old order before `writeRows`
  became observable. `DraggableList` now holds the pending key order until the
  source acknowledges it, rolls back with error feedback on write failure, and
  uses a non-collapsible 44×44 grip in both Settings and the modal. Visible arrow
  buttons remain removed; screen-reader increment/decrement actions remain as
  the required non-visual accessibility path.
- Live quote gaps had two causes. `27da3db` correctly retained unchanged
  symbols during active feed events, but transient `disconnect`/`connect_error`
  events still erased every verified quote immediately. Short reconnects now
  retain quotes without extending the original 60-second stale deadline.
- Large amounts accept legitimate billion-scale values up to
  `₺999.999.999.999,99`. Over-limit pasted/typed values are no longer silently
  truncated into a different valid amount; they remain visible, fail parsing,
  disable saving and show the exact supported limit. Fixed-width table/chart
  cells use deterministic Hermes/web `M`/`B` formatting from 1 million upward;
  detail/input surfaces retain the exact full value. The dashboard hero steps
  down further at the longest supported value.
- Cleanup was intentionally narrow: removed the compact `Intl` formatter
  map/factory in favour of one bounded number formatter, refreshed stale
  comments and ran TypeScript's strict unused-symbol scan. No additional dead
  production code was found. Accessibility reorder actions and calculator digit
  limits were verified as live dependencies and retained.
- Checks: `npm run typecheck`, `npx tsc --noEmit --noUnusedLocals
  --noUnusedParameters`, `npm test` (24 files/214 tests), `npx expo lint`,
  `git diff --check` and the 49-route static web export all passed. Focused tests
  cover current/other-month quick-entry dates, M/B boundaries, non-silent
  over-limit rejection and reconnect expiry. A live read-only socket probe
  received valid `ALTIN`, `CEYREK_YENI`, `ATA_YENI`, `USDTRY` and `EURTRY`.
  Browser discovery returned no controllable profile and no local simulator was
  available, so no pixel-perfect or physical-gesture pass is claimed.
- Shipped as `929fb59`, pushed to `main`; GitHub Pages run `29512226065`
  completed successfully and the production root/Sign In/Transaction/Columns
  Editor routes returned HTTP 200. After two transient Google asset-storage DNS
  failures, EAS `preview` update group
  `00cfa828-fb32-426b-9cf2-990938af5248` published for iOS and Android on
  runtime `1.0.0` (iOS `019f6b98-8e90-7950-b1a9-2f79a8bdc139`, Android
  `019f6b98-8e90-7dad-b12a-6c70c2bb72c3`). No native rebuild was required; the
  phone applies the OTA after fully closing and reopening the app.

### 2026-07-16 — Claude (six reported UX/UI bugs, second pass)

- Base `a5a2920`, branch `main`; changes are in the working tree, NOT committed.
  These revise Codex's just-shipped first pass after the user reviewed it and
  reported six concrete bugs; each edit was made on top of the current HEAD
  files (verified: the stash re-applied cleanly with no conflict).
- Fixes: (1) transaction form drops the confusing "normal/iade" segmented for a
  single **İade** toggle with an in-card description (`transaction.tsx`, new
  `tr.tx.refundToggleHint`, removed `entryEffect`/`normalEntryLabel`). (2)
  `HeaderBackButton` centres the chevron+label on one optical line (icon boxed
  to the label line-height, `includeFontPadding:false`). (3) New transactions
  default to **today** (specific day, hits the balance) instead of month-only;
  future/aggregate stay one explicit tap away. (4) Column reorder is drag-only —
  the mobile arrows were removed, the `columns-editor` modal now sets
  `gestureEnabled:false` (its swipe-dismiss was stealing the drag, which is why
  it worked in the Settings stack but not the modal), and reorder moved to
  screen-reader `accessibilityActions` on the grip; `DraggableList` lost the
  now-dead `canMoveUp/canMoveDown`. (5) Live-market quotes no longer disappear
  intermittently — a stable (unchanged) symbol keeps showing while the feed is
  alive; only whole-feed silence for 60 s clears everything. (6) Amount ceiling
  raised to ~1 trillion (`MAX_ABS_AMOUNT_MINOR`), input capped at
  `MAX_AMOUNT_MAJOR_DIGITS`, and fixed-width table cells use the new
  `formatMinorCompact` (locale `Mn`/`Mr`, threshold 1.000.000 TL so the widest
  full value still fits a narrow cell — no `numberOfLines`, per the design
  rules); `Amount` steps its font down for long strings so hero/row figures stay
  one line without truncation or wrap.
- Dead code removed: the reorder arrows and their `canMove*` API, the two unused
  i18n keys, and now-unused imports (`Platform`, `ChevronUp/Down`, `formatMinor`
  where fully replaced). Impact scan: the amount ceiling is centralized through
  `MAX_ABS_AMOUNT_MINOR`/`MAX_AMOUNT_MAJOR_DIGITS` (calculator + backup already
  follow it or use an independent safe-integer bound), so nothing else needed a
  matching bump.
- Checks: `npm run typecheck`, `npm test` (24 files/211, incl. new money
  ceiling/compact/input-cap cases and three updated boundary tests) and
  `npx expo lint` (exit 0) all pass; 49-route static web export clean. No
  controllable browser this session → no new pixel-level visual pass claimed.
- Shipped as `27da3db`, pushed to `main`; the `deploy-web` run `29507932867`
  completed successfully and production Sign In returned HTTP 200. The mobile
  OTA published to EAS `preview` (iOS + Android, runtime `1.0.0`) after several
  transient `storage.googleapis.com` DNS `ENOTFOUND`/`REFUSED` upload failures;
  the active update group is `cecc08c4-d1b0-4bd5-af58-4441cf12e2ef`. Post-review
  fix: the first pass used `numberOfLines={1}` in table cells — a design-rule
  violation — so it was removed and the compact threshold lowered to 1.000.000
  TL so the widest full value still fits a narrow cell unaided. Phone applies
  the OTA on the next cold start (fully close and reopen the app once).

### 2026-07-16 — Codex (requested mobile OTA republish)

- Base `ba4d63c`, branch `main`; working tree was clean and runtime policy still
  resolved to `1.0.0` before publishing.
- Published the current mobile finance UI, analytics, input-validation and
  live-rate changes to EAS Update branch `preview` for both iOS and Android.
  Update group: `fa97ec26-af8a-4ce0-9383-8cf15e52ebe5`; iOS update:
  `019f6b22-bab1-7ba4-a2d5-6f03421ab7c8`; Android update:
  `019f6b22-bab1-7968-bc8c-52c6823e7725`.
- The first upload attempt hit the already-seen transient Expo asset-storage
  DNS `ENOTFOUND`; the unchanged retry uploaded both bundles and published
  successfully. No source file or application behavior changed in this task.
- The installed app downloads on a cold start and applies on the following
  launch. If the existing iOS binary cannot load the SDK patch-aligned bundle,
  the previously recorded `npx expo run:ios --device` rebuild remains required.
