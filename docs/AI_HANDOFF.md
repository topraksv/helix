# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Package 2C is complete on `package-2-security-hardening`, continuing from the
  signed Package 2B checkpoint. No PR, merge, Pages deployment, OTA update or
  native build was performed.
- GitHub now remotely enforces full-SHA Action references and permits only
  GitHub-owned Actions. Private vulnerability reporting is enabled, merge
  commits are disabled to match linear-history protection, and the
  `github-pages` environment denies admin bypass while retaining its exact
  `main` deployment policy.
- `main` still requires the strict GitHub Actions `quality` check, signed commits,
  PRs, stale-review dismissal, conversation resolution and admin enforcement;
  force-push and deletion remain denied. Dependency Review cannot be made a
  required check until its first PR run succeeds within GitHub's seven-day
  eligibility window. Package 2C explicitly prohibited opening that PR.
- CodeQL advanced setup covers JavaScript/TypeScript on PR, push, schedule and
  dispatch. Its latest Package 2C dispatch passed with zero open alerts. Secret
  scanning, push protection, Dependabot security updates and dependency graph
  are enabled; open CodeQL, Dependabot and secret alerts are zero.
- Supabase Auth now uses the production site URL and exact web/native password
  recovery redirects. Email auto-confirm, the six-character password minimum,
  lack of CAPTCHA/custom SMTP and non-enforced MFA remain rollout decisions;
  changing them before app/account migration could break current users.
- Remote migrations `…01`–`…14` match local. Migration 13 removes unintended
  authenticated `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` grants,
  removes direct client execution from internal trigger functions and makes
  future public objects fail closed. Migration 14 removes an exact duplicate
  statement index. Generated database types are unchanged.
- Remote public-schema lint reports no errors and linked pgTAP passes 48/48.
  All 17 public tables have RLS; the 16 synced tables have exactly 48 owner
  policies and only `SELECT/INSERT/UPDATE` client grants; `keep_alive` remains
  service-role only.
- Security Advisor remains three fully dispositioned records: service-only
  `keep_alive` has intentional RLS/no policy, `delete_own_account` is the scoped
  authenticated SECURITY DEFINER RPC, and leaked-password protection is Free
  plan-blocked. Performance Advisor fell from 25 to 24 INFO records after the
  duplicate index fix: 18 unindexed composite FKs and six measured/retained
  indexes remain, with rationale in `docs/RELEASE.md`.
- Storage has zero buckets, objects and policies; no tables are in a Realtime
  publication; Edge Functions, Cron, webhooks, Auth hooks and Vault secrets are
  unused. The project is `ACTIVE_HEALTHY`, PostgreSQL 17.6 with SSL available,
  database size about 35 MB and no observed deadlocks/checksum failures.
- Node 22 `npm run verify` passes: typecheck, zero-warning lint, 63 Vitest files
  and 477 tests. `actionlint`, `git diff --check`, remote lint, migration equality
  and linked pgTAP also pass.

## External and rollout blockers

- GitHub non-provider secret patterns and validity checks require an
  organization-owned Team/Enterprise repository with Secret Protection; this
  is a user-owned public repository. Dependency Review becomes required only
  after Package 2D opens the permitted PR and its `review` job first succeeds.
- Supabase Free blocks leaked-password protection, session timebox/inactivity,
  single-session enforcement, automatic backups, PITR, custom domains and log
  drains. No approved encrypted off-site backup target or isolated restore
  environment exists; do not claim restore capability.
- Email confirmation, an eight-or-more-character password policy, production
  SMTP/CAPTCHA and MFA enforcement need coordinated app/account rollout or
  external provider credentials. Do not flip them ahead of that rollout.
- Database SSL enforcement causes a short restart and needs a maintenance
  window plus direct-client TLS proof. Network restrictions need owner approval
  and stable maintainer/CI source ranges. Current unrestricted values were not
  changed.
- Billing-period MAU/egress cannot be reconstructed from the Free plan's short
  logs through the supported PAT API. Current database size and static service
  inventory are verified, but the owner Dashboard remains the billing-period
  source.

## Rollback evidence

- Last code-bearing release commit: `408c098`; successful Pages run
  `29871029794`. Later Package 1 handoff/test sync Pages run `29873521094` also
  passed.
- Last preview OTA group:
  `40d1d11d-1d30-4d93-91c4-670df321b198`; Android update
  `019f86bd-0c1f-76c5-b5c4-121b5d03f396`, iOS update
  `019f86bd-0c1f-70d3-8142-6f2284e10bb2`, runtime `1.0.0`.
- Migrations 13 and 14 are privilege/index-only and contain no data rewrite. If
  a regression appears, use a new forward migration; never edit applied files.

## Next package

Run Package 2D from the latest signed checkpoint without repeating Packages 1,
2A, 2B or 2C. Open the first permitted PR, let Dependency Review succeed, make
its unique `review` job required, then complete the protected release and remote
post-release verification.
