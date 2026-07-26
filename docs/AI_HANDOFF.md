# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

`main` is the only branch. No tags, no long-lived branches: a PR carries a
change because the branch is protected, and that branch is deleted on merge.

P1, P2 and P4 are merged, deployed and OTA-published. **P3 (Privacy Peek) was
withdrawn** — see `PHASE2.md`. This change set is that removal plus the
follow-ups the owner reported against the previous delivery.

## In this change set

### P3 withdrawn, and the flag module with it

Privacy Peek shipped as one third of baseline F3 — the manual switch, without
start-hidden or peek-while-held — and the owner's verdict was that the shipped
third does no work on its own. Removed whole: the store, the masking branch in
`Amount`, the settings toggle, and the `<Private>` wrapper, which was defined
and never once used. `PrivacyCover` (task-switcher cover) is unrelated and
untouched.

`src/config/features.ts` went with it. Of nine flags, eight were read by nothing
and the ninth (`palettes`) had been `true` since it shipped, so the "flag" tier
of the rollback contract could not have rolled anything back. `PHASE2.md` now
records revert-a-merge as the single tier.

### Dirty-exit false positives — the actual cause

All seventeen `useDirtyExitGuard` call sites were read, not just the one fixed
last time. Two were genuinely wrong, both from comparing something a save would
never write:

- `transaction.tsx` / `subscription-form.tsx` tracked `showCurrency` — the
  *disclosure* state of the currency row — inside the draft snapshot. Tapping
  "Para birimi değiştir" and leaving asked the user to discard changes they had
  not made. That is the two-tap reproduction the owner reported.
- `incomes.tsx` compared the derived category against the stored one, so editing
  a legacy income with a null `category_id` was dirty on open.

`tests/dirty-exit.test.ts` now pins disclosure state out of both snapshots.

### The waiting caption is readable and alive

It was `Body muted` after a one-shot fade: correct on paper (7.5:1) and still
the faintest role in the app, on a screen where it is the only thing to read.
It is now full `text` at heading size with a continuous pulse, from one shared
`useWaitingPulse` used by both the first-pull screen and the sign-out row.
The 0.72 floor is measured, not chosen — worst palette 5.2:1 at the trough —
and `theme-contrast.test.ts` reads the constant so deepening the pulse fails
the gate.

### Canlı Piyasalar

`TEK_YENI` (Tam Altın) added after connecting to the feed and confirming it is a
separate quote from `ATA_YENI`, ~1000 TL apart. Names follow the provider's own:
Gram / Çeyrek / Tam / Cumhuriyet Altını. Rows got the financial table's rule and
alternating tint, edge to edge including the bottom band. The columns were
`minWidth`, so they grew per row and the "Alış"/"Satış" captions drifted off
their own columns; they are fixed widths now, sized from measured Inter metrics
against the longest label.

### FX verified end to end

`open.er-api.com` was exercised through the app's own `parseOpenExchangeRates`:
21/21 currencies, today's business date, and USD/EUR within 0.06% of the Harem
socket. The currency chips are four equal columns now — picking a non-primary
currency renamed the last chip and reflowed the row onto a second line.

## Not yet proven

- **No device run has ever happened.** `TESTING.md`'s matrix has never had a row
  filled. The iOS glass material, safe area, landscape, Reduce Transparency, the
  edge-swipe fix and the tab-bar drag are all device-only. The swipe fix
  **cannot be proved on web** — browser history already behaves correctly there.
- **The visual gate does not compare content.** Measured and reproducible, cause
  unknown; see the warning block in `TESTING.md`. Every regenerated baseline
  must be opened and looked at until it is fixed.
- The market card renders only with live socket quotes, so no automated test
  covers its layout. Its column arithmetic was measured against real Inter
  metrics rather than screenshotted.

## Open items

- The visual-gate defect is unassigned and is the highest-value thing to fix
  next: it silently weakens every screenshot claim in the release gate.
- `visual-a11y.spec.ts` "modal actions stay reachable in a short landscape
  viewport" is flaky — it measures a bounding box before the modal settles.
- Real iOS glass needs `expo-blur`, which cannot ship over OTA and has no device
  build path today. The bar's background layer is the only thing that changes
  when one exists.
- The market card's longest label wraps below a 375pt viewport. Wrapping is the
  sanctioned behaviour (never truncate), but it makes that one row taller.
- P8 (shared lists) is backlogged and still an open product decision.

## Next package

**P7 (Receipt Vault)**, then P6, then P9 — the owner's order, 2026-07-26. P5 and
P8 are backlog. P9 stays last because it describes what actually shipped.

P7 is device-provable only (file picking, Storage upload), and no device run has
ever happened — raise that at its design gate rather than after building it.

## Next exact step

`NEXT EXACT STEP = owner checks this delivery on a device; then either the visual-gate defect or P5, whichever they choose.`
