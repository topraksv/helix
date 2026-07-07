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
