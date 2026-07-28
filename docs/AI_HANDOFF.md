# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-28, Europe/Istanbul

`main` remains the only long-lived branch. The current
`agent/color-motion-skills` branch contains an unmerged project-skill package;
it changes agent instructions, skill snapshots, documentation, CI/test
contracts and the skill integrity script. Product UI, runtime behavior, data,
migrations and app dependencies are unchanged.

| | |
|---|---|
| Last product release commit | `4d227aac863045581a4bfe43334344197abf2908` |
| Web | [GitHub Pages run 30313476658](https://github.com/topraksv/helix/actions/runs/30313476658), successful |
| Native | The released UI/UX package still needs a new binary; no OTA is valid for its native config changes |
| Skill inventory | 26 directories / 183 files / 1.6 MB; 19 full-SHA-pinned vendor specialists + 7 hash-pinned Helix adapters |
| Commit gate | `npm run verify` passed: 26 skill snapshots, 72 Vitest files / 571 tests, typecheck and lint |

## Skill tree package

The canonical routing and provenance are in
[`AI_ENGINEERING_SKILLS.md`](AI_ENGINEERING_SKILLS.md). The package removes the
Next.js/RSC skill, duplicate generic React Native performance skill, unused
Software Mansion domains, color-history archive, web/Tailwind implementation
skill and incomplete architecture-report skill. The previous broad mobile
accessibility package is replaced by a bounded Helix adapter.

New Helix entry points cover security/hardening, dependency security,
financial-data integrity, platform/release acceptance, native interaction,
visual system/Turkish copy and mobile accessibility. Trail of Bits'
property-based testing skill is added for high-dimensional transformations.

Anthropic's `defending-code-reference-harness` was reviewed but not installed:
the repository says it is unmaintained and its autonomous C/C++ runner assumes
Docker/gVisor and restricted egress. Its useful method—threat model, skeptical
verification, severity by preconditions/impact, variant search, regression
before patch and independent re-check—is adapted into
`security-and-hardening`. Anthropic's security-review Action was also not added
because its own documentation says it is not prompt-injection hardened and it
would introduce an API secret.

`npm run verify:skills` now blocks directory/lock drift, mutable GitHub refs,
hash changes, symlinks, incomplete frontmatter, TODO templates, escaping links
and missing local Markdown references. It uses the same folder-hash algorithm
as the skills CLI, runs inside `npm run verify` and the required `quality` job,
and has positive plus tamper/missing-link regression tests. Expanding it to the
whole Markdown tree exposed eight real broken vendor links; all were repaired
and recorded with the other vendor patches.

## Verification and open finding

`npm run verify` is green: 26/26 skill snapshots, 72/72 Vitest files, 571/571
tests, typecheck and lint.

`npm run verify:release` passed the skill gate, typecheck, 571 Vitest tests,
lint, 56-route production export and bundle budgets
(`4,742,231`-byte entry JS, `5,371,413`-byte total JS, `9,273,916`-byte export,
six fonts / `1,518,000` bytes, zero source maps, Supabase config inlined).
Playwright finished **41/42**, so the release gate is not green.

The failure is a pre-existing race in the real-data axe sweep, not a skill-tree
regression. The test waits only for `#root`, not the async cash-flow table. When
the table is present, axe reports eight column-pin buttons whose DOM target is
the 12 px icon; React Native `hitSlop` does not make their web CSS target 24×24.
When the table is not ready, the same audit skips those controls. Evidence: the
full run failed on `Kredi Kartı kolonunu sabitle`; the unchanged focused test
immediately passed. Do not call the release gate green or suppress the rule.
Fix the pin control and add a deterministic table-ready assertion in a separate
product/test package, then rerun the full release gate.

Generated `dist/`, `dist-e2e/`, Playwright results and report were moved to the
system Trash after inspection. No task-only artefacts remain in the repository.

## Existing acceptance blockers

- Installed iOS and Android acceptance remains `BLOCKED`: no simulator/device
  evidence exists for rotation, keyboard avoidance, VoiceOver/TalkBack, Dynamic
  Type, native focus return, safe areas or the released splash colors.
- Weekly/biweekly subscription cycles remain requested but unbuilt and require
  their own migration/domain package.

## Next exact step

Commit the skill-tree package after the final staged-diff audit. Treat the
sticky-table 24×24 target plus deterministic axe readiness as a separate,
focused product/test fix before claiming the next release gate or merging a
release candidate.
