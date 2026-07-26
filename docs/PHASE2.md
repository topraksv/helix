# Helix Phase 2 — scope and rollout contract

The canonical record of the second feature wave: what ships, in what order, what
each package may and may not touch, and how any of it is taken back out.

Rules that apply to all work live in [`AGENTS.md`](../AGENTS.md); this file adds
nothing to them and repeats none of them. Quality commands are in
[`TESTING.md`](TESTING.md), shipping in [`RELEASE.md`](RELEASE.md). Read this
file at the start of a Phase 2 package and nowhere else — it is the reason a
package prompt can be one line.

## How a package runs

One package at a time, in the order below. `PHASE2_PROMPTS.md` is the owner's
operating sheet; the six steps here are the agent's, and they are written
tool-neutral on purpose — every agent working this repository runs the same
ones, whatever its own command names are.

A package is **not** finished when the code works. It is finished when the owner
has seen the evidence and said so. Never open a PR before that.

The scope notes below are a **wish list, not a specification** — `AGENTS.md`
§ Sizing the work governs, and a requirement here that cannot pay for itself is
argued against rather than built. A decision listed as open at the end of this
file is raised at the design gate and answered by the owner; choosing one and
reporting "no open decisions" takes a decision that was theirs.

### 1. Ground yourself

Read this file's row and section for the package, and `docs/AI_HANDOFF.md`. Run
`git status`, inspect the diff and recent history. **A note is not evidence** —
where the handoff describes code, read the code before relying on it. Confirm
the packages it depends on are merged; if one is not, stop and say so.

### 2. Design, and stop

Produce a design before writing code, and put it in front of the owner. It must:

- name every existing primitive, hook, repository function and token it reuses,
  with paths — a new file needs a sentence saying why an existing one could not
  carry it;
- state what it will **not** do, including anything in the baseline document
  this package deliberately leaves out;
- price each sub-requirement — files, layers, rough lines — against `AGENTS.md`
  § Sizing the work, **naming in writing anything it refuses to build and the
  simpler thing that covers the real need**;
- list any change to a shared or load-bearing file — `src/db/mutations.ts`,
  `src/data/repo*`, `src/sync/engine.ts`, `src/ui/theme.ts`,
  `src/ui/components.tsx` — with a sentence on why it has to happen *there*
  rather than at the caller;
- list the migrations, new tables and `SYNCED_TABLES` entries, if any;
- list which of the 23 visual baselines the change can move, and why;
- separate what needs an owner decision from what you will simply do.

**Wait for approval.** Do not write code before it.

### 3. Implement

Build only what the approved design says. Reuse before extending, extend before
adding. If you find yourself writing a second way to do something the repo
already does, stop and use the first. Most of the excess in a package is not a
wrong feature — it is a right feature plumbed through a layer that had no
business knowing about it.

Do not touch code outside the package's scope. Write down any unrelated defect
you find and report it; do not fix it here.

### 4. Prove it

`npm run verify`, then `npm run verify:release` if the change can affect
rendering, routes, bundle size or the export. If a baseline moved, open the
actual/diff images and say what changed and why it is correct — never re-record
a baseline you have not looked at. Review the diff for excess and for defects,
and for P6/P7/P8 review it for security as well; report every finding with its
disposition. `AGENTS.md` § What counts as evidence governs all of this.

Then answer three questions, and **keep working until all three hold** — a
report is a claim that they do:

1. Can this be removed in one commit, leaving Phase 1 behaviour and a green
   `npm run verify`?
2. How many layers does it cross, and is the data layer untouched?
3. What is left behind — an unused token, string, ref, prop or export?

### 5. Report, and stop again

Give the owner, in this order and nothing else: what changed and why it reads
better than the alternative; files touched with added/removed counts **grouped
by the concern they serve**, the largest group defended in one sentence; the
`verify` result verbatim enough to be checked; baseline evidence if any moved;
review findings and their disposition; **what is still unproven**, with anything
needing a real device saying so plainly; and any owner decision the package
surfaced. Then **wait**.

### 6. Ship

Once approved, commit per `AGENTS.md` § Commit messages — a body explaining the
reasoning, signed, and **no AI attribution of any kind**. Push a short-lived
branch, open the PR, wait for the required `quality` check. Merge only when it
is green and the owner says so; delete the branch, never create a tag. Then
rewrite `docs/AI_HANDOFF.md` in place, move anything durable into its canonical
document, and update the package's row and any resolved decision here.

Pushing to `main` ships the web app only. The phone needs a separate EAS Update
— `docs/RELEASE.md` has the exact command and why `--clear-cache` is not
optional.

## Rollback contract

**One merge commit per package.** `git revert -m 1 <merge-sha>` removes exactly
one package, and reverting them in reverse order removes the wave. `a8ca1d1` is
the last Phase 1 commit if the whole thing has to come out. No branch, tag,
workflow or pipeline is added for any of this.

A flag tier was built (`src/config/features.ts`) and then deleted, because it
never earned its place: of nine flags, eight were never read by anything, and
the one that was (`palettes`) stayed `true` from the day it shipped. It was a
rollback mechanism nobody could have rolled back with. If a future package
genuinely needs to hide a half-finished surface, the flag belongs in that
package and dies with it — not in a table written in advance for surfaces that
do not exist yet.

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
| 3 | P4 | Extended currencies | F9 | — | shipped |
| 4 | P2 | Navigation shell | F1 glass footer | P1 | shipped |
| 5 | P3 | Privacy Peek | F3 | P1 | **withdrawn** |
| 6 | P7 | Receipt Vault | F6 | — | **device** |
| 7 | P6 | Investments | F8 | P2, P4 | web + device |
| 8 | P9 | Tour refresh | F10 | everything it describes | web |
| — | P5 | Scenario Lab | F5 | P1 | **backlog** |
| — | P8 | Shared lists | F7 | — | **backlog** |

P0, P1, P2 and P4 are shipped and stand alone as a coherent release.

**The remaining order is P7 → P6 → P9, set by the owner on 2026-07-26.** It
overrides the dependency-and-provability ordering this table was first built
from, and the reason is worth keeping: P9 describes what shipped, so it can only
be written once P7 and P6 either exist or are abandoned. P5 and P8 moved to the
backlog in the same decision — P8 was never agreed, and P5 was displaced rather
than rejected.

**P2 shipped early, at the owner's request.** Its metrics and centring were
proved by measuring the live render rather than by a screenshot; safe area,
landscape, Reduce Transparency and the iOS glass material still need a device
run, and `TESTING.md` carries those rows.

### P0 — Phase 2 setup

This file, `.claude/commands/paket.md`, `PHASE2_PROMPTS.md`. No product change.
The flag module it also created is gone — see the rollback contract above.

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
change** here. Because the bar floats, the navigator no longer reserves its
height, so the space a scene must leave is `tabBarClearance()` in `theme.ts` —
one source, read by the bar, `Screen` and `UndoSnackbar` alike.

**Shipped 2026-07-26.** The shape is identical everywhere; the material is not.
Only iOS gets `surfaceTranslucent` — Android and web get the same bar in solid
`surface` rather than an imitation of a system look neither platform has (owner,
2026-07-26). Reduce Transparency turns iOS solid too. There is no React Native
API for Increase Contrast, so it is not claimed anywhere.

The safe-area inset sits **under** the bar, not inside it: a docked bar had to
swallow the home indicator, which made its bottom padding permanently larger
than its top. Measured after the change at 390 and 1440: side insets 12/12, tab
padding 5/5, bar centred to the pixel.

`expo-blur` (and `expo-glass-tabs`, which is built on it plus four more native
modules) stays out: it cannot ship over OTA and there is no working device build
path today. The background layer is the only thing that would change if real
blur is adopted after one exists — priced at the gate, not adopted silently.

### P3 — Privacy Peek — **withdrawn 2026-07-26**

Shipped, then removed the same day at the owner's decision. Recorded because the
mistake is repeatable, not because the feature might come back.

Baseline F3 was three things: start hidden, peek while held, and a manual
switch. Only the manual switch was built. That third alone is the one a user
cannot benefit from — it needs you to predict the moment someone will look over
your shoulder and tap first, which is exactly the moment nobody predicts. The
owner's verdict was "amaçsız", and it was correct: the shipped part was the part
that did no work.

The lesson is about slicing, not about privacy. A feature split across three
mechanisms is not three deliverables; the two that carry the value were dropped
and the leftover was reported as done.

Removed with it: the store, the `<Private>` wrapper (defined, never once used),
the masking branch inside `Amount`, and the settings toggle. `PrivacyCover` —
which covers the app in the task switcher — is unrelated and untouched.

### P4 — Extended currencies

**Shipped 2026-07-26.** `FETCHED_FX_CURRENCIES` is 21 codes, and the number is
a consequence rather than a target. It began as the *measured* intersection of
what TCMB and Frankfurter both publish — thirteen codes — because TCMB sends no
CORS headers, so web can only read the fallback, and a TCMB-only currency would
work on a phone and sit permanently empty in a browser. Replacing Frankfurter
with exchangerate-api's open endpoint dissolved the constraint: it is keyless,
~0.2 s, 3 KB, states its own publication time (which is what gets stored rather
than "today"), and carries the regionally important codes the old fallback did
not — ALL, RUB, AED, SAR, AZN, KWD, BGN, GEL. Still no API key in a client. A
test pins the list so widening it stays a deliberate act.

**Harem keeps gold and live USD/EUR.** Measured before deciding: no keyless
*live* FX feed exists — every free option is a daily reference rate. Moving the
market card onto one would make "Canlı Piyasalar" show yesterday's number, so
that request was argued against rather than implemented.

`CurrencyPicker` is TRY / USD / EUR as chips plus one "Diğer" chip that opens
the list directly — no second field appears to hold what the chip already
shows. It passes a chip-shaped trigger to the existing `Select`, so the modal,
its focus trap and its keyboard behaviour are not written twice. Its `value` is
a plain string on purpose: the column is free text, and a row written before
this list existed can hold a code the app no longer offers. Such a value is
shown as-is and left alone.

The summary card does not change: golds plus USD and EUR. The 60 s
`marketSellRateTry` contract does not change; new currencies use the dated FX
path only. Changing the selected currency never silently converts a typed
amount.

### P5 — Scenario Lab — **backlog (2026-07-26)**

Displaced, not rejected. The scope below stands if it comes back.

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

### P7 — Receipt Vault — **next**

**Raise this at the design gate, before building anything.** P7's result exists
only on a device: picking a file, uploading it, getting it back. No device run
has ever happened on this project — `TESTING.md`'s acceptance matrix has never
had a row filled. So either the owner accepts a package whose main claim cannot
be demonstrated by the gate that ships it, or a device build comes first. That
is the owner's call and it is cheaper made now than after the code exists.

The web side (upload from a browser, list, download, delete) *is* provable, so
one honest option is to scope the package to what can be shown and record the
native path as unproven rather than claiming it.

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

### P8 — Shared lists — **backlog (2026-07-26)**

Still unagreed, and now explicitly parked. Decision #7 below stays open.

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
| 5 | Push notifications for shared lists (server-side work) | P8 |
| 7 | **Whether P8 ships at all.** It is the one package that is not additive — it falsifies a sentence `README.md` and `PRIVACY.md` both publish, rewrites `SECURITY.md`'s A01 row and extends the pgTAP suite to a second authorization model, in exchange for a shopping list. A personal, owner-scoped list is the cheap half and needs none of that. | P8 |

Taken: **#4** palettes are Clay, Sand, Cinnamon (2026-07-26). **#6** the
loading mark is closed permanently (2026-07-26) — see P1.
