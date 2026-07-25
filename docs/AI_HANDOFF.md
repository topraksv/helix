# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

One package: a full repository-structure audit that changed almost nothing, plus
four reported defects fixed at their root cause and two neighbours found by
following those causes outward.

### What changed in the product

- **A month-focused card now states the flows behind its own total.** The
  balance chain counts realized rows dated on or before today, but `byCategory`
  has always also carried the planned ones — so every future month in "Ay
  odaklı" and in the month detail showed a carried balance above "Gelir 0 /
  Gider 0 / Yatırım 0" while the table cell beside it already showed the planned
  amount. `monthFlowTotals` (and `monthColumnBasis` for computed columns) is now
  the one accessor those surfaces read; it carries its own projected chain, so
  the total really is opening + income − expense − transfer + adjustment. **The
  realized chain, the Mali Tablo Ay Başı / Güncel Bakiye columns and the current
  balance are byte-for-byte unchanged** — this adds a second, clearly named
  view, it does not reinterpret the Excel model.
- **The transfer classification stopped repeating under every column.** It is a
  rarely-changed property of the category, and it was rendered as a live switch
  on every expense row, under the "Tabloda göster" switch. It now lives in the
  row's own edit surface, saved together with the name, and a collapsed row
  carries a read-only "Yatırım" badge when it is on. Existing values, the
  creation default and every transfer calculation are untouched.
- **The header back chevron centres on a whole pixel.** At 25pt inside a 44pt
  target each side got 9.5pt: exact in a browser (measured 9.5 px per side at
  320 and 390), but React Native rounds to the device pixel grid, so at @3x one
  side took 29 physical px and the other 28. `iconSize.headerBack` is 24, which
  halves to a whole 10pt at 1x, 2x and 3x alike.
- **A recorded origin survives a detour.** Summary → Analiz → Bütçeler → Geri →
  Analiz → Geri landed on Mali Tablo: an exact back target is a `replace` to a
  rebuilt URL, and Bütçeler returned to the bare `/cash-flow/analytics`, erasing
  `from=summary`. Analysis now hands its origin over and Bütçeler hands it back,
  re-validated against the same allowlist.

### Neighbours found by following the same causes

- **Computed columns had the same split brain.** They read `byCategory`
  (planned) together with the realized income/expense, so "Net Akış" printed 0
  in a future month whose Market cell in the same row showed the planned amount.
  All three call sites now go through `monthColumnBasis`.
- **The payment-sources detour dropped the record being edited.** "Bu kartın
  dönemini düzelt" pushes Ödeme Yöntemleri from a half-edited
  transaction/plan/subscription; its back control returned to the bare modal
  route, i.e. a blank NEW-record form. The id is forwarded and re-validated with
  `classifyRecordId`. Reachable only for a card with no statement/due cycle,
  which new data can no longer create — so this is a legacy-data path, fixed
  because it is the same root cause, not because it was reproduced end to end.
- **`formatMinor(-0)` printed "-₺0,00".** Screens negate a sum for display
  (`-expenseMinor`), so an empty month rendered a minus sign in front of nothing.
- **Every category row's Düzenle/Sil had the same accessible name.** They now
  name the column they act on, like the switches in that row already did.

### Repository structure: audited, deliberately unchanged

347 tracked files, zero untracked, zero stray ignored artifacts. Every asset
resolves to a real consumer: `assets/images/` → `app.json` (icon, adaptive icon,
favicon, splash), `assets/brand/` → README + `src/ui/brand.tsx`,
`assets/screenshots/` → the README gallery, `public/sw.js` → registered at
`/helix/sw.js` by `+html.tsx`. Root holds only what a tool resolves from the
project root. `.expo/`, `ios/`, `dist*/`, `test-results/` and `node_modules/`
are ignored and none is tracked. **Nothing was moved or renamed** — no move had
a benefit that beat its cost.

The one real duplication is byte-identical
`assets/images/splash-icon{,-dark}.png` ↔ `assets/brand/symbol-{light,dark}-t.png`.
They stay separate, and [`ARCHITECTURE.md`](ARCHITECTURE.md) now says why: the
splash pair is a prebuild input baked into the native binary, the brand pair is
Metro-bundled and OTA-shippable. Merging them would couple a rebuild-only asset
to an OTA-only one.

### Analysed and deliberately left unchanged

- **The Mali Tablo balance columns stay realized-only.** Making Ay Başı / Güncel
  Bakiye projections would reinterpret the documented Excel-verified model and
  the current-balance contract. The month cards were the reported surface and
  the only one pairing a total with a breakdown.
- **`show_pending_in_table = false` still shows zeros for a future month**, and
  that is now *consistent*: the planned totals come from exactly the rows that
  fill the category cells, so when nothing is displayed nothing is claimed.
- **The dashboard "BU AY" card was left alone.** It reads the current month from
  `domain/dashboard.ts`, where realized-vs-planned cannot produce the reported
  zeros, and `tests/financial-consistency.test.ts` already pins it.

## Validation of the change set

- `npm run verify:release`: typecheck, zero-warning lint, **70 Vitest files /
  555 tests**, production export with the entry/total/export/font budgets, and
  the full Playwright suite (**27 existing + 6 new**).
- Mutation proofs, each run in both directions: dropping the planned
  classification in `buildLedger` fails 4 balance tests; `iconSize.headerBack:
  25` fails 3 design-system tests; reverting the four screen fixes fails 4 of the
  6 new Playwright tests (the other 2 guard behaviour that was already correct —
  Table → Analiz → back, and a hostile `?from=` degrading to the parent).
- Real-browser reproduction before any fix, on the deployed build's own export:
  the Eylül row's Market cell read ₺5.000,00 while the same month's card read
  "Gelir ₺0,00 / Gider -₺0,00 / Güncel Bakiye ₺0,00" directly above a list
  containing that very entry; and the budgets round trip stripped `from=summary`
  from the URL.
- Measured on web at 320 px and 390 px across twelve stack routes: the back
  chevron is 9.5 px from every edge of its 44×44 target. That is the "web is
  correct" half of the report; see below for the half that is not testable here.

## Open items

- **Device acceptance remains BLOCKED and no iPhone scenario was executed.** No
  iOS simulator runtime, no `adb`, Xcode lacks platform support for the paired
  iPhone. **Production OTA stays withheld.** [`TESTING.md`](TESTING.md) carries
  the outstanding rows, now including one for the @3x header-back optical
  centre: the cause was closed by arithmetic and is pinned by a unit test, but
  the pixel itself has not been looked at on hardware.
- Cross-user isolation is proven at the database and policy layer. It was **not**
  exercised through two real signed-in accounts in the deployed web app.
- A sign-in that cannot reach the cloud falls back to the local answer after the
  8 s first-pull grace, so an existing account on a broken network can still be
  asked to set up.

## Delivery and rollback evidence

- Delivered web release is `71c665f0451ff7d512e98b7f2d795eda7acce51f`
  ("agree month totals with their breakdown and keep back origins", PR #64),
  Pages run `30168578249`, deployed head SHA identical to that commit.
  Post-deploy smoke on the live site: `/`, `/404.html`, `/sw.js` and
  `/cash-flow/analytics` all 200; a real Chromium load reported zero page and
  console errors, zero failed same-origin requests, and the service worker
  registered at `https://topraksv.github.io/helix/`. The deployed entry bundle
  contains `projectedClosingMinor` / `plannedExpenseMinor` /
  `plannedTransferMinor`, so the shipped JS really is this build. **The live app
  requires sign-in, so the four fixes were exercised end-to-end against the
  release's own local-only export, not against the owner's account.**
- Preview OTA is group `e24a6876-188a-47df-8863-6cbc8416575c` (android
  `019f9a77-336b-7ec2-97df-35f0836c5626`, iOS
  `019f9a77-336b-7914-b8cd-25c9d4a1c5e3`), runtime `1.0.0`, branch `preview`,
  from `71c665f0451ff7d512e98b7f2d795eda7acce51f` with a clean working tree.
  The channel is still mapped unconditionally (`branchMappingLogic: "true"`) to
  the `preview` branch. Installed delivery is **not** verified — no device.
- Previous release, and the rollback anchor for this one: main
  `8a02162` (PR #62); before it, Package 3D main
  `012847192cba2303bb5ff8c2f322e31325265853`, Pages run `30148599977`, OTA group
  `613cbec8-4f52-44b4-b907-0a2be3a5f938`.
- This diff is TS/TSX, tests and docs only — no `app.json`, `eas.json`,
  lockfile, asset, native directory or Supabase migration change — so it needs no
  native rebuild and deploys no schema.

## Next exact step

`NEXT EXACT STEP = installed-device acceptance for the blocked TESTING.md rows, including the new @3x header-back row, once real hardware is available; nothing else is pending.`
