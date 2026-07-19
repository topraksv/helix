# Helix AI handoff

Compact continuity record for Codex and Claude. Git/current files override this
note; durable rules live in `AGENTS.md`. Git history owns the complete
chronology — entries older than the last five are simply dropped.

## Current state

- Updated: 2026-07-19 (Europe/Istanbul)
- Work: Claude's evidence-driven architecture/security/UI audit from base
  `eeed2c5`, on branch `audit/security-ux-finalization` (PR #42, OPEN — not
  merged, no Pages deploy, no OTA, no Supabase change).
- Packages: (1) shared-primitive text contrast — the undo snackbar's "Geri Al"
  label used `palette.primaryText` on the inverted `palette.text` surface
  (1.27:1 light / 1.10:1 dark, effectively invisible; regression from PR #16
  which swapped `primary` → `primaryText`), and `InitialsBadge` drew white on a
  raw `hsl(h,42%,46%)` fill that failed AA on 185/360 hues (worst 2.56:1). Both
  are now locked by `tests/theme-contrast.test.ts`; the badge hue moved to the
  pure `src/ui/badge-color.ts`, which caps relative luminance instead of
  lightness so only the bright half of the wheel changes. (2) `upsertSubscription`
  re-stamped `canceled_at` on every save of an already-inactive rule; it now
  preserves the original date. (3) 40 provably unreferenced `tr.*` keys removed
  (`tr.sources[…]`/`tr.incomeKinds[…]` dynamic access verified and kept).
- Follow-up verification pass (same working tree): all four `canceled_at`
  transitions are now pinned (active→cancel, edit-while-cancelled,
  reactivate→clears, second cancel→fresh date), both semantics mutation-checked.
  `badge-color.ts` moved `src/domain/` → `src/ui/` (a generated design colour is
  presentation, not business logic). New P0 fix: the CSV export cell sanitizer
  missed a leading carriage return, whitespace-hidden formulas and bare `\r`
  row forgery, and its own normalisation destroyed legitimate data
  (`Yemek; İçecek` collapsed to `Yemek  İçecek`). `csvCell` now uses RFC 4180
  quoting and lives in the pure `backup-validation.ts` (the old
  home imports React Native, so the security boundary could not be unit-tested
  at all) and is covered by `tests/csv-export-safety.test.ts`. E2E now measures
  the PAINTED contrast of the undo action (`renderedContrastRatio`) — the role
  query passed at 1.27:1 before.
- GitHub security, read-only via `gh` on 2026-07-19. No alert was dismissed
  (no permission) and no dependency was bumped. Risk classification, not a
  clean bill of health — "no reachable path demonstrated" is the honest ceiling
  of a static review:
  - `uuid` GHSA-w5hq-g745-h8pq (alert 3): **version mismatch**. The advisory
    range is `>=12.0.0 <12.0.1`; the lockfile resolves exactly one `uuid` at
    `7.0.3` (expo → @expo/config-plugins → xcode). Nothing to remediate here.
  - `postcss` GHSA-qx2v-qp2m-jg93 (alert 2): **advisory applies** to the
    resolved `8.4.49` (via `@expo/metro-config@54.0.17`). No reachable path was
    demonstrated: the string does not appear in any shipped `dist/` bundle and
    the only CSS it processes is first-party. Compensating condition: it runs
    at build time on developer/CI machines, not on user devices. Upstream
    resolution is owned by the Expo SDK pin → `BACKLOG-SDK-01`. Accepted risk.
  - `esbuild` GHSA-67mh-4wv8-2f99 (alert 1): **advisory applies** to `0.18.20`,
    reached only through drizzle-kit's deprecated `@esbuild-kit` chain (dev
    scope). No reachable path was demonstrated: the advisory needs an `esbuild
    serve` dev server, which nothing in this repo starts. `drizzle-kit@0.31.10`
    is already the newest published release and still declares that chain, so
    there is no upstream fix to take; an `overrides` jump from 0.18 to 0.25
    inside a loader we do not control was judged disproportionate. Accepted
    risk, revisit when drizzle-kit drops `@esbuild-kit`.
  - Code scanning: had NO analysis at all (HTTP 404). A minimal SHA-pinned
    `codeql.yml` now runs `security-extended` for javascript-typescript,
    deliberately OUTSIDE the required `quality` check so an advisory finding
    can never block the Pages deploy.
  - Secret scanning: the repository setting is ENABLED, with push protection
    also enabled (`security_and_analysis`); an older audit note claiming it
    was off is stale. This token lacks the scope to read the alert LIST, so
    the real list was NOT inspected. The local substitute — 204 commits of
    history plus the tracked tree scanned for provider key prefixes, JWTs,
    private-key headers and secret-bearing filenames — found only prose in
    `docs/RELEASE.md` describing the policy, and no ignored-secret file was
    ever committed. That is NOT equivalent to reading GitHub's list.
- Route-by-route UX audit: 26 reachable routes × {390, 1440} px × {light,
  dark}, on a populated workspace. Found and fixed `aria-prohibited-attr` on
  matrix cells (13 nodes), `aria-required-attr` on both reorder grips (18
  nodes, now the shared `ReorderGrip`), a 2.86:1 heading under a faded
  container, a keyboard-unreachable horizontal scroller, two 18px icon targets
  and 16px-tall matrix column headers (WCAG 2.2 SC 2.5.8, which axe's 2.1
  rules do not cover). It also caught a real crash: `/cell-editor` opened
  without params threw on `lastDayOf(month!)`. The sweep is now a permanent
  test (~11 s). No committed visual baseline moved.
- Measured performance (static export, localhost): boot-to-interactive 329 ms,
  FCP 68 ms, domInteractive 31 ms; client-side tab switch median 40 ms / p95
  55 ms over 60 switches; JS heap 45.2 MB before and 45.2 MB after those 60
  switches (delta 0.0 MB — empirical confirmation of the listener/timer/epoch
  cleanup audit). No bottleneck was demonstrated, so FlashList, Zustand/signals
  migration, TanStack Query/SWR and blanket memoisation stay rejected.
- Supabase live logs and pgTAP remain UNVERIFIED: no `supabase` CLI on PATH,
  Docker not running, no configured MCP. To enable read-only verification next
  session: install the CLI, `supabase login`, `supabase link --project-ref
  <ref>`, then `supabase migration list --linked`, `supabase db lint --linked`
  and the pgTAP suite in `supabase/tests/`. Nothing here may be run without
  explicit authorisation — it touches the live project.
- Deliberately NOT changed, with evidence: brand/utility chip monograms in
  `src/ui/logo.tsx` (45/87 fail AA, but those are fixed brand colours under
  WCAG's logotype exemption and the subscription name always renders beside
  them); Error Boundaries (already present at the root Stack with a real reset
  path); FlashList (the FlatList migration from PR #37 is measured and
  adequate); SWR/TanStack Query (would add a second source of truth beside the
  local-first SQLite live-query + outbox model).
- Previous release context: nine-package user audit (PR #36 `e69f386`, PR #37
  `e66eeb3`, PR #38 `3e30b1c`) and follow-up PR #40 as main `3a04ff3`
  (converter last-known-rate contract, frameless logo system + `*.gstatic.com`
  CSP fix, uniform dark README screenshots).
- Outcome highlights: logout→login no longer flashes onboarding (grace waits
  for the post-sync onboarded re-read); verifyPassword recovers the e-mail
  after offline bootstrap instead of "Supabase yapılandırılmadı"; semantic
  palette is green income / red expense / amber warning with a hue-contract
  test (purple banned); markets keep a device-local snapshot + dated FX
  fallback (no "—" placeholders) and the converter refreshes stale rates on
  focus; cash-flow phone tools gained captions; subscriptions/incomes share
  the new RuleRow; category deletion cascades to budgets atomically (hook
  inner-joins live categories, maintenance cleans provable orphans only);
  inert operationId layer removed; month detail/cell editor/analysis search
  are real FlatLists (1.200-row scenario: ~160 ms open, ~116 mounted rows);
  README rebuilt with real data screenshots; tsconfig excludes build output.
  Follow-up: converter now mirrors the markets card (live silently, last-known
  quote with a time badge, FX cache only when strictly newer); ~65 new brand
  favicon domains and one shared frameless logo tile; web CSP allows the
  gstatic favicon redirect (logos actually render on web now); README
  screenshots regenerated as a uniform dark set from a 105-row multi-month
  demo restore.
- Verification (this audit, run locally on the working tree): strict typecheck
  clean; Vitest 48 test files / 310 tests (was 47 / 296); Playwright 3 spec
  files / 11 cases (was 10) over 20 committed visual baselines, all UNCHANGED;
  zero-warning Expo lint; production `expo export` inside every bundle budget.
  `tests/helpers.ts` and `e2e/helpers.ts` are helper-only and are not counted
  as test files. Both contrast fixes and the
  `canceled_at` fix were mutation-checked: reverting each makes its new test
  fail. Not verified here: physical iOS/Android device behaviour, VoiceOver /
  TalkBack, and remote Supabase state (no migration touched).
- Prior release verification: strict typecheck; 47 files/296 Vitest; zero-warning Expo lint;
  production export within all bundle budgets; 10/10 Playwright incl. axe and
  visual baselines (one cash-flow baseline intentionally regenerated for the
  captioned toolbar); 1.200-transaction virtualization measured on the static
  export. PR #40 quality run `29675449818` and post-merge main quality/Pages
  run `29676044301` passed. SDK 54 advisories remain `BACKLOG-SDK-01`.
- Release: PR #36 quality + main Pages run `29658175041` (live 200) and OTA
  group `f82de4f5-2e28-468d-9ec8-0ad3f06db24d`; PR #37 quality + OTA group
  `d3461e52-9dfd-436a-8bcd-051d7543e879` (commit `e66eeb3`), Pages run
  `29666823091`; PR #38 quality + OTA group
  `04d8e501-abdb-4632-9317-d2fa5df7a6b4` (commit `3e30b1c`), Pages run
  `29674652426`; PR #40 main `3a04ff3`, Pages run `29676044301` (root,
  calculator and subscriptions deep links live 200), OTA group
  `a20c30f9-3388-4a6f-8fb6-accb57e62ba5`. Runtime `1.0.0`, channel/branch
  `preview`, iOS+Android; no native config changed. Fresh OTA insights are 0
  installs/0 failures; installed delivery remains unverified until a device
  checks for the update.

## Stable system and open limits

Expo SDK 54 runs on Node 22. SQLite is async/local-first; writes use atomically
paired outbox rows and Supabase owner-only RLS. Money is integer minor units,
dates are ISO, UI text is centralized in `tr.ts`, and routes consume the stable
`repo.ts` facade. Read `AGENTS.md` before code changes.

Intentionally deferred: SDK/toolchain upgrade, unproven technology rewrites,
calculator relocation, bank/server-push/widget/multi-user expansion and
enterprise patterns. Installed-device/two-client acceptance is still required
for late account switching, remote outbox drain, Face ID, iOS edge-swipe,
VoiceOver/TalkBack/Dynamic Type, OS notification/privacy and low-memory import.

## Update contract

At task end update current branch/base, outcome, changed areas, checks,
commit/push/web/OTA/native state and remaining risks. Keep only five recent
entries; delete the oldest when adding a sixth. Never call previous work
verified without inspecting its diff and running proportional checks.

## Recent handoffs

### 2026-07-19 — Codex · PR #40 release completion

- Independently inspected PR #40 at head `165653d`, confirmed `tr.tx.staleRate`
  remains used by the transaction form, and verified its required quality gate
  before squash-merging to main `3a04ff3`.
- Post-merge run `29676044301` passed typecheck, 296 Vitest, lint, export,
  bundle budgets and 10 Playwright flows, then deployed Pages. Live root,
  calculator and subscriptions deep links returned 200; live CSP contains the
  required `*.gstatic.com` favicon redirect allowance.
- Published EAS preview update `a20c30f9-3388-4a6f-8fb6-accb57e62ba5` for
  iOS+Android, runtime `1.0.0`, from exact commit `3a04ff3`. No native rebuild
  is required. Initial insights are 0 installs/0 failures; physical-device
  uptake remains the only release acceptance item not observed here.

### 2026-07-19 — Claude · Nine-package user audit (P1–P9)

- Base `7f2e133`; PR #36 → main `e69f386` (Pages `29658175041`, OTA
  `f82de4f5`); PR #37 → main `e66eeb3` (Pages `29666823091`, OTA
  `d3461e52`); PR #38 → main `3e30b1c` (Pages `29674652426`, OTA
  `04d8e501`).
- Auth flash/error mapping, semantic palette contract, markets snapshot +
  converter focus refresh, captioned cash-flow tools, shared RuleRow,
  budget cascade on category delete, operationId removal, FlatList
  virtualization, README/tsconfig/docs cleanup.
- Full local gates + protected PR quality passed; 1.200-row virtualization
  measured on the static export. Physical native acceptance still open.

### 2026-07-18 — Codex · P11 simplicity and UI regression

- Base `5c2304b`; implementation PR #34; main `93e12ab`; Pages run
  `29655797800`; EAS group `5abb5e1b-f99a-47da-9e63-ceeab5a864de`.
- Removed dead API/dependency/assets and duplicate chart/header logic; exact
  Claude palette and quieter shared controls; corrected back/tab routing,
  forecast visibility and Summary charts.
- Local, protected PR and main gates passed; live routes and EAS commit/runtime/
  platform metadata match. Physical native acceptance remains outstanding.

### 2026-07-18 — Codex · P8–P10 follow-up

- Base `6b85f1c`; PR #32; main `a249492`; Pages run `29653031390`; EAS group
  `1d2ed181-0dcd-48be-abae-3985d414854b`.
- Removed user diagnostics/global health UI; fixed payment/Analytics/month-end,
  Harem lifecycle, sync polling, back/auth privacy; audit §12 and tracker added.
- 48/289 tests, 9 Playwright, 21 baselines, linked migrations 1–7/lint/24 pgTAP
  passed. Native/two-client checks remained blocked.

### 2026-07-18 — Codex · SDK 54 dependency policy

- PRs #23/#24/#29; final main `8164caa`; Pages run `29648089748`; EAS group
  `885cbc8e-47b3-4bfb-bc31-389379d1a76f`.
- Rejected incompatible Dependabot SDK-stack/invalid-lockfile changes; kept
  security updates open; applied compatible ESLint and Lucide updates. SDK 57
  stayed in `BACKLOG-SDK-01`; full gates passed.
