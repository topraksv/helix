# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

`main` is the only branch. No tags, no long-lived branches: a PR carries a
change because the branch is protected, and that branch is deleted on merge.

P1 is merged, deployed and owner-accepted. Since then: one delivery already on
Pages and the `preview` channel (`f892698`), and the change set below.

### Already shipped in `f892698`

- **The bundler cache poisoned the next build.** Metro's transform cache is
  shared by `expo export` and `eas update` and its key ignores `EXPO_PUBLIC_*`,
  so whichever environment built the cache stuck to it. Measured both ways:
  without `--clear` the local-only E2E export carried the real Supabase URL and
  anon key; with it, the empty-env cache it left behind produced a production
  bundle where `isSupabaseConfigured` was false. Pages was safe by accident (CI
  starts cold and exports production first — verified against the live site);
  the documented OTA order was exactly the poisoning order. Every production
  bundle now clears the cache, and `bundle:check --require-supabase-config`
  proves the result instead of trusting the flag.
- **Signing out landed on the welcome screen.** The route guard reads the
  session id and the `onboarded` row together, so wiping the workspace while an
  id was still set gave the answer an unfinished setup gives. All three cleanup
  paths — sign-out, account deletion, and the remote-invalidation cleanup that
  had the same defect and no report — now end the session in the same turn as
  the wipe.

### P2 and the owner's follow-ups (this change set)

- **The tab bar floats**: bounded, centred, driven by `TAB_BAR` tokens and its
  own `tabBarClearance()` that `Screen` and the undo snackbar read. The glass
  material is **iOS only**; Android and web get the same shape solid. The
  safe-area inset sits under the bar rather than inside it, which is what made
  the padding symmetrical — measured at 390 and 1440: side insets 12/12, tab
  padding 5/5, centred to the pixel.
- Five defects were found inside this package, three by the checks and two only
  by looking at the render: `AccessibilityInfo.isReduceTransparencyEnabled` does
  not exist on react-native-web and took the whole tree down; the tabs rendered
  with no `aria-selected` because RNW does not translate `accessibilityState`
  for that role; the selected label measured 4.12 against its own pill; the bar
  stretched across a 1440 viewport; and the first attempt to bound it had no
  effect at all (`maxWidth` and an auto margin are ignored on an absolutely
  positioned element with both `left` and `right` set).
- **Pressing the active tab returns that screen to the top**, animated, through
  the navigator's own `useScrollToTop`. `Screen` covers four tabs from one
  place; the Financial Table hosts its own scroller, so `StickyTable` now
  exposes it.
- **Sign-out and account deletion show they are working.** `signingOut` existed
  only to block a second tap, so the row sat silent through a flush, a wipe and
  a revoke.
- **The reminder-days save button** sits beside its field instead of under it.
- **The iOS edge swipe goes where the back button goes.** The gesture pops the
  stack directly and never reached `navigateBack`, so a screen opened from
  another tab landed on the anchor. The destination now lives in one
  `beforeRemove` listener inside `HeaderBackButton`.

## Not yet proven

- **No device run has ever happened** — `TESTING.md`'s matrix has never had a
  row filled. The iOS glass material, safe area, landscape, Reduce Transparency
  and the edge-swipe fix are all device-only. The swipe fix in particular
  **cannot be proved on web**: browser history already behaves correctly there.
- **The visual gate does not compare content.** Measured and reproducible, cause
  unknown — see the warning block in `TESTING.md`. Until it is fixed every
  regenerated baseline must be opened and looked at, because the suite will not
  catch a stale one. Two had been stale for a week before this was noticed.

## Open items

- The visual-gate defect is unassigned and is the highest-value thing to fix
  next: it silently weakens every screenshot claim in the release gate.
- `visual-a11y.spec.ts` "modal actions stay reachable in a short landscape
  viewport" is **flaky**. It failed once here and then passed three times in a
  row; the failure screenshot caught the calculator modal mid-fade, so the
  assertion measures `boundingBox()` before the modal has settled.
  `animations: "disabled"` only applies to `toHaveScreenshot`, not to a
  measurement. CI's single retry hides it. Not touched here — it is unrelated to
  this change set — but it will keep costing a re-run until the measurement
  waits for a stable box.
- The toggle keeps an opaque track on purpose. Its two fills are what
  `theme-contrast.test.ts` measures, and letting the row behind show through is
  how the switch once vanished on the refund row. Only the thumb carries the
  bar's material language. Revisit only together with that contract.
- P8 (shared lists) is still an open product decision — see `PHASE2.md`.

## Next package

`PHASE2.md` order puts **P4 (extended currencies)** next: fully web-provable and
it unblocks P6.

## Next exact step

`NEXT EXACT STEP = owner checks this delivery on a device; then either the visual-gate defect or P4, whichever they choose.`
