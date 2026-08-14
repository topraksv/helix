# Helix security model

This document defines the current trust boundaries, disclosure route, and
accepted residual risks. It is not an OWASP/ASVS/MASVS compliance claim.
User-visible data handling is described in [`PRIVACY.md`](PRIVACY.md); release
authority and recovery procedures are in [`RELEASE.md`](RELEASE.md).

## Reporting a vulnerability

Report security issues through
[GitHub private vulnerability reporting](https://github.com/topraksv/helix/security/advisories/new).
Do not include tokens, passwords, personal data, financial records, or backups
in a public issue. Helix has one maintainer and makes no fixed response-time
promise.

A reachable critical/high issue, or a reachable moderate issue without a
recorded disposition, blocks release. Scanner labels are leads: severity,
affected version, production reachability, and the proposed fix must be checked
before changing the dependency tree.

## Trust boundaries

| Boundary | Authority | Untrusted input |
|---|---|---|
| Device | OS sandbox and Keychain/SecureStore | forms, route params, imports |
| Client → Supabase | Postgres RLS using `auth.uid()` | client `user_id`, UI guards |
| External feeds | none | response host, size, shape, date, freshness |
| Delivery | the checked Git SHA and gated artifact | manual or rebuilt artifacts |

Client-side route guards and hidden controls are not authorization. Remote
authorization lives in owner-only RLS, owner-aware constraints, explicit table
grants, and narrowly scoped RPCs in `supabase/migrations/`.

## Authentication and local data

- Supabase Auth handles e-mail/password and PKCE recovery. Recovery callbacks
  accept only the exact web origin/base path or `helix://reset-password`.
- Native sessions use bounded, complete-read chunking over SecureStore. Web
  sessions use the browser profile's storage; browser-profile access therefore
  implies session access. `src/sync/secure-chunked-storage.ts` limits values to
  64 chunks of 1,900 characters, validates the marker, and rejects missing
  chunks and oversize values. Interrupted replacement of an already chunked
  value is not generation-tagged or checksummed and has no explicit
  crash-atomicity test: that is an open proof gap, not evidence that mixed data
  would be accepted downstream.
- Session epochs stop late account-scoped work before account switch, sign-out,
  or deletion can expose it to another account.
- Financial data is in async SQLite. iOS builds request
  `NSFileProtectionComplete`; this is OS file protection, not SQLCipher, and is
  not a verified hardware guarantee until tested on that build.
- Android backup is disabled in `app.json`. JSON and CSV exports remain clear
  text and must be protected after they leave the app.
- Production diagnostics buffer the last 12 redacted events on-device and, after
  a successful authenticated sync, upload new events to the owner's
  `diagnostic_events` rows. The upload contains account id, occurrence time,
  internal scope, severity, fixed error code, platform, and app version—never a
  message, stack, e-mail, financial value, note, row payload, or device id. RLS
  is owner-only; client rows are append-only and expire with account deletion.

The six controls most likely to look redundant during cleanup—session epoch,
`tombstone_version`, verification brake, account freeze, chunked SecureStore,
and the install-script allowlist—are indexed with their rationale and authority
in [`ARCHITECTURE.md`](ARCHITECTURE.md#security-controls-that-must-survive-simplification).

## Input, network, and privacy defenses

- Restore validates ownership, ids, duplicates, references, and the whole plan
  before the first write. Spreadsheet/JSON paths impose pre-read, streamed, ZIP,
  row, cell, text, and expanded-size bounds.
- CSV cells neutralize spreadsheet formulas. Route params are validated before
  date or query helpers.
- External requests use fixed or strictly validated public hosts, TLS/WSS,
  timeout/abort, response-size, shape, and date/freshness checks.
- Web CSP is generated in `src/app/+html.tsx`. Public exports reject source maps
  and source-map references. The static bootstrap currently requires
  `script-src 'unsafe-inline'`; narrow `connect-src`, `object-src 'none'`, and
  `form-action 'self'` reduce that accepted risk.
- Notification permission is requested only from Settings. Lock-screen detail
  is opt-in and account cleanup clears scheduled and delivered detail.
- App-switcher masking and OS-owned biometric/notification behavior remain
  device acceptance items, not browser-test claims.

## Supply chain

- GitHub Actions use full commit SHAs. Checkout credentials are removed before
  dependency or build code runs.
- `package-lock.json` is authoritative. `tests/install-scripts.test.ts` fails if
  a new package family begins executing an install hook.
- Skills are executable supply-chain input: upstream bodies are committed
  unmodified, their source/hash is locked in `skills-lock.json`, and
  `npm run control:check` verifies the canonical copy and Claude symlink. It
  does not review skill semantics; changes still require human diff review.
- `xlsx` comes from the SheetJS CDN, outside npm advisory matching. Its upstream
  advisories must be checked manually when import code or the tarball changes.

## Accepted and external residual risks

| Risk | Status and boundary |
|---|---|
| Web `script-src 'unsafe-inline'` | Accepted for Expo's static bootstrap; outbound CSP remains narrow |
| Browser session storage | Accepted; browser-profile access is session access |
| No application-level database encryption | Accepted; OS sandbox/file protection is the stated control |
| No third-party crash or automatic release-health alerting | Redacted first-party events exist, but silent failures do not alert the maintainer |
| No additional EAS code-signing key | Accepted for the current Expo Go preview model; the EAS account is the trust boundary |
| No production store build or physical-device acceptance | Release claim is limited to web/preview artifacts |
| Supabase leaked-password check, session timebox, PITR, and long log retention | Plan-limited; do not claim they are enabled |
| SMTP, CAPTCHA, mandatory MFA, DB network restriction | Blocked on an owner/provider/rollout decision, not silently added |

Current lockfile exceptions that must be re-evaluated when their version, path,
or deadline changes:

- `esbuild` under `drizzle-kit` is a development-server advisory. The affected
  server is not run; npm's proposed fix is a breaking Drizzle Kit downgrade.
- `image-size@1.2.1` is reachable only through the Metro build chain, not the
  exported application bundle. Moving to 2.x broke Expo asset handling in the
  measured attempt. This temporary acceptance expires **2026-09-08** and must
  be re-proved or removed then.
- `xlsx@0.20.3` is newer than the vendor-fixed versions for the two legacy
  SheetJS advisories, although npm/OSV can continue to flag the abandoned npm
  version range because releases moved to the vendor CDN.

## Executable evidence

The durable evidence is in tests rather than frozen counts:

- auth/session/recovery: `tests/auth.test.ts`, `tests/session-epoch.test.ts`,
  `tests/session-task.test.ts`, `tests/verification-brake.test.ts`;
- storage/privacy: `tests/secure-chunked-storage.test.ts`,
  `tests/privacy.test.ts`, `tests/diagnostics.test.ts`,
  `tests/diagnostics-upload.test.ts`;
- sync/ownership: `tests/sync-merge.test.ts`,
  `tests/tombstone-generation.test.ts`, and
  `supabase/tests/owner_integrity_and_rls.sql`;
- hostile input/network: `tests/backup-validation.test.ts`,
  `tests/spreadsheet-import.test.ts`, `tests/csv-export-safety.test.ts`,
  `tests/external-services.test.ts`;
- release surface: `tests/release-config.test.ts`,
  `tests/web-security.test.ts`, and the pinned workflows.

Fresh command and scanner output belongs in the CI run or task handoff, not in
this file.
