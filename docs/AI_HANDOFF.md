# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-28, Europe/Istanbul

`main` is the only long-lived branch. The completed ledger UI package shipped
through [PR #104](https://github.com/topraksv/helix/pull/104); its protected
merge, required `quality` check and GitHub Pages deployment are complete.

| | |
|---|---|
| Product release commit | `75c645c7aa50cf6bdb8402281ec9d000c5abba2d`, GitHub signature verified |
| Web release | [GitHub Pages run 30372978979](https://github.com/topraksv/helix/actions/runs/30372978979), successful |
| Release record | [PR #104](https://github.com/topraksv/helix/pull/104) |
| Native | A new installed binary is still required for the released native-config boundary; do not publish an OTA across it |
| Local quality | `npm run verify:release` green: 26 skills, 72 Vitest files / 579 tests, typecheck, lint, export budgets and 51 Playwright tests |

## Product result

The dashboard, Mali Tablo, analytics, subscriptions, settings, authentication,
onboarding, import and follow-up editors now share one connected ledger visual
system. Amber is the default palette; Petrol and Servi remain user-selectable.
The primary routes, dense tables and forms reflow across phone, tablet and
desktop widths without page overflow, hidden actions or ellipsized labels.

Custom selectors, radio groups, switches, expandable sections, images, quote
groups and modal flows expose their actual state to assistive technology.
Keyboard focus returns only after a picker modal has closed, form Enter handling
stays with the focused control, and mobile disclosures publish their expanded
state on web and native. Long Mali Tablo labels wrap and increase row height
instead of truncating.

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

An earlier release-gate attempt correctly failed two outdated browser
expectations; both were updated to the reachable UI and passed 15/15 repeated
runs before the full green gate. A later full-suite performance sample measured
the unchanged batched path at 3.14× faster than the per-month path, below its 4×
guard. The unchanged benchmark then passed 5/5 isolated runs and the clean full
gate without weakening the threshold.

## Acceptance boundary

- GitHub Pages is released and live smoke-verified from the product release
  commit above.
- Installed iOS and Android acceptance remains `BLOCKED`: no current
  simulator/device evidence exists for rotation, keyboard avoidance,
  VoiceOver/TalkBack, Dynamic Type, native focus return, safe areas, haptics or
  the released native configuration.
- Although this package is JavaScript and existing assets only, the currently
  installed build predates the released native-config boundary. An OTA cannot
  make that binary representative; build and install a fresh native client
  first.
- Weekly/biweekly subscription cycles remain requested but unbuilt and require
  their own migration/domain package.

## Next exact step

Build and install a fresh preview binary and execute the physical-device matrix
in [`TESTING.md`](TESTING.md); only that binary can establish the current native
boundary for a later OTA.
