# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-27, Europe/Istanbul

`main` is the only long-lived branch. The engineering quality package was
squash-merged through [PR #98](https://github.com/topraksv/helix/pull/98).

| | |
|---|---|
| Last product release commit | `faba0689b3330c2c00cd21e1d455923855165faf` |
| Web | [GitHub Pages run 30303880841](https://github.com/topraksv/helix/actions/runs/30303880841), successful |
| Native | EAS Update group `0d7066ab-e99e-457d-8b08-828ec7e3a5b5`, channel/branch `preview`, runtime `1.0.0`, Android + iOS |
| Gate | 71 Vitest files / 568 tests; 40 Playwright; Expo Doctor 18/18; linked pgTAP 59/59 |

The repository-wide audit inventoried 614 starting tracked files and reviewed
284 production, test and configuration files file-by-file. The remaining
documents, assets and vendored skill files were classified and reference-scanned
where applicable. No reproducible P0/P1 remained.

The package replaces percentage-based cross-platform screenshot tolerance with
23 Darwin/Linux baseline pairs and a five-pixel absolute budget, makes the FX
and invalid-backup tests fail on the real protected boundaries, fixes linked
pgTAP completion under the CLI role, and keeps the installed navigation graph
unchanged while aligning Expo's supported manifest range.

Credit-card statement history now aggregates transactions in one pass. The
deterministic 120-statement / 100,000-transaction benchmark measured 82.50 ms →
2.26 ms median and 86.17 ms → 2.44 ms p95, with zero mismatched totals.

Production export is 4,739,691-byte entry JavaScript, 5,368,873-byte total
JavaScript and 9,271,376-byte total export, with six fonts / 1,518,000 bytes,
zero source maps and inlined Supabase configuration. Live Pages smoke verified
root/upcoming/settings as 200, and the dynamic month URL as the expected 404
with a root-identical application shell and a loadable release entry asset.

The EAS group contains one Android and one iOS update for the release commit;
the channel still maps unconditionally to the `preview` branch. Initial
insights show zero installs and zero failed installs. Installed delivery remains
unverified until the owner performs two cold starts and a visible login flow on
the preview build.

Existing non-blocking tool output remains: Node's experimental SQLite warning,
the `NO_COLOR`/`FORCE_COLOR` warning and Expo Notifications' unsupported web
listener notice. `npm ci` reports 29 audit advisories (4 moderate, 25 high);
this package did not force or major-upgrade dependencies.

## Open product backlog

- Weekly / biweekly subscription cycles remain requested but unbuilt.
  `subscriptions.cycle` is still `monthly | yearly | custom`; adding shorter
  cadences needs an ISO anchor, a Supabase migration, generated-type refresh and
  expected-payment lifecycle tests. Keep it as its own package.

## Open structural and acceptance findings

- The documented `src/ui/components.tsx` ↔ `src/ui/calculator.tsx` cycle is a P3
  structural preference. Breaking it would broaden the UI seam without measured
  runtime or bundle benefit; this audit deliberately left it unchanged.
- `src/ui/tab-bar.tsx` imports a type from the transitive
  `@react-navigation/bottom-tabs` package. Adding a direct dependency or
  changing the type seam remains a separate package decision.
- No device acceptance run happened. Every device-only claim remains `BLOCKED`
  in [`TESTING.md`](TESTING.md).

## Phase 2

Completed: P0, P1, P4 and P2. P3 was withdrawn. Remaining owner order is
**P7 → P6 → P9**; P5 and P8 are backlog. The canonical scope and open decisions
are in [`PHASE2.md`](PHASE2.md).

## Next exact step

Perform two full close/open cycles on the installed preview build, confirm the
target update and login flow, then raise whether P7 may ship without a device
run and settle its file-size and total-storage limits.
