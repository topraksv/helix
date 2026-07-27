# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-28, Europe/Istanbul

`main` is the only long-lived branch. The product UI/UX, accessibility and brand
package was squash-merged through
[PR #101](https://github.com/topraksv/helix/pull/101).

| | |
|---|---|
| Last product release commit | `4d227aac863045581a4bfe43334344197abf2908` |
| Web | [GitHub Pages run 30313476658](https://github.com/topraksv/helix/actions/runs/30313476658), successful |
| Native | New binary required because `app.json` orientation and splash/adaptive colours changed; no OTA is valid for this package |
| Gate | 71 Vitest files / 569 tests; 42 Playwright; Expo Doctor 18/18; release export and bundle budget clean |

The package establishes the Connected Financial Ledger design direction:
Çelik is the default palette, desktop dashboard information is arranged as an
asymmetric ledger while phone density is preserved, palette names match their
visible identity, and cash-flow horizontal continuation is explicit. The design
language and rejected generic dashboard treatments are recorded in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

Draft protection now covers browser unload and same-screen context changes,
including budgets, categories, people, payment sources, incomes, computed
columns, reconciliation, bulk entry and import replacement. Atomic bulk/import
commits cannot be cancelled after their write boundary. Modal motion follows
Reduce Motion, modal wrappers are removed from the keyboard tab order, and the
calculator fits all controls and its result in 844×390 landscape without an
initial scroll.

The responsive smoke matrix covers 320×568, 375×667, 390×844, 430×932,
768×1024, 820×1180, 1024×768, 1280×800, 1440×900 and 1920×1080 across the
dashboard, cash flow, transaction and settings routes. Darwin and Linux visual
baselines were rendered independently; the suite includes a dedicated
844×390 calculator baseline. Account security is included in the real-data axe
route set.

Fresh `npm run verify:release` completed with typecheck and lint clean,
569/569 Vitest tests, 42/42 Playwright tests and 56 exported routes. The
production export is 4,742,231-byte entry JavaScript, 5,371,413-byte total
JavaScript and 9,273,916-byte total export, with six fonts / 1,518,000 bytes,
zero source maps and inlined Supabase configuration. Compared with the previous
release, JavaScript and total export each grew by 2,540 bytes.

The protected PR gate passed `quality`, CodeQL and dependency review. The
resulting GitHub squash commit is verified. The `main` Pages run repeated the
full quality job successfully, then deployed. Live smoke verified root,
upcoming and settings as 200; the dynamic July 2026 cash-flow URL returns the
expected 404 with a byte-identical root application shell and a loadable release
entry asset.

Existing non-blocking tool output remains: Node's experimental SQLite warning,
the `NO_COLOR`/`FORCE_COLOR` warning and Expo Notifications' unsupported web
listener notice. Dependency policy and the Expo-managed matrix were not changed.

## Open product backlog

- Weekly / biweekly subscription cycles remain requested but unbuilt.
  `subscriptions.cycle` is still `monthly | yearly | custom`; adding shorter
  cadences needs an ISO anchor, a Supabase migration, generated-type refresh and
  expected-payment lifecycle tests. Keep it as its own package.

## Open structural and acceptance findings

- Installed iOS and Android acceptance is `BLOCKED`: Xcode is installed, but no
  iOS simulator/device is available and `adb` reports no Android device.
  Validate rotation, keyboard avoidance, VoiceOver/TalkBack, Dynamic Type,
  native focus return, safe areas and the new splash colours on a fresh local
  device build before claiming native acceptance.
- The documented `src/ui/components.tsx` ↔ `src/ui/calculator.tsx` cycle remains
  a P3 structural preference. It has no measured runtime or bundle cost and was
  outside this product audit.
- Desktop empty-fixture whitespace and the existing global radius scale were
  reviewed and left unchanged: filling the empty state would add decorative
  dashboard content, while a global radius rewrite would create broad geometry
  churn without a demonstrated usability gain.

## Phase 2

Completed: P0, P1, P4 and P2. P3 was withdrawn. Remaining owner order is
**P7 → P6 → P9**; P5 and P8 are backlog. The canonical scope and open decisions
are in [`PHASE2.md`](PHASE2.md).

## Next exact step

Make a fresh local iOS/Android device build for the blocked native acceptance
matrix. Do not publish this release as an OTA because its orientation and
splash/adaptive icon configuration require a new binary.
