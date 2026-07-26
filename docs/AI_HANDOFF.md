# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

`main` is the only branch. No tags, no long-lived branches: a PR carries a
change because the branch is protected, and that branch is deleted on merge.

P1 and P2 are merged, deployed and OTA-published. This change set is P4 plus the
navigation rework and the follow-ups the owner reported against P2.

## In this change set

### Navigation: the anchor is gone

A screen living in one tab but reachable from another was pushed with
`{ withAnchor: true }`, which mounts that tab's index underneath it. Plain
history then popped to a screen the user had never visited, so the back button
was taught to navigate to a recorded origin instead — and the iOS edge swipe,
which pops the stack without consulting any of that, kept landing on the anchor.
An earlier attempt corrected the gesture afterwards with a `beforeRemove`
listener; that is what made the swipe visibly go to the Financial Table and jump
back a second later.

Those screens now have a root-level route — `analytics`, `payment-sources`,
`incomes`, `budgets`, each re-exporting the in-tab component — and a cross-tab
push goes there. What sits underneath IS the screen the user came from, so the
button and the gesture agree by construction. **This removed machinery rather
than adding it:** `withAnchor` at seven call sites, `resolveBackTarget`'s exact
mode, `ANALYSIS_SOURCES`, `knownSource`, the `from`/`origin`/`record` param
relays, four inline `headerLeft` overrides and the listener.
`src/ui/navigation.ts` went from 80 lines to 30.

One visible consequence: Analysis opened from Summary now covers the tab bar,
the same shape as Upcoming, which the neighbouring card opens. Opened from the
Financial Table it still sits inside that tab.

### P4 — extended currencies

Thirteen codes, the *measured* intersection of TCMB and Frankfurter rather than
an assumed list. TCMB-only currencies are excluded on purpose: it sends no CORS
headers, so they would work on a phone and stay permanently empty on web.
`CurrencyPicker` is TRY/USD/EUR plus one "Diğer" chip that opens the list
directly, built on `Select`'s modal through a new `trigger` prop. The market
layer is untouched — `marketSellRateTry` still knows only USD and EUR, and a
test now pins that so a wider currency list cannot widen what counts as live.

### The owner's follow-ups

- Sign-out was slow because it ran a full `syncNow` before wiping — push **and
  pull**, fetching remote pages into a database about to be dropped. Only the
  push decides whether anything would be lost, so it now calls `flushOutbox`.
  The safety is unchanged: a row the server never received still blocks the
  sign-out and still asks.
- Both waits say what they are: "Verilerin kaydediliyor…" under the sign-out
  row, "Verilerin güncelleniyor…" during the first pull after sign-in.
- Dragging across the tab bar switches tabs (`PanResponder`, 8 px threshold so a
  tap still reaches the button underneath).
- Web chrome is no longer text-selectable; inputs keep their caret.
- The reminder-days save button matches its field: `sm` is 36 px against the
  field's 48, which is why bottom-aligning them showed a step.

## Not yet proven

- **No device run has ever happened.** `TESTING.md`'s matrix has never had a row
  filled. The iOS glass material, safe area, landscape, Reduce Transparency, the
  edge-swipe fix and the tab-bar drag are all device-only. The swipe fix
  **cannot be proved on web** — browser history already behaves correctly there.
- **The visual gate does not compare content.** Measured and reproducible, cause
  unknown; see the warning block in `TESTING.md`. Every regenerated baseline
  must be opened and looked at until it is fixed.

## Open items

- The visual-gate defect is unassigned and is the highest-value thing to fix
  next: it silently weakens every screenshot claim in the release gate.
- `visual-a11y.spec.ts` "modal actions stay reachable in a short landscape
  viewport" is flaky — it measures a bounding box before the modal settles.
- Real iOS glass needs `expo-blur`, which cannot ship over OTA and has no device
  build path today. The bar's background layer is the only thing that changes
  when one exists.
- The toggle keeps an opaque track on purpose; only the thumb carries the bar's
  material language. Revisit only together with `theme-contrast.test.ts`.
- P8 (shared lists) is still an open product decision — see `PHASE2.md`.

## Next package

`PHASE2.md` order puts **P3 (Privacy Peek)** next. It is web-provable and every
package after it inherits masked surfaces.

## Next exact step

`NEXT EXACT STEP = owner checks this delivery on a device; then either the visual-gate defect or P3, whichever they choose.`
