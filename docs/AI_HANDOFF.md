# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

`main` is the only branch. No tags, no long-lived branches: a PR carries a
change because the branch is protected, and that branch is deleted on merge.

P1, P2 and P4 are merged, deployed and OTA-published. This change set is P3 plus
the follow-ups reported against the previous one.

## In this change set

### P3 — Privacy Peek

Masking lives at the render edge: inside `Amount` and a `<Private>` wrapper, so
a surface added later inherits it rather than having to remember. One glyph per
digit keeps each amount's rough width, so revealing one does not reflow the row,
and the accessibility label is masked with the value — a masked amount a screen
reader still announces is not masked. Device-local `kv`, resolved before the
first paint so nothing flashes, never written to the account. One tap on the
dashboard, mirrored by a settings toggle; the existing `PrivacyCover` is
untouched. Market quotes are deliberately NOT masked: the gold and FX prices are
the world's numbers, not the user's.

Strict mode (names, notes, account labels) is still an open owner decision and
is not built.

### FX: a different fallback, a wider list

The fallback moved from Frankfurter to exchangerate-api's open endpoint —
keyless, ~0.2 s, 3 KB, and it states its own publication time, which is what
gets stored. That removed the intersection constraint: the list went from 13 to
21 and now includes ALL, RUB, AED, SAR, AZN, KWD, BGN and GEL, which TCMB
carries but the old fallback did not, so web could never read them.

**Harem keeps gold AND live USD/EUR.** Measured before deciding: no keyless
*live* FX feed exists — every free option is a daily reference rate. Moving the
market card onto one would make "Canlı Piyasalar" show yesterday's number, so
the request to take FX off Harem was argued against rather than implemented.

### Reported follow-ups

- **Web chrome really is unselectable now.** `#root` alone did nothing:
  react-native-web puts its own `user-select:text` class on every Text, and a
  class beats inheritance. `#root *` outranks it, `#root input` outranks that.
  Measured, not assumed.
- **The waiting state no longer jumps.** The dots hold a reserved slot from the
  first frame and the caption fades in, and the three cases say different
  things: an existing account's first pull, a brand-new account, and sign-out.
- **The budget screen stopped claiming unsaved changes it did not have.** It
  tested "is the field non-empty" while opening an existing budget prefills it —
  it now compares against the value it loaded, which is what `AGENTS.md` already
  required.
- The currency picker gained a real title, a flag and Turkish name per row, and
  rows separated by a rule with an alternating tint, like the financial table.

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

`PHASE2.md` order puts **P5 (Scenario Lab)** next: it depends on P1 and P3, both
of which are now in, and it is web-provable.

## Next exact step

`NEXT EXACT STEP = owner checks this delivery on a device; then either the visual-gate defect or P5, whichever they choose.`
