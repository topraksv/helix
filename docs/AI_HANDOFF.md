# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

- Package 3D (UX flows, information architecture, forms, feedback) is
  implemented on `package-3d-ux-flows`, branched from the delivered Package 3C
  main. It changes no financial calculation, ownership rule, sync or session
  behaviour, navigation destination, presentation type, data model, dependency,
  native configuration or runtime version.
- **Engine errors no longer reach the screen.** `UserFacingError` /
  `userMessage` (`src/domain/user-error.ts`) mark the messages authored for
  people; a repository, database, file-system or share-sheet failure now
  resolves to `tr.errors.saveFailed` / `tr.errors.requestFailed` instead of
  English technical text, while backup, workbook and import diagnostics keep
  their precise Turkish wording. Every one of those catch sites also logs
  through the dev-only logger.
- **Enter belongs to the focused control.** The web submit shortcut listened on
  the window in the capture phase, so the form's primary Save answered every
  Enter: focusing "Kaydet ve Yeni Ekle" saved and left the screen, the refund
  switch committed the entry instead of flipping its sign, and a category chip
  could not be chosen with the keyboard. `focusOwnsEnterKey`
  (`src/ui/submit-shortcut.ts`, deliberately free of React Native so it is
  unit-testable) hands Enter to buttons, switches, radios, tabs, links, options
  and editable content; it still submits from a single-line field.
- **A stay-on-screen save now confirms itself.** "Kaydet ve Yeni Ekle" shows
  "İşlem kaydedildi." through the shared snackbar, which is announced politely
  and needs no undo action. Owner-approved (`3D-F03`).
- Owner dispositions: `3D-F04` (no new offline/pending wording) `KEEP AS IS`;
  `3D-F05` (form disclosure and control count) `DEFER` to a later owner-reviewed
  visual package. Neither was implemented.

## Validation

- `npm run verify:release` passed on the final tree: typecheck, zero-warning
  lint, full Vitest suite, 52-route production export, entry/total/export/font
  budgets with `sourceMapFiles 0` and `sourceMapReferences 0`, and the full
  Playwright suite.
- Mutation proof: with the pre-fix rules restored, 4 of the new unit assertions
  fail; with the fixes in place all pass. The dialog-semantics E2E now asserts
  the user-language outcome **and** the absence of the raw exception text — the
  same test previously proved that raw text was on screen.
- New browser regression: Enter on the secondary save, on the refund switch and
  on a category chip each performs that control's own action and leaves the
  route and draft alone, while Enter from the amount field still saves and
  exits.
- No screenshot baseline was updated.

## Package 3E device acceptance

- `DEVICE-001..003` remain `DEVICE_ONLY`, not failed code and not completed
  acceptance. Automated web evidence cannot replace physical VoiceOver,
  TalkBack, Switch Control, Dynamic Type, Reduced Motion, native back/swipe,
  keyboard/drag, notification/privacy, haptic and account-lifecycle checks, the
  two OTA cold starts or OTA adoption.
- A physical iPhone 16e running iOS 27.0 is paired and Developer Mode is on,
  but Xcode 26.6 lacks matching platform support. No Android device, adb target
  or AVD is available. These constraints carry unchanged into Package 3E.

## Delivery and rollback evidence

- Last delivered web release is the Package 3C protected-main commit
  `3a03ebfdae740b5f970b9c7c687d8bed6b0d3b8c`; Pages run `29940726760` and
  `github-pages` deployment `5559706841` succeeded. The later documentation-only
  commit `3601d23e089087b1e9797df8c15fec68cf9e2e45` redeployed the same
  application bundle and intentionally carries no OTA of its own.
- Last preview OTA is Package 3C group `765e686e-c64b-4ac1-81d3-c521f7b3cfbe`;
  Android `019f97c3-7377-7d04-8967-371613b50555`, iOS
  `019f97c3-7377-79e2-962b-1947079d62c3`, runtime `1.0.0`, branch `preview`,
  exact git commit `3a03ebfdae740b5f970b9c7c687d8bed6b0d3b8c`, zero source-map
  assets. Installed delivery is **not** `VERIFIED`: the two required cold starts
  need a device.
- Package 3D is JS/TS, tests and documentation only, so it needs no native
  rebuild and is delivered as a protected-main Pages release plus one
  exact-main `preview` OTA.

## Next exact step

`NEXT EXACT STEP = Package 3E from the final verified Package 3D release state.`
