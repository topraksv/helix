# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-28, Europe/Istanbul

`main` is the only long-lived branch. The project-skill work and the product UI
follow-up were consolidated in [PR #103](https://github.com/topraksv/helix/pull/103);
that PR's final release comment is the authority for its resulting `main`
commit and GitHub Pages run.

| | |
|---|---|
| Previous product baseline | `4d227aac863045581a4bfe43334344197abf2908` |
| Previous web baseline | [GitHub Pages run 30313476658](https://github.com/topraksv/helix/actions/runs/30313476658), successful |
| Current release record | [PR #103](https://github.com/topraksv/helix/pull/103), including exact merge and Pages evidence |
| Native | A new installed binary is still required for the released native-config boundary; do not publish an OTA across it |
| Quality | `npm run verify:release` green: 26 skills, 72 Vitest files / 578 tests, typecheck, lint, export budgets and 44 Playwright tests |

## Product result

The Mali Tablo accessibility race is closed at both levels: the real-data axe
sweep waits for the populated async table, and every web column-pin target is a
measured 24×24 CSS box rather than a 12 px icon with native-only `hitSlop`.
Computed-column readiness is deterministic too.

Shared disabled controls no longer reduce the opacity of their text. Buttons,
icon buttons, fields, selectors, segmented controls, toggles and calendar dates
use explicit neutral disabled colors; browser measurements keep disabled
primary copy at or above 4.5:1 in Amber, Çelik and Servi, light and dark.
Loading buttons remain visually active while blocking a second press. Semantic
success, warning and error cards now carry a real shared tint and boundary.

Web theme preference updates both `color-scheme` and `theme-color`. Generic
buttons, icon buttons, cards and list rows use quiet tonal press feedback rather
than a universal spring scale and automatic haptic. Selection haptics are
reserved for actual discrete state changes such as month/date/option/toggle and
Mali Tablo pin changes. All feedback remains iOS-only through the shared helper.

The information architecture, Turkish copy, financial behavior, local-first
storage, sync, routes, forms and web/native feature parity are unchanged. No
migration, dependency, native config or financial-data boundary changed in this
follow-up.

## Verification

The fresh release gate passed:

- `npm run verify`: 26/26 pinned skill snapshots, typecheck, 72/72 Vitest files,
  578/578 tests and Expo lint.
- Production export: 56 static routes; 9,274,624-byte total export against the
  10,000,000-byte budget; six fonts / 1,518,000 bytes; zero source maps;
  Supabase public config inlined as expected.
- Playwright: 44/44, including the real-data route accessibility sweep, complete
  two-width layout sweep, six-theme disabled-control contrast, browser chrome
  scheme, navigation, resilience, import atomicity and visual baselines.
- `npx expo config --type public --json` resolved SDK 54, `/helix`, runtime
  `1.0.0`, preview channel and the expected platform settings.
- `npx expo-doctor`: 18/18 checks passed.

The nine changed screenshot baselines were limited to controls whose disabled
rendering changed and the widened Mali Tablo marker strip; their actual/diff
images were inspected before acceptance. Generated exports, Playwright results
and Expo cache were moved to the system Trash after verification.

## Acceptance boundary

- Installed iOS and Android acceptance remains `BLOCKED`: no simulator/device
  evidence exists for rotation, keyboard avoidance, VoiceOver/TalkBack, Dynamic
  Type, native focus return, safe areas, haptics or the released splash colors.
- Although this follow-up's runtime changes are JavaScript-only, the currently
  installed build still predates a released native-config boundary. An OTA
  cannot make that binary representative; build and install a fresh native
  client first.
- Weekly/biweekly subscription cycles remain requested but unbuilt and require
  their own migration/domain package.

## Next exact step

Build and install a fresh preview binary, then run the physical-device matrix in
[`TESTING.md`](TESTING.md). Only after that binary establishes the current
native boundary should a later JavaScript-only package use EAS Update.
