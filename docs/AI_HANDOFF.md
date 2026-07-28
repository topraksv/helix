# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-28, Europe/Istanbul

`main` is the only long-lived branch. The completed ledger UI package shipped
through [PR #104](https://github.com/topraksv/helix/pull/104); its protected
merge, required `quality` check and GitHub Pages deployment are complete.
The OTA release record and a web-only modal-focus race correction are in
[PR #106](https://github.com/topraksv/helix/pull/106).

| | |
|---|---|
| Product release commit | `75c645c7aa50cf6bdb8402281ec9d000c5abba2d`, GitHub signature verified |
| Repository head | `84e7e41e8ad486c163ce9648e3a28d99cc7e800a`, GitHub signature verified; only the release handoff changed after the product commit |
| Web release | Product [Pages run 30372978979](https://github.com/topraksv/helix/actions/runs/30372978979) and final [run 30374858746](https://github.com/topraksv/helix/actions/runs/30374858746), successful |
| Release record | [PR #104](https://github.com/topraksv/helix/pull/104) |
| Preview OTA | [Group `e79b0ed2-9ad0-46eb-bea9-7e6624d0329c`](https://expo.dev/accounts/topraksv/projects/helix/updates/e79b0ed2-9ad0-46eb-bea9-7e6624d0329c), runtime `1.0.0`, branch/channel `preview`, commit `84e7e41e8ad486c163ce9648e3a28d99cc7e800a` |
| Native | OTA publish is complete; installed delivery and the released native-config boundary still require a current binary plus physical-device acceptance |
| Local quality | `npm run verify:release` green: 26 skills, 72 Vitest files / 579 tests, typecheck, lint, export budgets and 51 Playwright tests |

## Product result

The dashboard, Mali Tablo, analytics, subscriptions, settings, authentication,
onboarding, import and follow-up editors now share one connected ledger visual
system. Amber is the default palette; Petrol and Servi remain user-selectable.
The primary routes, dense tables and forms reflow across phone, tablet and
desktop widths without page overflow, hidden actions or ellipsized labels.

Custom selectors, radio groups, switches, expandable sections, images, quote
groups and modal flows expose their actual state to assistive technology.
Web modal headings receive focus without a delayed timer that can steal focus
after a fast Tab; native accessibility focus keeps its existing post-mount
delay. Keyboard focus returns only after a picker modal has closed, form Enter
handling stays with the focused control, and mobile disclosures publish their
expanded state on web and native. Long Mali Tablo labels wrap and increase row
height instead of truncating.

The final browser regressions were stale test assumptions after the redesign:
the refund switch and analytics filters now open through their visible
disclosures, future-month assertions use the current relative month, and modal
helpers wait for delayed focus restoration. Screenshot baselines and README
gallery images were regenerated from the reviewed final surfaces.

Financial behavior, local-first storage, sync, routes, privacy and native/web
feature parity are unchanged. This package has no migration, dependency,
runtime, app-config or native-module change.

## Verification

The fresh release gate passed:

- `npm run verify`: 26/26 pinned skill snapshots, typecheck, 72/72 Vitest files,
  579/579 tests and Expo lint.
- Production export: 56 static routes; 4,823,383-byte entry JavaScript,
  5,452,565-byte total JavaScript and 9,355,068-byte total export, all within
  budget; six fonts / 1,518,000 bytes; zero source maps; Supabase public config
  inlined as expected.
- Playwright: 51/51, including all local-data routes, WCAG checks, the complete
  two-width layout sweep, keyboard/modal semantics, navigation, resilience,
  import atomicity and reviewed visual baselines.
- `npx expo config --type public --json` resolved the expected public config.
- `npx expo-doctor`: 18/18 checks passed.
- `git diff --check` passed and generated export, Playwright result and Expo
  cache directories were moved to the system Trash.
- PR #104's dependency review, CodeQL and required `quality` check passed. The
  protected `main` run repeated the complete gate and deployed Pages.
- Live Pages smoke: `/helix/` and `/helix/upcoming` returned 200;
  `/helix/settings` used GitHub Pages' canonical 301 to `/helix/settings/`, which
  returned 200. `/helix/cash-flow/2099-12` returned the expected 404 with a body
  byte-identical to the root shell, whose referenced entry JavaScript returned
  200.
- EAS Update published with the mandatory clean Metro cache. The group contains
  iOS update `019fa976-524f-706e-a312-d738860d2abf` and Android update
  `019fa976-524f-7f74-9232-bfeeb150ece0`; both report runtime `1.0.0`, branch
  `preview` and the repository head above. The channel remains active with one
  unconditional mapping to `preview`. Initial insights are zero installs,
  failures and users on both platforms, which is expected before a device
  checks for the new update.

An earlier release-gate attempt correctly failed two outdated browser
expectations; both were updated to the reachable UI and passed 15/15 repeated
runs before the full green gate. A later full-suite performance sample measured
the unchanged batched path at 3.14× faster than the per-month path, below its 4×
guard. The unchanged benchmark then passed 5/5 isolated runs and the clean full
gate without weakening the threshold.

PR #106's first CI run exposed a real web focus race twice: React Native Web
temporarily focused the alert action, the test accepted any focus inside the
modal, and the shared 40 ms timer then pulled focus back to the heading after
Tab. The web path now focuses synchronously when its effect runs; the regression
waits for the heading specifically. The corrected test passed 10/10 locally.

## Acceptance boundary

- GitHub Pages is released and live smoke-verified from the product release
  commit above.
- Installed iOS and Android acceptance remains `BLOCKED`: no current
  simulator/device evidence exists for rotation, keyboard avoidance,
  VoiceOver/TalkBack, Dynamic Type, native focus return, safe areas, haptics or
  the released native configuration.
- Although this package is JavaScript and existing assets only, the currently
  installed build predates the released native-config boundary. The preview OTA
  is available to compatible runtime `1.0.0` clients, but receiving it does not
  make an old binary representative of the current native configuration.
- Installed delivery remains `BLOCKED` until a compatible client performs two
  complete cold starts and the owner verifies that the target UI opens and
  Supabase sign-in succeeds. If the existing client does not request the
  `preview` channel, install a fresh native preview build first.
- Weekly/biweekly subscription cycles remain requested but unbuilt and require
  their own migration/domain package.

## Next exact step

On a compatible preview client, perform two complete cold starts and verify the
target UI plus Supabase sign-in. If the update is not received, build and install
a fresh preview binary. Then execute the physical-device matrix in
[`TESTING.md`](TESTING.md) to establish the current native boundary. After PR
#106 closes, implement the measured CI/release optimization package without
weakening the protected-branch or environment-isolation boundaries.
