# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Package 3A is reconciled and checkpointed on `package-3-ui-ux-fixes`, based on
  current `main`. The owner approved all five Package 3A audit items with
  “Hepsini çöz”. No PR, merge, deploy, OTA or native build has occurred.
- `UI-BUG-001` is implemented: exact monetary values use a shared measured
  font-step contract without disabling OS font scaling or truncating text. The
  dashboard hero and forecast now use `Amount`; the audited 9,876,543.21 case
  stays on one line at 320 light/dark and 390 month detail, and the aggregate
  produced by the maximum supported entry also stays on one line.
- `UX-FLOW-001` is implemented: local-only Settings no longer exposes the
  cloud account-security entry, a direct `/account-security` link returns to
  Settings, and the misleading local flag-only account-freeze outcome is gone.
  Cloud freeze still requires re-authentication, a confirmed push with an empty
  outbox, and successful sign-out; every failure path rolls the flag back.
- Three new visual baselines cover the exact-money fix. Unit coverage pins the
  monotonic/stable font steps; E2E covers rendered line count, local-only route
  gating and the absent misleading actions.
- The focused owner-requirement reconciliation maps all 14 requested coverage
  areas to the two resolved findings, the three device-only gates, or concrete
  `NO ACTIONABLE ISSUE` evidence. It found no new owner-approval item and did
  not repeat the route/viewport audit.
- Final `npm run verify:release` passed with the complete implementation: 65
  Vitest files / 481 tests, lint, 52-route production export,
  entry/total/export/font/source-map budgets and 22/22 Playwright tests. Expo
  Doctor also passed 18/18.

## Package 3E device acceptance

- `DEVICE-001..003` are carried forward as `DEVICE_ONLY`, not failed code and
  not passed acceptance. Automated axe/semantics/focus, Dynamic Type opt-out prevention,
  responsive/reduced-motion, navigation/dirty-exit, notification/privacy,
  haptic and session contracts are green, but they cannot substitute for the
  physical matrix in [`TESTING.md`](TESTING.md).
- A physical iPhone 16e running iOS 27.0 is paired, unlocked and in Developer
  Mode. It has neither Expo Go nor Helix installed. Xcode 26.6 reports it as an
  ineligible destination because matching iOS platform support is unavailable,
  so no build can be installed from this environment yet.
- No Android device, adb target, AVD or installed client is available. Physical
  VoiceOver/TalkBack/Switch Control, Dynamic Type/Reduced Motion, native back
  and swipe, keyboard/drag interaction, notification/lock-screen privacy,
  app-switcher cover, haptics, biometrics and two-account lifecycle therefore
  remain unclaimed.

## Delivery and rollback evidence

- This package changes no dependency, migration, native config, Expo SDK/plugin,
  runtime version or data model. No database or remote release action is needed
  to validate the current working tree.
- Last code-bearing web release commit: `408c098`; successful Pages run
  `29871029794`. Later handoff/test sync run `29873521094` also passed.
- Last preview OTA group: `40d1d11d-1d30-4d93-91c4-670df321b198`; Android
  `019f86bd-0c1f-76c5-b5c4-121b5d03f396`, iOS
  `019f86bd-0c1f-70d3-8142-6f2284e10bb2`, runtime `1.0.0`.

## Next exact step

`NEXT EXACT STEP = Package 3B from the latest signed checkpoint`
