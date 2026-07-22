# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-22, Europe/Istanbul

- Package 2B is complete on `package-2-security-hardening`, continuing from the
  signed Package 2A checkpoint `83df44868c7d8f9a5e52f70437e0ae2ca8536141`.
- Two reachable moderate availability defects in user-controlled workbook
  comments were fixed: malformed section banners and installment tails could
  trigger super-linear regexp backtracking. Both paths now use linear scans and
  have adversarial mutation tests.
- Clean-install reproducibility was restored by nesting optional WASM fallback
  closures below their optional binding parents in `package-lock.json`. Node 22
  `npm ci` preserves package/lock hashes and `npm ls --all` reports no problems.
- Supply-chain CI now denies `GITHUB_TOKEN` to keepalive, uses a verified
  full-SHA CodeQL v4.37.3 pin and reviews every PR dependency scope at moderate+
  severity with a read-only, full-SHA-pinned Dependency Review job.
- Local SonarQube Quality Gate passed with 88.2% new-code coverage, 0 new
  violations, 0 new duplication, and 0 open bugs/vulnerabilities/hotspots after
  evidence-backed false-positive disposition. Semgrep found 0 issues. OSV,
  npm audit and Trivy collapse to one not-reachable dev-only esbuild advisory;
  the two SheetJS matches are vendor-proven false positives for CDN 0.20.3.
- Redacted Gitleaks worktree/all-history scans found 0 real secrets. Trivy found
  0 secrets and 0 applicable misconfigurations. No credential rotation is
  required and no Package 2B item is externally blocked.
- The owner-authored SSH-signed code checkpoint is `cf9e810b672898b1764b0119d55998fb94c4ab83`.
  CodeQL workflow run `29910737530` passed on that exact SHA with 0 open branch
  alerts.
- Final gates passed with Node 22: clean install/dependency tree, `npm run
  verify` (63 Vitest files / 477 tests, typecheck, zero-warning lint), Expo
  Doctor 18/18, 52-route production export within every bundle budget,
  Playwright 21/21, actionlint and `git diff --check`.
- Package 2B did not open a PR, merge, deploy Pages, publish OTA or create a
  native build. The detailed `.codex/package-2-ledger.md` remains intentionally
  untracked.

## Rollback evidence

- Last code-bearing release commit: `408c098`; successful Pages run
  `29871029794`. Later Package 1 handoff/test sync Pages run `29873521094` also
  passed.
- Last preview OTA group:
  `40d1d11d-1d30-4d93-91c4-670df321b198`; Android update
  `019f86bd-0c1f-76c5-b5c4-121b5d03f396`, iOS update
  `019f86bd-0c1f-70d3-8142-6f2284e10bb2`, runtime `1.0.0`.
- Supabase migration 12 is linked and additive. Do not remove its column/function
  behavior while a Package 2A client can sync; use a forward corrective
  migration if a defect is found.

## Next package

Run Package 2C from the latest signed checkpoint without repeating Package 2A or 2B.
