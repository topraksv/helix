---
name: dependency-security
description: Reviews Helix dependency, lockfile, npm override, GitHub Action, vendored skill, and advisory changes for compatibility, provenance, exploitability, and supply-chain risk. Use before adding, upgrading, replacing, or removing executable third-party code and when triaging Dependabot, audit, CodeQL, or skill-integrity findings.
---

# Dependency Security

## Overview

Resolve dependency risk without breaking the Expo-managed matrix or hiding
residual risk. Published artifacts and the actual dependency graph are evidence;
package names, advisory headlines, and source branches are not.

Read `docs/SECURITY.md`, the dependency constraints in `AGENTS.md`, and
[references/advisory-triage.md](references/advisory-triage.md).

## Workflow

1. Identify the exact changed package, version, resolved artifact, dependency
   path, runtime/dev scope, and platform that consumes it.
2. Read the primary advisory, upstream release notes, package metadata, and
   published tarball or pinned Action commit. Check them now; old dispositions
   are snapshots.
3. Establish reachability: vulnerable symbol, input source, preconditions,
   shipped bundle or CI execution path, and impact.
4. Price the remedies in order: remove, upgrade within the supported matrix,
   narrow override, isolate, or document a time-bounded residual risk. Never
   suppress a finding merely to turn the gate green.
5. Test the exact artifact and module format. An upstream repository test does
   not prove the registry tarball or Expo resolution works.
6. Inspect lockfile deltas for unrelated packages, install scripts, registry or
   URL changes, integrity loss, and unexpected native/runtime additions.
7. Run `npm ci`, the focused compatibility proof, `npm run verify`, and release
   checks when bundle/native output changes.

## Vendored Skills and Automation

- Install from a reviewed repository and immutable commit when possible.
- Read every installed `SKILL.md`, script, executable, hook, tool dependency,
  and repository-external write instruction before trusting it.
- Reject missing local references, undeclared delegation, credential access,
  mutable runtime downloads, or instructions that conflict with Helix.
- Prefer a small Helix adapter over a broad upstream bundle whose unused
  domains expand context and attack surface.
- Keep `skills-lock.json` exact and let `npm run verify:skills` detect drift.
- GitHub Actions stay full-SHA pinned and least-privileged.

## Boundaries

Do not add a monitoring service, new dependency, override, audit exception,
GitHub app, or secret merely because a tool recommends it. Those are product or
release decisions and need explicit scope.
