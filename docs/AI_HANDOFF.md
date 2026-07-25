# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

Ten reported items: three vocabulary changes, five UI defects, and the two
mobile-only defects that a previous package claimed to fix and did not.

### The two that were "fixed" before and were not

Both had the same real cause, and it was never the code that was changed.

- **The header on native was never ours to style.** `HeaderBackButton` is
  handed to the native stack as `headerLeft`, which becomes a UIKit
  `leftBarButtonItem`. UIKit owns its metrics, and since iOS 26 it paints a
  shared glass background behind every bar button item — so the chevron
  appeared inside a system capsule the app cannot position, which is exactly
  the "it has a background and is not centred, and nothing I changed made any
  difference" report. Shrinking the icon from 25pt to 24pt (the previous
  package) was a real sub-pixel improvement to a control the user never saw.
  react-native-screens 4.16 exposes no opt-out for that background on a plain
  `headerLeft` (`hidesSharedBackground` exists only for the unstable
  `headerLeftItems` API). **The header is now rendered by React on every
  platform** (`src/ui/header-bar.tsx`, wired through `stackScreenOptions`), so
  web and native are the same tree by construction. Screens still declare
  `headerLeft` exactly as before; the header just renders it.
- **The exact back target only ever did half the job.** Returning to a recorded
  origin means undoing two things — the stack this screen sits on (mounted at
  its own index by the anchored push) and the tab it lives in. A single
  cross-navigator `replace` reliably does one: on web the URL rebuilds the whole
  tree so it looked correct, on native the action goes to the nearest navigator
  and the user was left standing on the anchor, the Financial Table. That is
  the reported symptom exactly. `navigateBack` now unwinds its own stack and
  then navigates to the origin. Leaving the stack wound up was a second latent
  bug: returning to Mali Tablo later would have reopened Analysis.

**Neither is verified on a device** — no simulator runtime, no `adb`, Xcode has
no platform support for the paired iPhone. Both fixes are verified on web,
where the same React tree now runs.

### The other eight

- **"Transfer kategorisi" is now "Yatırım kategorisi"** in every string, and the
  UI code around it speaks investment. The persisted `is_transfer` column and
  the `transfer` flow type keep their names on purpose — they are the sync
  payload, the backup format and a migration history that existing exports and
  other clients still speak. [`ARCHITECTURE.md`](ARCHITECTURE.md) records that
  boundary: rename the vocabulary at the UI, never in the row.
- **"Aylık Bütçeler" is now "Aylık Harcama Limiti"**, including the screen
  title, the settings entry, the analysis card and every derived phrase.
- **Footer: Özet → Durum, Abonelik → Abonelikler, Hesap → Araçlar**, with the
  tabs' accessible names moved in step — a screen reader must not call a screen
  something the UI never calls it. The calculator popup gained its own title
  ("Hesap Makinesi") now that the tab is no longer named after it.
- **A card's trailing link no longer sits deeper than its first row.** The
  Upcoming card's footer button was a regular one, whose 48pt minimum height
  centres its label 14.5px from the card's padding while a ListRow insets its
  text by 10 — measured 26 top vs 30.5 bottom. Every other in-card link in the
  app was already `size="sm"`; this one was the outlier. Now 26/26.
- **The cell-note indicator is a badge, not a sticky-note glyph.** It says
  "Not" in the app's own badge system instead of a decorative icon.
- **Subscription logo tiles read the same.** Favicons are not a uniform set:
  iCloud's is a full-bleed app icon, YouTube's is a centred mark on
  transparency. Nothing can make both fill a tile without cropping one, so the
  tile is normalised instead — a constant light plate, the background the
  artwork is drawn for. On the theme surface that transparent margin showed as
  a dark band above and below the mark. `contentFit` is now `contain`, so a
  non-square favicon letterboxes rather than losing part of the mark.
- **The calculator popup stays centred.** Its scroller exists so a short
  viewport can reach the whole pad, but on web `ScrollView` defaults to
  `flexGrow: 1`: it stretched to the full overlay while its content stayed
  pinned to the top, pushing the pad up and off screen. The content now grows
  and centres instead — measured centred and fully on screen at 320×640,
  390×844 and 1280×720.
- **A slow wait becomes the Helix mark, breathing.** There was no
  implementation of this in the repository at all — nothing to delete, and
  nothing that could ever have shown. `src/ui/brand-loader.tsx` keeps the plain
  spinner for the first 1200 ms, because a logo flashing on every quick load
  would be worse than the spinner it replaces, then swaps to the symbol with a
  1.9 s breath. Reduced motion holds it still. It is used on the full-screen
  waits (boot, recovery, `DataStateNotice`) and deliberately not inside buttons
  or settings rows, where the control is its own context.

### Found while fixing, and fixed

- **The dashboard visual baseline was time-fragile.** It baked in the greeting
  and today's date, so the suite passed or failed by the hour it ran in — it
  failed here purely because this session crossed midnight. The clock-derived
  screen header is now masked (`testID="screen-header"`); nothing else is
  hidden and no threshold moved.
- The new header initially dropped the title's `heading` role, which the suite
  caught immediately; it is restored explicitly.

## Validation of the change set

- `npm run verify:release`: typecheck, zero-warning lint, **70 Vitest files /
  556 tests**, budgeted production export, and the full Playwright suite
  (**38 tests**, 5 of them new).
- Baselines: 12 regenerated, each inspected by eye. The diffs are exactly the
  renamed strings, the new footer labels, the header, the dashboard's trailing
  link, and the masked clock region. No threshold was raised.
- Measured on web, before and after: the Upcoming card 26/30.5 → 26/26; the
  calculator popup centred at three viewports; the header's chevron and title
  sharing a centre line at y=32 with the chevron inset 9.5px on every side.
- The brand loader was proved to render by holding the SQLite wasm for 9 s and
  screenshotting the boot: the Helix symbol, with the spinner gone.

## Open items

- **Device acceptance remains BLOCKED and no iPhone scenario was executed.**
  **Production OTA stays withheld.** The two mobile defects above are the
  highest-value rows to check on hardware —
  [`TESTING.md`](TESTING.md) carries them.
- Cross-user isolation is proven at the database and policy layer, not through
  two real signed-in accounts in the deployed web app.
- A sign-in that cannot reach the cloud falls back to the local answer after the
  8 s first-pull grace, so an existing account on a broken network can still be
  asked to set up.

## Delivery and rollback evidence

- Delivered `098cfb3` (the ten items, PR #66), then `52b75b2` (dependency
  patches, PR #67) and `35f7aa4` (the brace-expansion disposition, PR #68).
  Pages deployed each; the final run is `30179505377` at `52b75b2`, and the
  docs commit redeploys on top.
- Preview OTA is group `39ffadf3-6a25-45b3-818f-f4687dfa6716` (android
  `019f9ba5-8d89-7e5c-b7fd-5bf94d87941a`, iOS
  `019f9ba5-8d89-7b09-99c4-fefd3eecb39a`), runtime `1.0.0`, branch `preview`,
  from `52b75b2` with a clean tree. Installed delivery is **not** verified —
  no device.
- **Dependency posture.** `tar` is fully patched (7.5.22, alert closed).
  `brace-expansion` is patched everywhere it can be: the three 5.x copies are
  on 5.0.8, the two pinned by `minimatch@3.1.5` / `minimatch@9.0.9` cannot move
  without breaking eslint and the Expo CLI, and that alert stays **open on
  purpose** with its reasoning and closure condition in
  [`SECURITY.md`](SECURITY.md). Do not "fix" it by forcing an override — both
  the brace-expansion@5 and the minimatch@10 route were tested against the
  published tarballs and both break CommonJS callers.
- Rollback anchor is the previous release: `71c665f` (PR #64), Pages run
  `30168578249`, OTA group `e24a6876-188a-47df-8863-6cbc8416575c`.
- The app diff is TS/TSX, tests, baselines and docs; the only dependency change
  is two `overrides` lines and the lockfile. No `app.json`, `eas.json`, native
  directory or Supabase migration change — no native rebuild, no schema deploy.

## Next exact step

`NEXT EXACT STEP = installed-device acceptance for the blocked TESTING.md rows, starting with the header/back-navigation rows, once real hardware is available; nothing else is pending.`
