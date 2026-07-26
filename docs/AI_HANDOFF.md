# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

`main` is the only branch. No tags, no long-lived branches, no open PRs. The
working tree is clean and everything below is merged, deployed and published.

| | |
|---|---|
| Last release commit | `62b86af` |
| Web | GitHub Pages, `deploy-web` success |
| Native | EAS Update group `6827383f-79c1-4394-978a-c36960f3e741`, channel `preview` |
| Gate | 71 files / 560 unit tests, 40 Playwright, bundle within budget, `supabaseConfigInlined: true` |

**Work is being handed to a different agent.** Nothing in this file assumes you
saw the sessions that produced it. Where it describes code, read the code.

## Phase 2 status

| Package | Feature | State |
|---|---|---|
| P0 | setup | done |
| P1 | palettes + one loading indicator | **shipped** |
| P4 | 21 currencies + FX provider | **shipped** |
| P2 | floating tab bar | **shipped** |
| P3 | Privacy Peek | **withdrawn** — see `PHASE2.md` |
| **P7** | Receipt Vault | **next** |
| P6 | Investments | after P7 |
| P9 | Tour refresh | last, by definition |
| P5 | Scenario Lab | **backlog** |
| P8 | Shared lists | **backlog**, never agreed |

Order is the owner's, 2026-07-26. P9 is last because it describes what actually
shipped, so it cannot be written until P7 and P6 exist or are abandoned.

## Decisions already taken — do not reopen

- **Palettes stay on the warm ramp.** Clay, Sand, Cinnamon. A blue- or
  purple-dominant accent is rejected outright by `theme-contrast.test.ts`.
- **The breathing/logo loading mark is closed permanently.** Built, removed one
  commit later, then closed by the owner. Do not propose it, not even as an
  option.
- **No new native dependency without a device build path.** `expo-blur` (and
  `expo-glass-tabs` on top of it) cannot ship over OTA, so iOS "glass" is an
  honest translucent surface, not a claim of blur.
- **`main` is the only branch.** A PR branch is scaffolding; delete it on merge.
  No tags, no per-package naming.
- **Rollback is `git revert -m 1 <merge-sha>`.** The feature-flag module was
  deleted — eight of nine flags were read by nothing.

## Open owner decisions

Raise these at the design gate of the package they block; do not choose for the
owner and report "no open decisions".

| # | Decision | Blocks |
|---|---|---|
| — | **Does P7 ship without a device run?** Its main claim (pick a file, upload, get it back) exists only on a device, and no device run has ever happened here. Web-only scope is the honest alternative. | P7, before design |
| — | File size and total storage limits | P7 |
| 1 | Sixth tab, or investments inside an existing tab — five tabs already crowd a 320 pt phone | P6, before design |
| 2 | Sale proceeds: transfer by default, income as an explicit option | P6, before design |
| 5 | Push notifications for shared lists (server-side work) | P8 |
| 7 | **Whether P8 ships at all** — the one package that is not additive | P8 |

## Known defects, unassigned

- **The visual gate does not compare content.** Measured and reproducible, cause
  unknown: the suite passed a baseline showing a full-width tab bar while the app
  rendered a 560 pt centred one, and two baselines were stale for a week. Until
  it is fixed, every regenerated baseline must be opened and looked at by a
  human. `TESTING.md` carries the warning block. **This is the highest-value
  thing on this list** — it silently weakens every screenshot claim in the
  release gate.
- `visual-a11y.spec.ts` "modal actions stay reachable in a short landscape
  viewport" is flaky; it measures a bounding box before the modal settles.
- The keyboard fix on non-scroll screens is iOS-only. `KeyboardAvoidingView`
  was already inert on web, so the Playwright suite cannot show the difference.
- The market card renders only with live socket quotes, so no automated test
  covers its layout. Its column widths were measured against real Inter metrics
  instead. Its longest label wraps below a 375 pt viewport — wrapping is the
  sanctioned behaviour (never truncate), but that row gets taller.
- `brace-expansion` DoS (GHSA-mh99-v99m-4gvg) stays open in Dependabot and
  **cannot be closed by pinning**. The tree is already on the best available
  versions. Full measurements and why in `SECURITY.md`; closure rides on the
  `BACKLOG-SDK-01` Expo/RN/eslint upgrade.

## Not proven anywhere

**No device run has ever happened.** `TESTING.md`'s acceptance matrix has never
had a row filled. Everything below is claimed from code and web behaviour only:
the iOS translucent tab bar, safe-area handling, landscape, Reduce
Transparency, the edge-swipe back gesture (which **cannot** be proved on web —
browser history already behaves correctly there) and the tab-bar drag.

## What the last delivery changed

Read the commits; this is only the shape of it.

- **The cell editor went blank** when its quick-entry field was tapped.
  `Screen`'s `KeyboardAvoidingView` used `behavior="padding"`, which pads by the
  keyboard height in WINDOW coordinates while a stack screen's frame starts
  below the native header — it over-padded by the header height and the
  `flex: 1` child collapsed. Non-scroll screens host their own list, so the list
  takes the inset now and the avoider is gone. **iOS-only, and no device run has
  happened** — the web suite cannot prove this one.
- **Category and payment source became dropdowns.** Sixteen chips pushed date,
  note and save below the fold. `Select` already had the rows, the tint and the
  focus trap, so no new component. Option icons are a separate field rendered in
  a fixed column — packed into the label string, differing emoji widths left
  every name at a different x. Person stays chips: bounded by the household.
- **`Badge` no longer pins itself to the top of a row** (`alignSelf` was
  `flex-start`, overriding the row's centring).
- **An E2E test that could not fail was replaced.** It asked whether a
  `POISON_CATEGORY` radio existed on `/transaction`, but `/transaction` always
  redirected to setup in that context, so the count was zero whatever the import
  did. Worth remembering as a shape: an absence assertion on a screen you have
  not proved is rendered asserts nothing.

## What the delivery before that changed

- **P3 withdrawn.** It had shipped as one third of its baseline — the manual
  switch, without start-hidden or peek-while-held — and that third is the one a
  user cannot benefit from. Removed whole, including a `<Private>` wrapper that
  was defined and never once used.
- **Unsaved-changes prompt fixed properly.** All seventeen `useDirtyExitGuard`
  call sites were read. Two compared something a save would never write:
  `showCurrency` (the *disclosure* state of the currency row) sat inside the
  draft snapshot in two forms, and `incomes.tsx` compared a derived category
  default against a stored null. `tests/dirty-exit.test.ts` pins the first.
- **Waiting caption** moved to full `text` at heading size with a shared
  `useWaitingPulse`; the 0.72 floor is measured (worst palette 5.2:1 at the
  trough) and `theme-contrast.test.ts` reads the constant.
- **Markets:** `TEK_YENI` (Tam Altın) added after confirming on the live feed
  that it is a distinct quote from `ATA_YENI`. Columns went from `minWidth` to
  fixed widths sized from measured Inter metrics.
- **FX verified end to end** through the app's own parser: 21/21 currencies,
  correct business date, USD/EUR within 0.06 % of the Harem socket.

## Next exact step

`NEXT EXACT STEP = raise the P7 device-provability decision with the owner, then run PHASE2.md § How a package runs for P7.`
