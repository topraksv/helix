# Helix engineering invariants

This is the source-linked contract for domain, data, sync, security, privacy
and shared UI behavior. It is policy, not a substitute for runtime validation;
source and tests win when this file drifts.

## Data and sync

- All SQLite access is async (`getSqliteAsync()` and Drizzle `sqlite-proxy`).
  Never reintroduce the synchronous API.
- Every user write goes through `writeRows`: data, outbox and `last_entry_at`
  are one transaction. Deletes are tombstones, never hard deletes.
- Routes and UI import only the stable `src/data/repo.ts` facade. Implementations
  live under `src/data/repo/` and must not form import cycles.
- Sync is server-authoritative: merge Supabase's normalized `updated_at` before
  removing exact outbox events; never advance a pull cursor past invalid data;
  quarantine malformed or foreign rows in `sync_dead_letters`.
- Imports validate the complete JSON bundle or Excel replace plan before one
  atomic write. Preserve file/row/cell/ZIP limits, enforce actual bytes, keep
  XLSX dynamic, and batch only inside the same transaction for large restores.
- Do not apply new input limits while reading a valid legacy backup.
- Supabase migrations are reproducible: no `_init.sql`, local/linked history
  must agree, `db lint --linked` must pass, and generated database types are
  regenerated rather than hand-edited.
- Authenticated background work is session-scoped through
  `startSyncSession`/`stopSyncSession`/`runSyncSessionTask`; a late user-A
  response must not write after user B becomes active.
- Repository, restore, remote-pull and outbox-push boundaries validate runtime
  enums, ownership, dates, currency and positive amounts. TypeScript and UI
  guards are defense-in-depth, not authorization.

## Domain and financial meaning

- Money is integer minor units. Format only at the edge with `formatMinor` or
  `formatMinorCompact`; raise `MAX_ABS_AMOUNT_MINOR` or
  `MAX_AMOUNT_MAJOR_DIGITS` in one place only. New amounts pass
  `isSupportedMinorAmount`, and editable text uses `INPUT_LIMITS` at both UI and
  repository boundaries.
- Refunds and reversals keep their type/category with a negative amount;
  every other amount is positive. Category kind must match transaction type;
  transfers use an expense-kind category.
- Dates are `YYYY-MM-DD`; months are `YYYY-MM`. Analytics follows transaction
  type, not category appearance.
- Credit-card purchases affect the ledger on a persisted statement `due_date`.
  Ambiguous legacy rows never receive a synthetic payment date.
- The ledger back-anchors before the opening month. A month total and its
  breakdown come from one accessor: use `monthFlowTotals` for totals beside
  flows and `monthColumnBasis` for computed columns; never pair `closingMinor`
  with `byCategory`.
- Expected payments are derived lifecycle rows. Reconcile only unpaid
  derivatives; paid/skipped history is immutable; watch-only rules do not
  create balance rows. Weekly/biweekly income advances 7/14 days from an
  explicit ISO anchor and fails closed when the anchor is absent.
- Investment dates are valid, no later than today, at wallet and operation
  boundaries, restore/pull validation and outbound quarantine.
- Category budgets never move money. Category deletion soft-deletes its
  budgets in the same write; orphan maintenance tombstones only a budget whose
  category row is provably deleted.
- Current-balance reconciliation uses `balance_adjustments`, never an opening
  month rewrite.
- Referenced persons and payment sources require explicit atomic reassignment
  before deletion; a payment source may be cleared because its references are
  nullable.
- New subscriptions require a live expense category in the repository and use
  the deterministic reusable `Abonelikler` default.
- Cell notes have one natural identity per real month/category cell. Never
  attach notes to pseudo-groups or generate random note ids.
- Onboarding draft person index zero is deterministic self; removing a watched
  person reassigns draft sources to self and shifts later indices safely.

## Freshness and external data

- Data-critical screens expose `loading`/`ready`/`refreshing`/`stale`/`error`
  through `*State` hooks and the shared retry notice. Initial `[]` or `null`
  is never evidence that an account is empty; `readSyncedFlag(null)` is
  unresolved, not false.
- FX requests follow the session abort signal, timeout and size/shape checks,
  and store the provider's business date in a user-scoped cache. Missing rates
  remain missing; a foreign amount is never treated as TRY.
- Market quotes separate display continuity from conversion freshness. A card
  may show a dated last-known quote, but conversion expires 60 seconds after
  the quote was last confirmed live. The converter reuses the card quote and
  ledger-writing conversions require the strict `marketSellRateTry` contract.
  The socket runs only for an unlocked, authenticated active app.

## Privacy and security

- Notification permission is device-local and opt-in; never request it at boot.
  Lock-screen content is neutral unless details are separately enabled. Sign-out
  and account switching cancel previews before rescheduling.
- Subscription logos stay local for utilities/unknowns. A known domain may use
  Google's favicon service only after strict public-host validation and
  encoding, with disk cache and local fallback. Web CSP keeps
  `https://*.gstatic.com` in `img-src`.
- Keep the root `PrivacyCover` outside the active app and never put financial
  values in it. iOS data remains `NSFileProtectionComplete` while no background
  file work exists.
- Production diagnostics use `src/services/logger.ts`; raw detail is
  development-only. Never persist tokens, passwords, payloads, notes, e-mails,
  ids or amounts. Application code has no direct console logging.
- Diagnostic labels use the bounded internal scope grammar and fail closed to
  `app`. Uploads send only the already-allowed redacted ring to the owner's
  project, do not log their own failure and never empty the local ring.
- Password recovery uses Supabase PKCE: web redirects preserve `/helix`,
  installed builds use `helix://`, recovery routes bypass signed-in/onboarding
  guards, and completion is bound to the current session user without revealing
  account existence.
- Client validation is defense-in-depth. Supabase RLS remains authorization;
  invalid acknowledgements, pull pages and cursors never change local state or
  advance a cursor.

## Code, UI and test contracts

- Prefer a proven Helix pattern. Simplify behavior-preservingly and require
  caller/evidence checks before deleting code, tests, dependencies or generated
  artifacts. Comments explain non-obvious domain, security or platform reasons.
- One shared answer has one owner: `src/data/repo.ts` for route/UI persistence,
  `buildLedgerBundle` for ledger derivation, `combineLiveStates` for readiness,
  and `useTxLike` for transaction mapping.
- Source-corpus contract tests walk a declared minimum file set and assert
  offenders; an empty walk is not a passing proof. `as unknown as` is banned
  outside `src/ui`, where it is limited to react-native-web DOM refs.
- UI follows `token → primitive → pattern → surface`. Semantic colors and
  spacing come from `src/ui/theme.ts`; interaction fills come from
  `src/ui/interaction.ts`; icons use `lucide-react-native/icons/<name>`, never
  the package barrel.
- Preserve Turkish meaning and accessible labels while changing hierarchy.
  Validate rendered contrast, control boundaries, narrow-width wrapping,
  overflow/clipping, focus and interaction states—not only types or snapshots.
- Every interactive Pressable has a pressed state; disabled controls remain
  readable; reduced motion short-circuits motion families; values in dense
  tables do not animate individually.
- Tab labels are measured against their real font and may collapse to icons
  while retaining accessibility labels. Do not use `fontScale` as a proxy for
  fit, disable font scaling, or clamp text merely to hide overflow.
- Ledger cells use the shared `ledgerCellWidth`/`fittedCellWidth` measurements;
  route preloading and derivation memoization remain evidence-driven. Do not
  virtualize or split offline-critical surfaces without a new measurement and
  regression evidence.

## Source anchors

When a rule is changed, update the relevant source/tests together and record
the evidence in the handoff. Key anchors include `src/data/repo.ts`,
`src/domain/`, `src/db/`, `src/services/`, `src/ui/theme.ts`,
`src/ui/interaction.ts`, `tests/architecture-contract.test.ts`,
`tests/design-system-contract.test.ts`, `tests/theme-contrast.test.ts`,
`tests/source-boundaries.test.ts`, `package.json` and `.github/workflows/`.
