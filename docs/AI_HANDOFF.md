# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-25, Europe/Istanbul

- Package 3C is delivered. Protected main carries
  `3a03ebfdae740b5f970b9c7c687d8bed6b0d3b8c` (PR #55, squash), GitHub Pages run
  `29940726760` deployed it, and the `preview` OTA was published from that exact
  commit.
- The package changed no product flow, route destination, presentation type,
  copy, financial behavior, data model, dependency, native configuration or
  runtime version. Its diff is JS/TS, tests and this document only, so no native
  rebuild is required.
- Shared modal accessibility owns the complete overlay lifetime: on web only the
  topmost semantic modal traps forward and reverse Tab, and every platform
  suppresses the underlying form's global Enter shortcut while a modal is open.
  Close still returns focus to the trigger where one exists.
- The calculator and product tour keep their established cards and actions but
  own bounded vertical scrolling when a short landscape viewport cannot hold
  them. Both actions are reachable at 844×390 with ordinary portrait and desktop
  geometry unchanged.
- The existing dashboard-chart, list-action, analytics, import-guide and Cash
  Flow matrix boundaries share one capability-based responsive helper with
  unchanged thresholds and boundary tests.
- No new owner-approval item is open. The two approved Package 3A P1 fixes
  remain green.

## Validation

- Required `quality` on the merge commit passed: clean `npm ci`, typecheck,
  66 Vitest files / 488 tests, zero-warning lint, 52-route production export,
  entry/total/export/font budgets, `sourceMapFiles 0` and
  `sourceMapReferences 0`, and 25/25 Playwright. The `deploy` job published the
  artifact to the `github-pages` environment.
- Live Pages smoke on the deployed commit passed: every exported static route
  returns 200; an unexported month URL returns 404 with a byte-identical copy of
  the root shell (never `+not-found`); entry assets carry no `sourceMappingURL`
  and no `.map` sibling is served; no report, SARIF, coverage or `.env` artifact
  is published; signed-out deep links resolve to the auth guard without a
  runtime error; the recovery route stays exempt; light/dark and 1280/390/844×390
  /320 px viewports render with no horizontal overflow and no console or page
  error.
- The production web build is Supabase-configured, so its in-app surfaces need a
  real cloud session. The four Package 3C behaviours are therefore proven by the
  release-gate browser suite on this exact commit — modal Tab containment,
  dirty-exit Enter isolation with route and draft preserved, and the 844×390
  reachability of the tour `Geç` and calculator `Sonucu Kullan` actions — and the
  deployed bundle demonstrably ships the focus-trap code.

## Package 3E device acceptance

- `DEVICE-001..003` remain `DEVICE_ONLY`, not failed code and not completed
  acceptance. Automated web evidence cannot replace physical VoiceOver,
  TalkBack, Switch Control, Dynamic Type, Reduced Motion, native back/swipe,
  keyboard/drag, notification/privacy, haptic and account-lifecycle checks.
- A physical iPhone 16e running iOS 27.0 is paired and Developer Mode is on,
  but Xcode 26.6 lacks matching platform support. No Android device, adb target
  or AVD is available. These constraints carry unchanged into Package 3E.

## Delivery and rollback evidence

- Last delivered web release is the Package 3C protected-main commit
  `3a03ebfdae740b5f970b9c7c687d8bed6b0d3b8c`; Pages run `29940726760` and
  `github-pages` deployment `5559706841` succeeded.
- Last preview OTA is Package 3C group `765e686e-c64b-4ac1-81d3-c521f7b3cfbe`;
  Android `019f97c3-7377-7d04-8967-371613b50555`, iOS
  `019f97c3-7377-79e2-962b-1947079d62c3`, runtime `1.0.0`, branch `preview`,
  exact git commit `3a03ebfdae740b5f970b9c7c687d8bed6b0d3b8c`, clean working
  tree, 34 assets per platform and zero source-map assets. The channel still
  maps unconditionally to the `preview` branch.
- Installed delivery is **not** `VERIFIED`: EAS insights report `0` installs and
  the two required cold starts cannot run without an available device.
- Rollback anchor is the Package 3B release: main
  `6785af29ae95ca165e68f8a47020d14803b85977`, Pages run `29937138636`, OTA group
  `2bc9bec5-0be7-4efb-a51d-e12fee426615`.

## Next exact step

`NEXT EXACT STEP = Package 3D from the final verified Package 3C release state.`
