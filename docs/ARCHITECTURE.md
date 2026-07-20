# Helix architecture

Stable structure, data flow and boundaries. Written in English because it is the
offload target for [`AGENTS.md`](../AGENTS.md) and is dense with code
identifiers; the owner-facing contracts (`RELEASE`, `TESTING`, `SECURITY`,
`PRIVACY`) stay Turkish. `AGENTS.md` owns the normative rules — this file owns
the shape they apply to and the reasons behind them. Commands live in
[`TESTING.md`](TESTING.md) and [`RELEASE.md`](RELEASE.md).

## Stack

| Layer | Choice | Constraint |
|---|---|---|
| App | Expo SDK 54, React Native 0.81, React 19, Expo Router 6 | downgraded from 57 so the project matches the App Store build of Expo Go, which is pinned to SDK 54; read the [versioned docs](https://docs.expo.dev/versions/v54.0.0/). Expo Go still cannot open the project reliably across SDK lines — use a local device build |
| Build | Node 22 (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`) | SDK 54 tooling breaks on Node 24/26 native TS stripping (it loads `expo-modules-core/src/index.ts`); CI is pinned to 22 |
| Local data | `expo-sqlite` async + Drizzle `sqlite-proxy` | synchronous SQLite is banned (see [Rejected approaches](#rejected-approaches)) |
| Remote | Supabase Auth + Postgres, owner-only RLS | the client only ever holds the publishable/anon key |
| State | zustand | session, sync status, undo, dialog, markets, fx, device preferences |
| Compiler | React Compiler enabled | manual `useMemo`/`useCallback` on unstable deps is a lint error |

`xlsx` is pinned to SheetJS's official CDN tarball because the npm registry copy
lags; `npm audit` and Dependabot cannot see it, so check upstream manually
whenever import code changes. `expo-sharing` must stay out of `app.json`
plugins — SDK 54 ships no config plugin for it and `expo export` fails.

Dependabot ignores routine version updates at every SemVer level for the
Expo-managed React/React Native/native-library matrix: React Native is pre-1.0,
so an incompatible SDK jump can arrive labelled "minor" and even a patch can
leave Expo's supported matrix. Routine ESLint versions and TypeScript majors are
guarded by the same coordinated `BACKLOG-SDK-01` toolchain upgrade, and
Dependabot currently generates invalid npm lockfiles for those updates — apply a
proven compatible patch by hand instead. Security updates and independent
dependency updates stay active; remove the guards only in that upgrade plus
native rebuild.

## Directory layout

Root holds only what tooling requires there — Metro, Babel, Expo, TS, ESLint,
Drizzle and Vitest all resolve config from the project root. Moving them into
subfolders breaks the build.

```
src/app/        expo-router routes. (tabs)/ = tab screens, (auth)/ +
                (onboarding)/ = pre-login, modals at the top level.
src/ui/         shared visual primitives + design tokens (theme.ts).
src/domain/     pure functions with unit tests (balance, installments,
                analytics, dates, money, recurrence). No React, no I/O.
src/db/         drizzle schema, async client, local migrations.
src/data/       live hooks + the stable repo facade; repo/ holds focused I/O.
src/auth/       Supabase session lifecycle, recovery, login history, errors.
src/sync/       outbox engine, status, generated remote DB types.
src/services/   side-effecting integrations (fx, markets, notifications,
                import/export, diagnostics) plus the device-local storage
                they sit on (kv, device-preferences). There is no src/lib.
src/i18n/tr.ts  every user-facing string (Turkish). Code stays English.
assets/brand/   brand kit. assets/images/ = only the icons app.json
                references. assets/screenshots/ = the README gallery.
supabase/       remote migrations, config.toml, pgTAP tests.
tests/          vitest suites. e2e/ = Playwright specs + visual baselines.
```

`assets/screenshots/` holds the README gallery: a uniform 780×1688 dark set
captured from a seeded multi-month demo restore, never from a real account.
There is no committed capture script — regenerate by restoring a demo JSON
bundle locally, shooting all screens at one viewport, and deleting the bundle
afterwards.

**Dependency direction:** `app → data → db`, `app → domain`,
`data|services → db`. `domain` imports nothing from the app, UI or I/O layers.
Routes and UI import only the public `src/data/repo.ts` facade, never
`src/data/repo/*` internals and never raw SQL. Cross-domain helpers stay
internal to `src/data/repo/`; a repo service must not import another service in
a cycle.

## Write path

Every user write is one atomic `writeRows` transaction that pairs the data rows
with their outbox events and refreshes `last_entry_at`. Deletes are tombstones
(`softDelete`) — there are no hard deletes, because sync and undo both need the
row to keep existing.

```
UI → repo facade → writeRows(rows + outbox events)  [one SQLite transaction]
                 → push: select the server-normalized updated_at, merge it,
                   only then remove those exact outbox events
                 → pull: validate each row; quarantine malformed or foreign
                   rows in sync_dead_letters; never advance the cursor past one
```

Sync ordering is server-authoritative: Supabase normalizes `updated_at` and the
client merges that acknowledgement rather than trusting its own clock. Conflicts
resolve last-write-wins on that server value.

Imports are all-or-nothing on the same path. A JSON backup is validated
completely — UUID-shaped ids, one source account, unique rows, every reference
resolvable from the bundle or the current account — before a single write. An
Excel replace builds old tombstones, new rows, import-batch metadata, column
membership and opening settings into one transaction.

## Read path

Data-critical screens read through the `*State` hooks, which expose
`loading | ready | refreshing | stale | error`, keep the last good snapshot and
offer the shared retry notice. The legacy array/value hooks are compatibility
facades only.

A snapshot belongs to the parameters that produced it. `useLive` keeps the last
good data across re-runs over the *same* parameters (local writes, retries) and
drops it when `deps` change, because the query is then asking a different
question — another user, month or account. `updatedAt` is the only proof the
query ran for the *current* parameters. Guard flags go through `readSyncedFlag`,
whose `null` means unresolved.

## Domain model

- **Money is integer minor units** (kuruş) end to end; formatting happens only
  at the edge. `formatMinor` for hero/detail figures (always full),
  `formatMinorCompact` for fixed-width table cells (deterministic `M`/`B` above
  `COMPACT_THRESHOLD_MINOR` so a large value never wraps). The single entry
  ceiling is `MAX_ABS_AMOUNT_MINOR` (~1 trillion major units); the
  calculator/input cap follows `MAX_AMOUNT_MAJOR_DIGITS`.
- **Dates** are `YYYY-MM-DD` ISO strings, months `YYYY-MM`.
- **Signs:** reversals and refunds keep their original type and category with a
  signed negative `amount_minor`/`amount_try_minor`; every other amount is
  positive.
- **Types drive analytics, not category appearance.** Expenses alone feed
  expense totals and distribution; transfers stay separate and use an
  expense-kind category. Fixed expenses are installment/subscription-linked;
  ordinary expenses default to variable.
- **Credit cards** require both statement and due days. A purchase keeps its
  real `purchase_date`, belongs to a persisted `credit_card_statements` period,
  and affects the ledger only on that statement's `due_date`. Non-card
  loan/installment rows stay standalone obligations on their real dates.
- **The ledger back-anchors** (`resolveLedgerAnchor`): history entered before
  the configured opening month still renders — the start extends to the earliest
  data and the opening balance is back-computed.
- **Expected payments are derived lifecycle rows.** Rule edits reconcile only
  unpaid derivatives; paid/skipped history is immutable. Watch-only rules never
  create balance-affecting rows. Recurring incomes are `monthly | weekly |
  biweekly`; weekly cadences advance by 7/14 days from an explicit ISO calendar
  anchor, never from a timezone timestamp.
- **Category budgets are monthly targets, not movements** — one deterministic
  synced row per user/month/live expense category, progress derived from
  realized expense flows.
- **Current-balance reconciliation uses `balance_adjustments`** — one
  deterministic replaceable row per day, separate from income/expense analytics.
  There is one aggregate Helix balance, not per-source balances.

## Design language

**Warm Organic Editorial / Vintage Botanical Modernism** (moved off the old
indigo fintech palette in 2026-07). Do not regress toward indigo.

- **Palette:** `src/ui/theme.ts` is the only source for the warm neutral/clay
  ramp and the semantic accents — income/positive green, expense/negative red,
  warning warm amber. Purple is banned; the only blue is the `focus` ring.
  `tests/theme-contrast.test.ts` enforces the hue contract and WCAG AA for every
  `*Text` role. Charts derive series from those roles; modal scrims use `scrim`.
  Anthropic's own fonts are proprietary, so Inter + Fraunces are the closest
  shippable pair.
- **Typography:** headings and amounts in the serif **Fraunces**
  (`@expo-google-fonts/fraunces`), body in **Inter**. `font.*` and `type.*`
  tokens live in `theme.ts`. A 2.5 s font-load grace in `_layout.tsx` falls back
  to system fonts, which is what prevents the mobile-web white screen.
- **Motion:** `Animated.spring` only — `useSpringPress(0.96)` +
  `AnimatedPressable` for press feedback, `FadeIn` for list transitions. Shared
  primitives in `src/ui/motion.ts` honor the system reduced-motion preference;
  do not add screen-local accessibility listeners.
- **Radii/shadow:** soft — `radius` tokens 12–22, `cardShadow` at very low
  opacity.
- **Logo:** the botanical DNA-helix mark. `BrandMark` in `src/ui/brand.tsx`
  renders the theme-aware transparent symbol from `assets/brand/`.
  `src/ui/logo.tsx` is unrelated — it resolves subscription *merchant* favicons.
- **Cross-platform tables** use `src/ui/sticky-table.tsx`: fixed columns are
  split out of the horizontal ScrollView under one vertical ScrollView, with
  fixed row heights so the halves stay aligned.

## Why these rules exist

Incidents that produced a rule. Kept so the rule is not "simplified" away.

| Rule | Incident |
|---|---|
| `useLive` drops snapshots on a `deps` change | carrying `updatedAt` across a change made "still resolving" indistinguishable from "resolved false"; after logout → login the wiped local DB answered `onboarded = false` and an existing account was thrown into Quick Start for ~2 s |
| Pushes into a nested tab stack pass `{ withAnchor: true }` | without it the stack mounted with only the pushed route, `popToTopOnBlur` became a no-op and the tab was stuck until an app restart (Summary → Analysis) |
| …and multi-entry screens record their source | the anchor mounts the index *under* the pushed route, so plain history sends the user back to a screen they never visited; one global back target fixes one entry path and breaks the other |
| Route params are validated before use | range helpers throw (`lastDayOf("2026-13")`), so an unchecked param crashes during render — a white screen no handler catches |
| `controlBorder` is separate from `border` | a divider only has to be visible; a control must clear WCAG 1.4.11 (3:1) on every surface. Both toggle tracks are low-contrast warm neutrals, so the outline is what makes a switch visible at all — the refund row repainted itself in `primarySoft`, the active track colour, and the switch measured 1.00:1 |
| Undo snackbar and `InitialsBadge` are tested separately | the snackbar inverts the page (it paints `palette.text` as background, so its foregrounds must be `background`), and the name-derived badge hue is generated in `src/ui/badge-color.ts`, which caps relative luminance so the white monogram clears AA |
| Chart series are ordered by hue distance | green/amber/red must never be adjacent, counting the wrap from last back to first; the semantic accents only appear there because purple and non-focus blue are banned, and they must not read as a status ramp |
| Account freeze rolls back on every failure path | persisting `account_frozen` before the network work while cleaning up on only three paths left a frozen account and a stuck `isFreezing`, which suppressed the reactivation gate |
| Table privileges are stated in a migration | RLS filters rows but cannot grant the table privilege needed to reach them; the hosted project predated Supabase's default-privilege change, so a rebuild from history gave `authenticated` nothing and the pgTAP suite died on "permission denied for table persons" |
| `dist/404.html` is a copy of the root `index.html` | copying Expo Router's `+not-found` output hydrates the wrong route before the client resolves the deep link and emits React error #418 |
| iOS data protection is safe here | `NSFileProtectionComplete` seals app-created files while the device is locked; that only works because the app does no background file work — sockets close on background, notifications are local, JS starts in `didFinishLaunching`, not during prewarm. Revisit this entitlement first if a build fails on the Data Protection capability or the app gains real background tasks |

## What works well here

- **One reusable primitive over per-screen copies.** `StickyTable`, `Segmented`,
  `DateField`, `CardList` (dividers only *between* rows, nothing when empty),
  the calculator popup, `Logo` — built once, reused everywhere. Mali Tablo and
  Analiz share the same table. Add to `src/ui/`, do not inline-restyle.
- **Pure domain functions with unit tests** for anything with logic. Cheap to
  test, and they have caught real bugs.
- **Headless Playwright against a static export** for UI verification — select
  chips and labels by partial text (they are emoji-prefixed) so a selector miss
  is not mistaken for a bug.
- **Deterministic ids for singletons** (the self person) so multi-device sync
  and double-taps converge instead of duplicating.
- **Derive, don't freeze, async defaults** — compute the default
  person/category from the live query each render instead of seeding state
  before it resolves.

## Rejected approaches

- **The synchronous SQLite bridge** — SharedArrayBuffer + COOP/COEP + a service
  worker + a main-thread busy-wait. It white-screened and froze phones. Async
  only, forever.
- **Node 24/26 locally for this SDK** — silent `expo export` failures.
- **CSS `position: sticky` for tables** — works on web, ignored by iOS.
- **Manual `useMemo` on unstable deps** — fights the React Compiler.
- **Free-text date inputs** — replaced by the calendar `DateField`; prefer
  pickers and toggles for constrained values.
- **A second state or data-fetching library** — zustand is the incumbent. A
  measured defect has to justify adding one.
