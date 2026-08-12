# Helix Product Specification (Reconstructed)

This document recovers only sections cited by the repository. Each section is
derived from the citing implementation and its tests; it does not claim to
reproduce the wording of the missing original specification.

## §2.2 — Offline-first synchronization (RECONSTRUCTED)

Citing files:

- `.github/workflows/keepalive.yml`
- `src/sync/engine.ts`

Local writes remain usable offline and enter an outbox. A single sync instance
pushes that outbox, pulls remote rows, then merges them. Pushes follow foreign-
key-safe table order, batch work, validate ownership and row shape, and move
invalid events to a visible dead-letter quarantine instead of silently sending
or dropping them. Server acknowledgements may replace a local row only when no
newer local event exists.

Pulls use a paginated `(updated_at, id)` keyset, validate the whole page before
advancing its cursor, and accept only rows owned by the active account and
columns known to the local schema. Concurrent updates converge by last write on
the server-normalized timestamp, except that a higher tombstone generation
wins regardless of a stale client's wall clock so deletion cannot be undone by
an offline edit. Work is bound to a user session epoch; stopping or switching
accounts aborts late network and background results before they can write.

Failures enter the visible sync status and retry with capped exponential
backoff. A transport failure while refreshing credentials remains retryable;
only a refusal returned by the auth service expires the online session. The
hosted Supabase project is kept available by a scheduled, credential-scoped
write/read heartbeat that logs status codes rather than response bodies.

## §2.3 — Session and local data protection (RECONSTRUCTED)

Citing files:

- `src/auth/session.ts`

The last authenticated user id and e-mail are persisted as non-secret device
metadata so that the owned local workspace can open without a network. A live
Supabase session is recovered or refreshed opportunistically; lack of network
does not revoke offline access. Device biometrics are an application lock over
local financial data, not a substitute for server authentication.

The local database has one owner at a time. Account switch, explicit sign-out,
account deletion, and remote session invalidation stop owner-scoped work,
clear account-scoped caches and notifications, and wipe the local workspace
before another account may use it. A failed wipe leaves a sentinel that forces
a retry rather than reopening stale data. Ordinary sign-out is device-local and
is refused while unsynced rows remain unless the user explicitly accepts their
loss; permanent account deletion removes the cloud identity before reporting
success locally.

## §2.5 — Foreign exchange snapshots (RECONSTRUCTED)

Citing files:

- `src/domain/fx.ts`
- `src/services/fx-fetch.ts`

Every foreign-currency financial record keeps its original currency and a TRY
conversion snapshot taken for the record date. Historical values use that
snapshot and are never repriced with today's market. Conversion uses integer
minor units, rejects non-positive or non-finite rates and unsafe results, and
rounds half away from zero.

Rate lookup selects the exact currency/date when present; otherwise it selects
the most recent earlier rate and marks it stale. It never selects a future rate
and returns unavailable when no usable cached row exists. TRY resolves to 1
without a network lookup. The per-account in-memory cache retains full rate
history needed by backdated records, rejects malformed rows, updates consumers
reactively, and is cleared at account boundaries.

Native refresh prefers the official TCMB dated TRY feed and falls back to the
keyless open exchange-rate feed. Web uses the CORS-enabled open feed. Requests
have time and response-size bounds, invalid provider data is rejected, writes
are idempotent for an unchanged rate, and screen-triggered refreshes are
session-scoped and throttled.

## §2.6 — Expected payments and income (RECONSTRUCTED)

Citing files:

- `src/domain/expected.ts`

Each active self-owned subscription and recurring income rule generates dated
expected items from today through a bounded full-month horizon. Monthly,
weekly, and biweekly schedules follow their stored nominal day or anchor,
clamp legitimate month-end days, and fail closed on corrupt scheduling input.
Free trials generate no charge before their end. Generation is idempotent on
`kind + source + due date`; installment plans do not generate a second expected
item because their pending transactions already represent the obligation.

Expected items begin pending. An unconfirmed item becomes late after its due
date. A known fixed subscription with auto-pay may confirm on or after its due
date; an estimated variable bill never auto-confirms. Paid and skipped history
survives rule edits, while obsolete unpaid derivatives are removed according to
the rule's current active/self-owned state. Confirmation records the supplied
past payment day when valid, otherwise the due date if passed or today, and
never realizes a payment in the future.

## §2.7 — Effective dates, realized balance, and projection (RECONSTRUCTED)

Citing files:

- `src/app/transaction.tsx`
- `src/data/repo/maintenance.ts`
- `src/domain/balance.ts`
- `src/domain/installments.ts`
- `tests/balance.test.ts`

A transaction affects actual balance only when it belongs to the self person,
has `realized` status, and its effective date is on or before today. A future
entry remains outside actual balance even if incorrectly marked realized, and
a pending entry never affects actual balance. Daily maintenance changes due
pending transactions to realized; installment generation applies the same
date rule, including plans entered partway through their paid count.

The realized ledger chains each month's opening to the previous closing:
opening plus income, minus expense and transfer, plus dated adjustments.
Negative balances are valid. Pending self-owned rows may be shown in planned
month/category views without entering the realized chain. Projected balance is
actual balance plus known pending and expected inflows/outflows through the
requested horizon; callers remove duplicates where the same obligation appears
in both sources.

## §2.8 — Self and watch-only people (RECONSTRUCTED)

Citing files:

- `src/app/(tabs)/cash-flow/installments.tsx`
- `src/app/(tabs)/settings/persons.tsx`
- `src/domain/balance.ts`
- `tests/balance.test.ts`

One named person is the workspace owner (`self`). Additional named people are
watch-only: their transactions, expected rules, planned flows, and installment
obligations remain visible for tracking but never change the owner's balance or
forecast. Installment views separate the owner's monthly obligation from the
watched total and label the watched owner. The self person is not deletable;
removing another referenced person requires reassignment of all live references
before the person is tombstoned.

## §3.1 — Subscription rules and price history (RECONSTRUCTED)

Citing files:

- `src/app/subscription-form.tsx`
- `src/domain/analytics.ts`

A subscription records a positive fixed charge or a variable charge whose zero
value means “no estimate yet,” plus currency, active state, person, expense
category, optional payment source, trial end, and a monthly, yearly, or custom
month interval. A variable rule is an estimate until the invoice is entered and
cannot use auto-pay. A trial cannot forecast charges before it ends.

Creating a subscription with a known price and changing its amount or currency
append dated price-history rows; unchanged edits do not. A variable rule with
no estimate does not invent a zero-price history row, and an already-entered
variable invoice is preserved when the rule's forecast changes. Analytics
normalizes each charge to `amount / interval months`, reports foreign-currency
loads only when a TRY rate exists, and reports missing rates separately.

## §3.2 — Installments and bounded computed columns (RECONSTRUCTED)

Citing files:

- `src/app/(tabs)/cash-flow/installments.tsx`
- `src/app/(tabs)/settings/computed-columns.tsx`
- `src/domain/analytics.ts`
- `src/domain/computed-columns.ts`
- `src/domain/installments.ts`

An installment or loan plan materializes exactly one transaction in each
consecutive calendar month, independent of card statement cycles. Card totals
split exactly across the count with any kuruş remainder in the last payment;
loans repeat their fixed monthly amount. Legitimate due days clamp at month end,
counts are limited to 1–600, and an entered “paid N of M” plan positions its
start so exactly N installments are realized. The monthly plan view shows only
plans with a payment in that month, offers only relevant card filters, and
reports self and watch-only obligations separately. Installment- and
subscription-linked realized expenses form the fixed-obligation analytic;
ordinary expenses form the variable analytic.

Computed columns are data, not executable formulas. Definitions are strict,
validated JSON limited to four operations: sum selected categories, subtract
one selected category group from another, income minus expense, and the single
or installment share of credit-card spending. Category identifiers must be
unique, non-empty, and bounded to 500. Evaluation can read only the supplied
pre-aggregated month slice, and the editor previews that same bounded operation
against the current month before saving.

## §3.4 — Local reminders (RECONSTRUCTED)

Citing files:

- `src/services/notifications.ts`

Scheduled reminders are native and device-local; web relies on the in-app
dashboard. Permission is requested only after an explicit settings action.
When enabled and authorized, the app replans the next 30 days at account/app
boundaries, serializes overlapping replacement requests, deduplicates equal
content, schedules at 09:00 local time, and keeps the soonest 60 reminders
below the platform queue limit.

The plan covers expected income, advance and due-day subscription reminders,
trial endings, and final installments. Lock-screen content is neutral by
default; merchant and amount detail requires an explicit device preference.
Turning details off clears detailed scheduled and delivered notifications
before rebuilding neutral ones, and every account teardown clears both queues.
A planning/query failure leaves the previous working schedule intact.

## §5 — Visible synchronization state (RECONSTRUCTED)

Citing files:

- `src/sync/status.ts`

Synchronization has explicit `idle`, `syncing`, `attention`, `error`, and
`unconfigured` states with a last-success timestamp and user-facing error.
Failures are never swallowed into a healthy state. A completed run with
quarantined dead letters remains `attention`; only a zero quarantine count is
`idle`. Network-unavailable token refreshes retain retry behavior, while an
auth-service refusal is an expired session. When a pull replaces a row already
visible on the device, the store records a one-time remote-change timestamp;
initial hydration and the device's own acknowledged writes do not trigger it.
