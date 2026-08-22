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

An expectation is settled by confirming it, which creates the payment and links
the two. Undoing a confirmation removes the row that confirmation created. The
catch-up screen offers exactly three choices per item — confirm, correct the
amount and confirm, or skip. Pointing an expectation at a transaction that
already existed was offered and removed; it asked a question confirmation
already answers.

Expected items begin pending. An unconfirmed item becomes late after its due
date. A known fixed subscription with auto-pay may confirm on or after its due
date, but only for a billing date that arrives AFTER the rule was created:
saving a rule states a schedule, not that money has moved, so an occurrence on
or before its creation day stays pending until the user confirms it. An
estimated variable bill never auto-confirms. Paid and skipped history
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
requested horizon. The projection sums every flow it is given, and the section
below states how a caller avoids supplying two representations of one
obligation.

A projection of known flows alone claims the rest of the month costs nothing,
which is wrong every month in the same direction. Beside it the dashboard
states what a typical month still has left to spend on everything no rule
predicts: the median of what completed months cost, minus what this month has
cost so far. Median rather than mean, so one unusual repair does not become the
normal; six months, long enough that one month cannot define normal and short
enough to follow a real change in prices. It is offered as a second figure and
never folded into the first — one is recorded, the other is measured from
history, and a reader has to be able to tell which is which.

### One obligation, counted once

When one obligation is present as both a pending transaction and an expected
payment, only one of them reaches the projection. Identity is the rule that
generated both: a transaction's `subscriptionId` against the expectation's
`refId`, for the same date. `recurring_income` has no counterpart field on a
transaction and so cannot be matched.

The current client cannot produce that pair — confirming an expectation marks
it paid and reverting one tombstones the transaction it created — so the match
defends data that arrives another way: a restore, a sync from an older client,
or a row left linked by the matching surface that was removed. It is
deliberately strict for that reason. Counting one obligation twice overstates
what leaves the account; collapsing two real ones would understate it, and only
the first of those errors is safe to make.

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

The subscriptions screen reports what the active rules cost from that same
normalization: a monthly TRY figure, its twelve-month restatement, a count of
the rules excluded because their currency has no TRY figure, the soonest
upcoming renewal, and the most recent stored price changes. A rule's first
price-history row is its opening price rather than a change, a currency switch
is not read as a rise or a fall, and history belonging to a deleted rule is not
reported.

## §3.1b — Card statement import (RECONSTRUCTED)

Citing files:

- `src/domain/statement-import.ts`
- `src/services/pdf-text.ts`
- `src/data/repo/statement-import.ts`

A card statement PDF is read on the device and never uploaded. Text extraction
handles uncompressed and FlateDecoded content streams and refuses everything
else with a named reason — not a PDF, too large, encrypted, or no text layer —
so a scanned statement is reported as a scan rather than parsed into nothing.
Stream expansion and candidate counts are bounded.

A candidate is produced only from a line carrying a date, a description and a
single amount, optionally with an instalment marker; a line with two amounts,
an impossible date or no merchant is rejected and shown. `1/1` is a single
payment, not a plan. Each candidate takes a deterministic identity from the
statement period, date, case-normalized description, amount and instalment
position, so re-importing the same statement converges instead of doubling, and
two genuinely identical charges stay two rows.

Review classifies each candidate against the ledger before anything is written:
already imported (same identity), covered by an existing instalment plan, or
similar to an unkeyed row within three days. Only candidates resembling nothing
are pre-selected. Accepted rows are written in one atomic batch with
`origin = statement`, carry their import key, and an identity that already
exists is skipped rather than overwritten so a later edit is not discarded.

A line that names the card's own settlement and carries a credit amount is
read, classified as a card payment, and excluded from the candidates. It is
listed rather than dropped: the purchases it settles are already in the ledger
and the money left an account the ledger also tracks, so importing it would
count the same money twice. Matching is done on a case-folded copy of the line,
because a statement is printed in capitals and Turkish dotless `ı` does not
case-fold to `I`.

During review every candidate may be renamed, re-priced, re-categorised or
removed from the list entirely; removal affects only the review, never the file.
Selection is a checkbox per line, and nothing is written until the import is
confirmed.

Because the parser reads only a line carrying all three of a date, a merchant
and an amount, lines it does not read are expected rather than exceptional —
and nothing noticed when one went missing, which surfaced later as balance
drift with no way back to the cause. The review therefore accepts the period's
charge total as the owner reads it off the paper, and says whether what was
read comes to the same figure, netting refunds the way the printed total nets
them. The figure is typed and not parsed: a total's wording is the most
bank-specific thing on the page, and this importer does not guess at the one
number whose job is to be certain. Nothing about the check is stored — it
belongs to the moment the statement is open.

## §3.1c — Transaction attachments (RECONSTRUCTED)

Citing files:

- `src/domain/attachments.ts`
- `src/data/repo/attachments.ts`
- `src/services/attachment-store.ts`

A transaction may carry receipts, invoices and warranty documents. The metadata
row syncs; the bytes stay on the device that added them. Accepted types are PDF
and common photo formats, bounded to 25 MB, and the declared type must agree
with the name's extension. A display name carrying a path separator, a
traversal segment, a control character or a bidirectional override is refused
rather than sanitized. The on-disk name is derived from the row id, never from
the owner's name, and is re-validated when read because a row can arrive from
sync or a restore.

The file is written before the row that names it, and a delete tombstones the
row while leaving the file for the maintenance sweep, so an interruption leaves
collectable bytes rather than an attachment that cannot be opened. A device
without the bytes says so instead of offering a dead action. Backups carry the
record, not the contents, and the export surface states this.

## §3.1d — Contextual marks on the financial table (RECONSTRUCTED)

Citing files:

- `src/domain/matrix-colors.ts`
- `src/data/repo/matrix-colors.ts`
- `src/ui/matrix-color-sheet.tsx`

Holding a cell, an item row or a month column marks it in one of four fixed
hues. A mark stores a slot and a target, never a colour value; what each slot
looks like is the theme's, measured in both schemes.

Specificity, not recency, decides what a cell shows: its own mark beats the
column it sits in, which beats the row it sits on. Re-marking the same target
replaces its mark rather than stacking a second one, and clearing tombstones so
the removal survives a pull.

Each slot carries a NAME the owner may change. A name belongs to the slot and is
stored once for the account, so renaming one renames every mark already made in
it, on every device and in every surface that reads it — the sheet, the reading
guide's legend, and the accessible name spoken over a marked cell. An unnamed
slot falls back to its shipped default. Marks written under the five
meaning-named slots this replaced still resolve; they are rewritten to their hue
on upgrade and on restore, never dropped.

## §3.1e — Workbook column classification and the ledger anchor (RECONSTRUCTED)

Citing files:

- `src/services/spreadsheet-import.ts`
- `src/data/repo/imports.ts`
- `src/app/import-wizard.tsx`

Every named column of a parsed sheet is kept. A column is classified as a
balance or running total when its heading names a balance and does not name a
concrete source of money; such columns are excluded from the import by default,
because importing a sum of the columns beside it counts that month twice. The
classification is a default and not a verdict: the importer lists them and the
owner may include any of them.

The ledger anchor — the start month and the opening balance the whole chained
balance is computed from — may be seeded from the earliest imported sheet's
opening-balance cell. It is adopted without asking only when it is earlier than
the current anchor, because the ledger back-anchors to the earliest month it
holds. Otherwise the importer states the month and amount it read and adopts it
only if the owner says so.

## §3.1f — Credit card cycle validity (RECONSTRUCTED)

Citing files:

- `src/domain/card-statements.ts`
- `src/ui/card-cycle-fields.tsx`

A card's statement day and due day are a pair, and the rule is the gap between
them. The due date is resolved into the following month whenever the due day is
not past the closing day, so no pair is ever backwards; what a pair may not be
is implausible. The gap is counted against a nominal thirty-day month and must
be at least one day and at most twenty. Every screen that creates a card applies
the same rule, and each field shows — rather than hides — the days the other
field rules out.

## §3.1g — Documents in the ledger (RECONSTRUCTED)

Citing files:

- `src/ui/attachment-panel.tsx`
- `src/ui/transaction-row.tsx`

A transaction's documents are listed as one card of rows, each carrying the
file's name, what kind it is, its size, and — when this device does not hold the
bytes — that fact, in place of an open control that could not work. Every row
offers the same pair the rest of the product offers: open, and remove. Removal
is undoable and does not delete the bytes; the maintenance sweep collects a file
once no live row names it.

A ledger row that has at least one document says so where it is listed, not only
inside its editor.

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
trial endings, and final installments. Each carries an identity payload — a
target kind and a record id, never a name, amount or route — so tapping it
opens the record it named: a trial ending opens its subscription, a final
installment opens its plan, and a due payment opens the upcoming list. The
payload is read defensively, and anything unrecognized routes nowhere rather
than to a guessed record. Taps are honoured both when they launch a cold app
and when they arrive while it runs, and only for a signed-in, unlocked session.

Lock-screen content is neutral by
default; merchant and amount detail requires an explicit device preference.
With details off the payload drops the record identity too, because one neutral
reminder then stands for a whole day's items.
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

## Malformed TCMB unit values are refused

`parseTcmbRates` reads what `<Unit>` contains and then judges it, rather than
matching digits and defaulting when the match fails. A decimal such as `1.5` is
a unit the parser cannot honour, so that currency is dropped; if nothing else in
the response parses, the whole batch is refused rather than stored.

A block that declares no `<Unit>` at all is refused for the same reason. The
parser never supplies a unit the response did not state: TCMB quotes JPY, KRW
and RUB per hundred and all three are fetched, so reading a missing element as
one would be a hundredfold error on exactly the currencies whose unit matters.

The earlier reading is what made both necessary: a digits-only pattern does not
match `1.5` at all, so a default of `1` took over for the malformed and the
missing alike, and the rate was scaled by the wrong unit instead of being
refused.

## Outbox event identity

One outbox event exists per `(table, row, revision)`. Writing the same revision
of the same row twice replaces the queued payload rather than queueing a second
event, so a repeated write cannot push a stale snapshot that last-write-wins
would then echo back over the newer local value.

The identity carries the table because the unique index enforcing it is global.
Ordinary writes could not produce a cross-table clash — `deterministicId`
namespaces every natural key and everything else is uuidv7 — but a restore
writes ids taken from the backup file, so the input is not this process's to
trust. `src/db/mutations.ts` states the same constraint beside the statement
that depends on it.
