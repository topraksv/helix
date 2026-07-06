# Helix — agent notes

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Architecture invariants

- **All SQLite access is async**, through `getSqliteAsync()` / drizzle's
  `sqlite-proxy` driver. Never reintroduce the synchronous API — it needs
  SharedArrayBuffer + COOP/COEP on web and froze mobile browsers.
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
