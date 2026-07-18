# Helix AI handoff

This is the living continuity record shared by Codex and Claude. It describes
the current working state, not the permanent architecture; durable rules belong
in `AGENTS.md`. Git and the current files are authoritative whenever this note
lags behind them.

## Last verified state

- Updated: 2026-07-18 (Europe/Istanbul)
- Branch: `agent/followup-release-record` from main `a249492`
- Completed remediation packages: P8–P10 audit follow-up and release record
- Toolchain used: Node 22
- Verification: typecheck, 48 files/289 tests, zero-warning Expo lint,
  52-route static web export, measured bundle budget and 9/9 Playwright flows
  (real browser SQLite/restore/offline/deep-link/follow-up UX, axe and 21
  screenshot baselines). Linked migrations 1–7 match, linked DB lint is clean
  and remote pgTAP remains 24/24. Protected PR quality passed; main Pages run
  and live route probes are recorded in `AUDIT_TRACKER.md`. EAS `preview` OTA
  group `1d2ed181-0dcd-48be-abae-3985d414854b` was published from `a249492`.
  No installed device was available, so physical screen-reader/OS/privacy/OTA,
  Face ID/edge-swipe and two-client sync acceptance are not claimed.
- Test baseline: 48 files, 289 Vitest tests plus 9 Playwright flows passing

## Active working tree

The remediation of Codex's independent 2026-07-17 audit and the 2026-07-18
follow-up is complete and shipped. P0–P10 cover scope/data integrity;
CI/GitHub/EAS; linked DB/type boundaries; architecture and measured scale;
UI/UX/a11y/privacy; product/IA; persistent automation; plus follow-up simplicity,
market/sync/navigation/auth reliability and final documentation. The technical
diagnostics screen/global sync badge introduced earlier were removed at the
user's request; bounded PII-free breadcrumbs and action-level sync feedback
remain without exposing an end-user health console.
`docs/AUDIT_TRACKER.md` is the ID/status source of truth.

The four-package 2026-07-17 audit remediation is COMPLETE and fully deployed:
1 hygiene/docs (`98fa44f`), 2 data-layer/web hardening (`0692027`),
3 liveliness (`5ac5205`), 4 scale (`00eb8f3`) — web + mobile OTA. Supabase
migration 5 was applied by the user via `supabase db push` and independently
verified by Claude afterwards: `migration list --linked` shows 1–5 identical
on both sides and `db lint --linked` reports no errors. (The partial unique
index on cell_notes creating successfully also proves the dedup left no
conflicting live rows.) Those packages remain the trusted baseline; the newer
Codex audit found additional work now tracked by ID. The user explicitly keeps
the audit's “şimdi yapılmamalı” items and Expo SDK 54 advisories in backlog;
all other automatable findings are resolved. Always re-check `git status`; Git
remains authoritative.

## Current architecture summary

- Expo SDK 54 / React Native / Expo Router; Node 22 is required locally.
- Local-first async SQLite through Drizzle's `sqlite-proxy`; never restore the
  synchronous bridge.
- User mutations go through `writeRows`; deletes are synced tombstones.
- Supabase sync uses an outbox, server RLS, and LWW merging.
- Money is integer minor units; dates/months are ISO strings.
- Pure business logic lives in `src/domain` and receives unit tests.
- Shared UI primitives and tokens live in `src/ui`; Turkish strings live in
  `src/i18n/tr.ts`.
- Web ships from `main`; app-code changes also require an EAS Update to the
  `preview` branch unless a native rebuild condition applies.

Read `AGENTS.md` for the complete, canonical rules and shipping procedure.

## Open audit backlog

`docs/AUDIT_TRACKER.md` is the authoritative audit backlog. Its five
`BACKLOG-*` items are intentionally deferred: the SDK 54 advisory chain,
unnecessary technology rewrites, calculator-tab removal without usage data,
bank/server-push/widget/multi-user expansion, and enterprise architecture
patterns. Five acceptance rows remain `BLOCKED` only on an installed device or
two disposable authenticated clients: account-switch late work, remote outbox
drain after offline relaunch, physical screen readers/Dynamic Type, low-memory
hostile-import stress, and OS notification/privacy behavior. Physical Face ID
autofill and iOS edge-swipe are also part of those installed-device checks. No
automatable P8–P10 implementation work remains.

## Handoff update contract

At the end of each material task, replace stale information above and append a
short entry below. Keep entries factual and compact; Git history owns the full
chronology. **Keep at most the last 5 entries here** — when adding a sixth,
move the oldest into `docs/handoffs/<year-month>.md` (create it if missing).
Every entry must include:

- date and agent (`Codex` or `Claude`);
- branch and the pre-change/base commit (the resulting HEAD comes from Git);
- outcome and why;
- files or subsystems changed;
- checks actually run and their results;
- commit/push/web/OTA/native-build state;
- remaining work, risks, or decisions needed.

Never mark another agent's work confirmed without independently inspecting the
diff and running checks proportionate to the change.

## Recent handoffs

Older entries are archived verbatim in `docs/handoffs/` (currently
`2026-07.md`); only the newest entries live here.

### 2026-07-18 — Codex (audit follow-up P8–P10: simplicity, UX and reliability)

- Base `6b85f1c`; implementation branch `agent/audit-followup-polish`, protected
  PR #32, squash main release `a249492`; this record branch starts there.
- Re-read the complete independent audit and appended §12 with all 19 sections,
  every finding state, the 12-item user feedback matrix, explicit confidence and
  a non-inflated 90/100 score. Tracker P8–P10 is the current ID/status record.
- Removed the end-user diagnostics route, global sync-health badge/model,
  unused outbox hook and gradient dependency. Source+test code shrank net 198
  lines while retaining the bounded redacted internal breadcrumb boundary.
- Reworked shared hero/button/field/chip/toggle/segmented states; fixed upcoming
  action wrapping, Analytics source→period behavior and Investment language;
  added shared calendar-safe “Ayın sonu” entry and historical opening-balance UX.
- Stabilized the single Harem socket with lifecycle grace/backoff and verified
  all five live quotes plus hard reload in real Chromium. Active authenticated
  sessions now pull immediately on foreground/resume and every 30 seconds;
  dead-letter completion is account-scoped and cannot appear healthy.
- Native finance privacy starts only after auth so password-manager Face ID can
  fill sign-in. All stack forms use deterministic 44pt back controls, card
  presentation and enabled gestures; direct-link navigation passed in browser.
- Checks: clean diff; typecheck; 48 files/289 tests; zero-warning lint; 52-route
  export; web budget; Expo dependency check; 9/9 Playwright; 21 inspected visual
  baselines; linked migrations 1–7 equal and lint 0; remote pgTAP 24/24 retained;
  PR required run `29652848214` passed. Live Harem feed was verified; the in-app
  browser connector returned no browser, so headless Chromium was used.
- Web main run `29653031390` and live probes are recorded in the tracker. EAS
  `preview` group `1d2ed181-0dcd-48be-abae-3985d414854b`, runtime `1.0.0`
  (iOS `019f762b-ff84-7dcf-a1b7-e05b9a09827f`, Android
  `019f762b-ff84-7142-816f-c9b93cd7d2c3`) published from `a249492`. Installed
  delivery, two-client sync, Face ID/edge-swipe, screen readers/Dynamic Type,
  OS privacy/notification and low-memory stress remain explicitly `BLOCKED`.

### 2026-07-18 — Codex (SDK 54 dependency-policy closure)

- Base `be95258`; policy PR #23 released as `66c77bf`; SHA-pinned
  `actions/upload-artifact` v7 PR #24 released as `ec2c0d3`; dependency-policy
  PR #29 released as `8164caa`; final record branch starts from that commit.
- Closed Dependabot PRs #5–#8, #21, #25–#28 and #30 because they crossed the Expo
  SDK 54 React/React Native/Babel/lint compatibility boundary or attempted an
  unplanned TypeScript major; the npm PRs also generated lockfiles that failed
  `npm ci`. Compatible ESLint 9.39.5 was applied manually with a minimal valid
  lockfile. The coordinated upgrade remains `BACKLOG-SDK-01`, not silently
  abandoned work.
- Dependabot ignores routine SDK-managed version updates at every SemVer level,
  including React Native's pre-1.0 line, and guards routine ESLint versions plus
  TypeScript majors.
  Security updates and independent package updates remain eligible. Compatible
  `lucide-react-native` 1.25.0 was applied separately with a clean lockfile.
- Changed `.github/dependabot.yml`, package manifests,
  `tests/release-config.test.ts`, `docs/AUDIT_TRACKER.md`, `docs/AI_HANDOFF.md`
  and `AGENTS.md`.
- Checks: Dependabot YAML parsed; clean `npm ci`; Expo dependency check;
  Expo Doctor 18/18; diff check; typecheck; 49 files/287 tests; zero-warning
  lint; 53-route export; bundle budget; and 7/7 Playwright passed. Delivery
  used protected PR run `29647921636`; final `main` quality→Pages run
  `29648089748` passed and live root/settings returned 200. Lucide changed app
  JavaScript, so EAS `preview` group
  `885cbc8e-47b3-4bfb-bc31-389379d1a76f` was published from `8164caa`, runtime
  `1.0.0` (iOS `019f75a5-d221-797b-a673-13b5aac1c79d`, Android
  `019f75a5-d221-7b85-92d9-dff47f02577a`). The final record/ESLint lockfile
  follow-up changes no app/native bytes, so it requires Pages only and no
  additional OTA or native rebuild.
- No implementation work remains. Five intentional backlog and five
  installed-device/two-client acceptance rows remain explicitly tracked.

### 2026-07-18 — Codex (audit remediation package 7: automation and closure)

- Base `9e31eaa`; implementation branch `agent/p7-tests-docs`, protected PR
  #20, squash release commit `14547c8`.
- Added release-blocking browser SQLite coverage for onboarding, transaction
  add/edit/delete/undo, backup clean-context restore, relational invalid zero
  write, offline cold relaunch and deterministic deep links. Axe covers six
  primary routes; 13 versioned baselines cover 320/390/768/1440 light/dark and
  all five tabs. Ubuntu's measured 2–3% glyph-only rasterization delta has a 4%
  CI ceiling while macOS remains at 1%.
- Fixed web picked-file reading, local-only backup owner validation, decorative
  image/spinner/checked-state semantics, readable active-tab color and 320px
  full tab labels. Pages dynamic fallback now uses the root shell without React
  hydration #418. Supabase client moved to 2.110.7; SheetJS 0.20.3 remains the
  current official CDN tarball.
- README is task-first with real product screenshots and a user-facing flow;
  `TESTING.md`, `PRIVACY.md` and `RELEASE.md` now state the executable quality,
  privacy, environment, rollback and device-acceptance contracts.
- Checks: local typecheck; 49 files/286 tests; zero-warning lint; 53-route
  export; bundle budget; 7/7 Playwright. PR run `29646126353` and main
  quality→Pages run `29646280246` passed. Live root/upcoming/settings/
  diagnostics returned 200; the dynamic month URL served the expected root
  `404.html` shell. Browser discovery returned `[]`, so no live visual claim.
- EAS `preview` group `105fffc1-1ea0-4db7-bed8-ec5bc03ca930`, runtime `1.0.0`
  (iOS `019f7573-3f9e-7b34-b594-a5d55164c5bd`, Android
  `019f7573-3f9e-7d5f-ae18-ee8a9d4dc999`) published from `14547c8`. Initial
  insights showed zero installs/failures on both platforms. Dependabot PRs
  #5–#8 and mixed SDK-stack PR #21 were closed under `BACKLOG-SDK-01`; npm
  version updates now ignore SDK-managed minor/major jumps while security
  updates remain eligible. All automatable audit work is closed; five
  intentional backlog and five device/client-blocked acceptance rows remain
  explicitly tracked.

### 2026-07-18 — Codex (audit remediation package 6: product and IA)

- Base `3a59927`; implementation branch `agent/p6-product-ia`, protected PR
  #18, squash release commit `40c0fea`.
- Onboarding now defaults to a one-action quick start with optional balance and
  progressively disclosed advanced/import paths. Dashboard removed duplicate
  analysis; account freeze moved under Security; backup/export/restore is a
  distinct task group. Shell sync health stays quiet unless a real error or an
  outbox item has waited at least five minutes.
- Analytics gained bounded transaction search by text, period, type, category
  and payment source. A unified upcoming timeline combines subscriptions,
  recurring income, future transactions and credit-card statements with
  month groups, source drill-down and explicit stale/offline states.
- Added synced category budgets and monthly/weekly/biweekly income cadence.
  Linked migration 7 is live; local/remote versions 1–7 match, linked lint has
  zero errors and 24/24 pgTAP assertions passed in one rollback transaction.
- Checks: typecheck; 48 files/281 tests; zero-warning lint; 53-route export;
  bundle budget and diff check. PR run `29643400089` and main Pages run
  `29643476129` passed; live root/upcoming/budgets/analytics returned 200.
- EAS `preview` group `ea6a17fd-610c-4370-8ce7-91cbb753bcb4`, runtime `1.0.0`
  (iOS `019f751c-90ad-7ff5-82d3-fb4bbcdc34e3`, Android
  `019f751c-90ad-7fd6-932d-7fcac54ae74b`) published from `40c0fea`. Installed
  delivery remains unverified; P7 owns permanent E2E/SQLite/device matrices,
  README/privacy/release documentation and final tracker closure.

### 2026-07-18 — Codex (audit remediation package 5: UI, a11y and privacy)

- Base `627c297`; implementation branch `agent/p5-ui-a11y-privacy`, protected
  PR #16, squash release commit `e04fc39`.
- Shared controls now expose persistent labels, role/state/hint, announced
  errors/loading, heading focus/return for custom modals and full chart/table
  summaries. Accent fills are separate from AA foreground roles; light/dark
  contrast and no-truncation contracts are automated.
- Cash-flow keeps every feature visible at 320px with a full-width primary CTA
  and bounded tool row; payment actions stack below copy on narrow phones.
  Critical forms share a real-snapshot dirty-exit guard without prompting for
  untouched inline editors or async defaults.
- Lock-screen copy is neutral by default, financial detail requires explicit
  device-local consent, pending previews clear fail-closed, and the queue keeps
  the soonest 60. Native inactive/background and framed web states render an
  isolated sensitive-data-safe privacy modal.
- Checks: typecheck; 43 files/268 tests; zero-warning lint; 50-route export;
  bundle budget and diff check. PR run `29642256028` and main Pages run
  `29642316030` passed; live root/settings returned 200.
- Browser discovery returned `[]`; Xcode had no simulator destination and the
  physical phone was offline, so no viewport, VoiceOver/TalkBack or app-switcher
  timing claim is made. No EAS simulator session/build was started.
- EAS `preview` group `6eaac67f-9986-426a-ba39-951a49dc5489`, runtime `1.0.0`
  (iOS `019f74f5-c06d-768a-8985-5cd724369654`, Android
  `019f74f5-c06d-7c15-b3fd-55e183817336`) published from `e04fc39`. Immediate
  insights were zero installs/users/failures. P6 owns onboarding/product/IA;
  P7 owns persistent component/E2E/screenshot/device acceptance.
