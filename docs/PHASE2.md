# Helix Phase 2 — scope and rollout contract

The canonical record of the second feature wave: what ships, in what order, what
each package may and may not touch, and how any of it is taken back out.

Rules that apply to all work live in [`AGENTS.md`](../AGENTS.md); this file adds
nothing to them and repeats none of them. Quality commands are in
[`TESTING.md`](TESTING.md), shipping in [`RELEASE.md`](RELEASE.md). Read this
file at the start of a Phase 2 package and nowhere else — it is the reason a
package prompt can be one line.

## How a package runs

One package at a time, in the order below. `.claude/commands/paket.md` encodes
the workflow; `PHASE2_PROMPTS.md` is the owner's operating sheet for it.

A package is **not** finished when the code works. It is finished when the owner
has seen the evidence and said so. Never open a PR before that.

The scope notes below are a **wish list, not a specification** — `AGENTS.md`
§ Sizing the work governs, and a requirement here that cannot pay for itself is
argued against rather than built. A decision listed as open at the end of this
file is raised at the design gate and answered by the owner; choosing one and
reporting "no open decisions" takes a decision that was theirs.

## Rollback contract

Three tiers, none of which needs a new branch strategy, workflow or pipeline.

1. **Flag** — `src/config/features.ts`. A flag guards a **new surface**: a route,
   a tab entry, a card, a settings section that did not exist in Phase 1.
   Turning it off removes that surface and leaves the app in its Phase 1
   behaviour, with `npm run verify` still green. The branch lives **at the mount
   point only**; a flag that reaches domain logic, a repository or a sync path
   is a bug, not a rollout.

   A refinement of an existing primitive is **not** flagged. Forking a shared
   component so both the old and new behaviour stay alive costs more than it
   protects and breaks "one mechanism per behaviour" — tier 2 covers it.
2. **One merge commit per package** — `git revert -m 1 <merge-sha>` removes
   exactly one package.
3. **`v1-pre-phase2`** — the signed tag on `a8ca1d1`, the last Phase 1 release.
   The anchor for taking the whole wave back out.

A flag is deleted, not flipped, once its package has shipped and been accepted
on a device. Dead flags are worse than no flags.

## Packages

An identifier is a name, not a position — P4 stays P4 wherever it runs. The
table is in **execution order**, set by two things: what a package depends on,
and where its result can actually be proved.

`docs/TESTING.md`'s device acceptance matrix has never had a row filled. Until
it does, a package whose result only exists on a device is an investment in a
surface nobody can look at, so those run last rather than first.

| Order | # | Package | Baseline | Depends on | Proved where |
|---:|---|---|---|---|---|
| 1 | P0 | Phase 2 setup | — | — | repo |
| 2 | P1 | Visual signature | F2 loading, F4 palettes | P0 | web |
| 3 | P4 | Extended currencies | F9 | — | web |
| 4 | P3 | Privacy Peek | F3 | P1 | web (app-switcher on device) |
| 5 | P5 | Scenario Lab | F5 | P1, P3 | web |
| 6 | P2 | Navigation shell | F1 glass footer | P1 | **device** |
| 7 | P6 | Investments | F8 | P2, P3, P4 | web + device |
| 8 | P7 | Receipt Vault | F6 | P3 | **device** |
| 9 | P8 | Shared lists | F7 | P3 | two real accounts |
| 10 | P9 | Tour refresh | F10 | everything it describes | web |

P0, P1, P4 and P3 stand alone as a coherent release. Everything after is
optional and may stop at any package boundary.

**P2 moves as soon as device acceptance is possible.** It is not deprioritised
work — a floating tab bar is judged on safe area, landscape, Reduce
Transparency and a real keyboard, none of which headless Chromium can show. The
moment a device run is on the table, P2 is the next package.

**P8 has not been agreed.** It is listed last and carries an open decision
below; do not start it on the strength of appearing in this table.

### P0 — Phase 2 setup

This file, `.claude/commands/paket.md`, `PHASE2_PROMPTS.md`,
`src/config/features.ts`, the `v1-pre-phase2` tag. No product change.

### P1 — Visual signature

**F4 palettes.** `Palette`'s shape does not change; `theme.ts` gains a
`Record<PaletteId, {light, dark}>` and the resolver in `_layout.tsx` picks from
it exactly as it already picks light/dark. Preference is device-local `kv`
(`helix.palette`), the same pattern as `helix.theme`.

Palettes stay on the **warm ramp** — the owner's decision, 2026-07-26. The
baseline document's "Helix Violet — the current brand direction" is wrong: the
brand accent is terracotta `#BA5B38`, and
[`theme-contrast.test.ts`](../tests/theme-contrast.test.ts) forbids a
blue- or purple-dominant accent outright. That hue contract **does not change**;
it is looped over every shipped palette instead, and the exact-hex pin binds to
the Clay palette. Income green, expense red, warning amber and every WCAG
threshold are palette-independent.

**F2 loading.** Four things, and nothing behind them:

1. A delayed-show threshold, in one place, so a short wait never flashes.
2. Determinate progress only where the **caller** already holds a ratio in the
   user's units — the import wizard's phases, not a row counter borrowed from
   the write layer.
3. While a wait is visible: the operation's name, "your data is safe", and a
   cancel. Cancel appears with the wait, not behind a stall timer. There is no
   retry affordance — cancelling an atomic write rolls it back completely, so
   the original button is the retry.
4. The three remaining `ActivityIndicator` call sites in `settings/index.tsx`
   move onto the one primitive, finishing what PR #70 started.

Palettes are Clay (default), Sand and Cinnamon — owner's decision, 2026-07-26.
Colours and names are cheap to change later precisely because the shape does
not; changing one is editing a token object, not a system.

The loading indicator is **not** a logo or a breathing mark. It was built
(`brand-loader.tsx`, PR #66), removed one commit later (PR #70), and the owner
closed the question permanently on 2026-07-26. Do not propose it, do not offer
it as an option, do not raise it as an alternative. The reasoning is in
[`ARCHITECTURE.md`](ARCHITECTURE.md#rejected-approaches).

### P2 — Navigation shell

A custom tab bar via `<Tabs tabBar={…}>`. The tab **count and order do not
change** here. Content inset keeps coming from `tabBarHeight()` in `theme.ts` —
one source, already read by `Screen` and `UndoSnackbar`.

No new native dependency (owner's decision): web gets a real `backdropFilter`,
native gets a layered high-alpha surface. Call it a frosted surface, not blur,
in every string and comment. Reduce Transparency and Increase Contrast fall back
to a solid `surface`.

### P3 — Privacy Peek

Masking happens at the **render edge** — inside the `Amount` primitive and a new
`<Private>` wrapper — never screen by screen. Placeholder width comes from
`amount-layout.ts` so nothing reflows. The accessibility label is masked with
the value; a masked amount that a screen reader still reads out is a leak.

Device-local `kv`, never account state, never synced. The existing
`PrivacyCover` stays exactly as it is. Strict mode (descriptions, names,
account labels) is an owner decision and is **off** unless taken.

Every package after this one builds its surfaces masked from the start.

### P4 — Extended currencies

`FETCHED_FX_CURRENCIES` grows to the intersection of what TCMB and Frankfurter
both publish — both keyless, so **no API key enters a client**. A shared
`CurrencyPicker` (TRY / USD / EUR, then a searchable "Diğer") is built on the
existing dialog primitive and replaces every ad-hoc currency control.

The summary card does not change: golds plus USD and EUR. The 60 s
`marketSellRateTry` contract does not change; new currencies use the dated FX
path only. Changing the selected currency never silently converts a typed
amount.

### P5 — Scenario Lab

Owns `scenarios` and `scenario_changes` and **reads** the existing projection
code. It may not produce a transaction, an expected payment or an outbox event.
"Apply as plan" is an explicit confirmation that then calls the ordinary
repository functions. Six templates, not a general form.

### P6 — Investments

Proposed accounting, **owner decision required before implementation**:
investment cash is a `payment_sources` row of a new kind, so the existing
transfer machinery moves money instead of a parallel ledger; `investment_positions`
and `investment_trades` hold the rest. A purchase is a transfer, never an
expense. A sale returns cash to the investment source; realised profit or loss
is a separate row and only on an explicit choice. Nothing touches a consumption
category. Prices are last-known with their date and are never presented as live.

The **sixth tab** is a separate owner decision — five tabs already crowd a
320 pt phone. Do not add it without one.

### P7 — Receipt Vault

An `attachments` table carries **metadata only**; bytes never enter a sync
payload. Files go to a private Supabase Storage bucket whose policy keys on an
`auth.uid()` path prefix. The upload queue is **separate from the outbox** — a
large file must not be able to hold up ledger sync.

Source is `expo-document-picker` (owner's decision: no new native dependency),
so PDF and image files, no camera. **OCR is out of scope.** Export, backup,
account deletion and retention must all account for stored files.

The cost this package carries is already written down:
[`RELEASE.md`](RELEASE.md#database-backup-ve-geri-yükleme) records that the
project has no Storage bucket today and that a database dump therefore covers
everything. The moment a bucket exists that stops being true, and a separate
object backup and restore path becomes part of this package — not a follow-up.
`SECURITY.md`'s trust-boundary table and `PRIVACY.md`'s data table both gain a
row.

### P8 — Shared lists

The only place in this codebase where a parallel mechanism is justified, and the
justification is written here so it is not copied anywhere else: every existing
table, RLS policy, `writeRows` ownership check and sync loop assumes
`auth.uid() = user_id`. Membership-scoped rows cannot satisfy that, so
`shopping_lists`, `shopping_list_members` and `shopping_list_items` get their own
policy family and their own sync lane. They must not be added to
`SYNCED_TABLES`, and the owner-scoped path must not be loosened to accommodate
them.

Isolation is the acceptance criterion: a member reaches the shared list and
nothing else. Prove it with two real accounts, not with policy reading.

**This package is not additive, and the design gate must say so out loud.** It
falsifies a sentence the project publishes in two places —
[`README.md`](../README.md) "başka bir hesap satırlarını okuyamaz" and
[`PRIVACY.md`](PRIVACY.md) "her satır kendi sahibine bağlıdır" — rewrites the
A01 row of `SECURITY.md`'s verification matrix, and extends the 48-assertion
pgTAP suite to a second authorization model. Those four documents are part of
the package, not paperwork after it. Weigh that against what is being bought: a
shopping list.

### P9 — Tour refresh

Extends [`tour.tsx`](../src/ui/tour.tsx). New users get the main tour; existing
users get a "Helix'te Yeni" summary and contextual first-open hints, never the
full onboarding again. State is a versioned `kv` key. No onboarding engine.

It describes what actually shipped. If a package was dropped, the tour does not
mention it.

## Open owner decisions

Carried here until taken, then recorded in the package that consumes them.

| # | Decision | Blocks |
|---|---|---|
| 1 | Sixth tab, or investments inside an existing tab | P6 |
| 2 | Sale proceeds: transfer by default, income as an explicit option | P6 |
| 3 | Privacy Peek strict mode in the first release | P3 |
| 5 | Push notifications for shared lists (server-side work) | P8 |
| 7 | **Whether P8 ships at all.** It is the one package that is not additive — it falsifies a sentence `README.md` and `PRIVACY.md` both publish, rewrites `SECURITY.md`'s A01 row and extends the pgTAP suite to a second authorization model, in exchange for a shopping list. A personal, owner-scoped list is the cheap half and needs none of that. | P8 |

Taken: **#4** palettes are Clay, Sand, Cinnamon (2026-07-26). **#6** the
loading mark is closed permanently (2026-07-26) — see P1.
