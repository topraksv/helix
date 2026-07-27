# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-27, Europe/Istanbul

`main` is the only long-lived branch. The repository hygiene package is the
resulting HEAD; use `git log` for its hash. It does not change product behaviour,
data, UI, migrations, dependencies or the production bundle.

| | |
|---|---|
| Last product release commit | `350abce` |
| Web | GitHub Pages via the resulting `main` `deploy-web` run |
| Native | EAS Update group `09d39a71-13c8-47a9-911d-954dba992fb6`, channel `preview`; unchanged because the cleanup production bundle is byte-identical |
| Gate | 71 Vitest files / 567 tests; 40 Playwright; bundle within budget; `supabaseConfigInlined: true` |

The cleanup package narrows generated-output ignores, aligns ESLint's E2E output
path, moves the UI-owned brand colour table from `src/domain/` to `src/ui/`,
corrects the Phase 2 open-decision list, installs the project cleanup and
explicit-only architecture skills, and adds the delta-focused end-of-task
hygiene rule to `AGENTS.md`.

`npm run verify:release` passes. Production export remains 4,739,591-byte entry
JavaScript, 5,368,773-byte total JavaScript, 9,271,276-byte total export, six
fonts / 1,518,000 bytes, zero source maps and inlined Supabase configuration.
`npm ls --all` and Expo public config resolution pass.

`npx expo-doctor` remains 17/18 and `npx expo install --check` remains non-zero
for the pre-existing `@react-navigation/native` 7.3.14 versus Expo's expected
`^7.1.8`. This package deliberately does not upgrade dependencies.

## Open product backlog

- Weekly / biweekly subscription cycles remain requested but unbuilt.
  `subscriptions.cycle` is still `monthly | yearly | custom`; adding shorter
  cadences needs an ISO anchor, a Supabase migration, generated-type refresh and
  expected-payment lifecycle tests. Keep it as its own package.

## Open structural and acceptance findings

- `src/ui/tab-bar.tsx` imports a type from the transitive
  `@react-navigation/bottom-tabs` package. Adding a direct dependency or
  changing the type seam needs a separate package decision.
- Timing-sensitive accessibility/performance checks have produced isolated
  local flakes but pass in the final full release gate. Do not weaken them or
  regenerate goldens as a cleanup workaround.
- No device acceptance run has happened. Every device-only claim remains
  `BLOCKED` in [`TESTING.md`](TESTING.md).

## Phase 2

Completed: P0, P1, P4 and P2. P3 was withdrawn. Remaining owner order is
**P7 → P6 → P9**; P5 and P8 are backlog. The canonical scope and open decisions
are in [`PHASE2.md`](PHASE2.md).

## Next exact step

Raise whether P7 may ship without a device run, then settle its file-size and
total-storage limits. If P7 proceeds, run `PHASE2.md` § “How a package runs”.
