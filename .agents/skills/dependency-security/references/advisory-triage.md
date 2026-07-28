# Advisory triage

## Evidence to collect

- primary advisory identifier and affected/fixed ranges;
- resolved package version and every dependency path;
- runtime, development, build, CI, or vendored-skill scope;
- vulnerable API and whether Helix-controlled or attacker-controlled input
  reaches it;
- published registry artifact, module format, install scripts, provenance or
  signatures when available;
- Expo SDK compatibility and native rebuild implications;
- smallest safe remedy and residual risk.

## Decision order

1. Remove unused code or dependency.
2. Upgrade within the current supported matrix.
3. Apply a narrow, tested override when the package graph allows it.
4. Isolate or disable the reachable feature.
5. Accept residual risk only with explicit reachability evidence, owner
   visibility, expiry/re-check condition, and a reason the prior options fail.

## Required checks

- inspect the lockfile delta rather than trusting the manifest;
- open the published tarball for CJS/ESM/export and install behavior;
- test the exact affected import or command;
- run `npm ci`, `npm run verify`, and a production export when shipped code can
  change;
- re-check the upstream disposition on the day it is reported.

`npm audit` does not cover Helix's CDN `xlsx` tarball. GitHub dependency review,
CodeQL, Dependabot, npm metadata, and vendored-skill hashes cover different
surfaces; no single green scanner closes the review.
