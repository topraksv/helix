# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Package 2D implementation and local closure are complete on
  `package-2-security-hardening`, continuing from signed checkpoint `3950e17`.
  The single Package 2 PR has not yet been opened or merged.
- Material reliability fixes make onboarding/import sorts explicit and route
  synchronous and asynchronous native haptic failures into one consumed promise
  boundary. Focused tests cover both haptic failure modes. The web release budget
  now rejects public `.map` files and JS/CSS `sourceMappingURL` references.
- Security/release/test contracts now contain the stable ASVS v5, current
  MASVS/MASTG, vulnerability intake, PII-free crash-health decision, source-map,
  OTA integrity, incident/rotation, backup/restore and exact residual-control
  classifications required for Package 2D.
- Clean Node 22 install and dependency-tree validation pass. The release suite
  passes 64 Vitest files / 480 tests and 21 Playwright tests, including visual
  and accessibility gates. Expo exports 52 routes; entry/total-JS/export/font
  budgets pass with 0 map files and 0 map references. Expo Doctor passes 18/18.
- SonarQube 26.7 Quality Gate passes with 316 open maintainability smells,
  17 fully grouped/dispositioned reliability impacts, and 0 open bug,
  vulnerability or hotspot. The two security false positives are a public
  `1Password` product/host alias and UI-only placeholder randomness; neither is
  a credential, persisted identifier or security decision.
- Semgrep reports 0 findings/0 parse errors; Trivy reports 0 vulnerability,
  misconfiguration or secret; TruffleHog reports 0 verified/unverified secret
  across 391 commits and the current candidate; Gitleaks reports 0 real secret
  (the public Supabase publishable key is expected). Production npm audit is 0.
  Full npm audit retains four moderate dev-only instances in the inaccessible
  `esbuild serve` path. OSV's same esbuild row and two SheetJS metadata false
  positives are dispositioned in `docs/SECURITY.md`. CycloneDX SBOM contains
  1,034 components; five lifecycle-script instances belong to two reviewed
  package families.
- Remote Supabase migrations `…01`–`…14` equal local, public-schema lint is
  clean and linked pgTAP passes 48/48. Security Advisor has three dispositioned
  records: service-only `keep_alive` RLS/no-policy, the intentionally scoped
  `delete_own_account` SECURITY DEFINER RPC and Free-plan HIBP. Performance
  Advisor has 24 INFO records: 18 composite-FK index suggestions and six retained
  unused-index observations.
- GitHub protection is still strict: owner signatures, linear protected PRs,
  admin enforcement, conversation resolution, force-push/deletion denial and
  required Actions `quality`. GitHub-owned, SHA-pinned Actions only; private
  vulnerability reporting, secret scanning, push protection and Dependabot
  security updates are enabled. Open CodeQL, Dependabot and secret alerts are 0.
  Dependency Review `review` must first report successfully on the Package 2 PR,
  then be added to the exact required checks before the final PR run and merge.

## External, plan and device limits

- Central crash/release-health telemetry is `BLOCKED_EXTERNAL`: no approved
  provider account, privacy/retention decision or credentials exist. The
  minimal PII-free Sentry rollout and alert thresholds are in `docs/RELEASE.md`.
- Supabase Free keeps HIBP, session timebox/inactivity/single-session, automatic
  backup/PITR and long log retention `PLAN_LIMITED`. No backup or isolated
  restore environment is claimed.
- Email confirmation, stronger coordinated password policy, custom SMTP,
  CAPTCHA, enforced MFA, direct-DB SSL maintenance and network restrictions are
  `BLOCKED_EXTERNAL`; none is silently enabled in this package.
- VoiceOver/TalkBack, Dynamic Type, Reduced Motion, app-switcher cover,
  lock-screen notifications, Keychain/biometric behavior, two installed clients,
  low-memory import and installed OTA cold starts remain `DEVICE_ONLY` and are
  not claimed as passed.

## Delivery decision and rollback evidence

- Package 2D changes no native config, Expo SDK/plugin or runtime policy. After
  merge, publish a `preview` OTA from clean final `main`. Production OTA remains
  blocked unless an installed compatible binary can complete the required first
  download + second cold-start acceptance flow; no native build is required by
  this package itself.
- Last code-bearing web release commit: `408c098`; successful Pages run
  `29871029794`. Later handoff/test sync run `29873521094` also passed.
- Last preview OTA group: `40d1d11d-1d30-4d93-91c4-670df321b198`; Android
  `019f86bd-0c1f-76c5-b5c4-121b5d03f396`, iOS
  `019f86bd-0c1f-70d3-8142-6f2284e10bb2`, runtime `1.0.0`.
- Migrations 13 and 14 are privilege/index-only. Database rollback remains a
  backward-compatible forward migration; never edit applied migration files.

## Next exact step

Remove temporary analysis state and the Package 2 ledger, create signed
owner-authored commits, push this existing branch, open the one Package 2 PR,
enforce successful Dependency Review, merge through protection, then complete
Pages/live smoke and preview OTA delivery from final `main`.
