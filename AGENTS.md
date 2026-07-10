# Helix — agent notes

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
- **Money is integer minor units** (kuruş) everywhere; format only at the edge
  with `formatMinor`. Dates are `YYYY-MM-DD` ISO strings, months `YYYY-MM`.
- **UI strings live only in `src/i18n/tr.ts`.** Code is English, UI is Turkish.
- **No manual `useMemo`/`useCallback` for derivations** — the React Compiler is
  enabled; hand-rolled memoization on unstable deps makes it bail out (lint
  error `preserve-manual-memoization`). Keep `useMemo` only where a hook rule
  demands a stable identity.
- Shared primitives live in `src/ui/components.tsx`; reuse them, don't restyle
  inline. Design tokens are in `src/ui/theme.ts`.

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
src/data/       hooks + repo (live queries, maintenance).
src/sync/       Supabase outbox engine + status.
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

- **Palette is locked** — never change these hexes (`src/ui/theme.ts`):
  linen `#F3EFE0` (light bg), obsidian `#181817` (dark bg), ink `#1E1E1E`,
  ivory `#F6F5F2`; terracotta/copper `#C9623F` (primary, both themes), sage
  `#7D8370`, camel `#C5A07F`. Chart series in `src/ui/charts.tsx` (index 1 =
  income/sage, index 5 = expense/brick).
- **Typography:** headings and amounts are the serif **Fraunces**
  (`@expo-google-fonts/fraunces`), body is **Inter**. Font tokens (`font.serif`
  etc.) and `type.*` scales live in `theme.ts`. A 2.5 s font-load grace in
  `_layout.tsx` falls back to system fonts (prevents the mobile-web white
  screen).
- **Motion:** `Animated.spring` only — `useSpringPress(0.96)` +
  `AnimatedPressable` for press feedback, `FadeIn` for list transitions.
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
  be add/edit/delete-able by them; no bespoke per-column logic.
- **Matching status chips share identical size and alignment** (equal
  height/width, symmetric).
- **Aggressively trim bottom safe-area padding** on mobile — no dead space at
  the end of a scroll (use `Math.max(insets.bottom, …)`, but don't overshoot).
- The **current month auto-focuses/centers** in tables.

## Before you commit

Run all three; they must be clean:

```
npm run typecheck && npm test && npx expo lint
```

Verify web changes end-to-end with the Playwright flow (see the scratchpad
`flow.js`) against a static export, not just unit tests.

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
