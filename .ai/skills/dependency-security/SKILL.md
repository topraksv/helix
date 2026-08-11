---
name: dependency-security
description: Reviews Helix dependencies, lockfiles, advisories, signatures, and workflow supply-chain changes. Use when package metadata, the lockfile, vendored code, CI actions, or an advisory is changed or questioned.
---

# Dependency security

## Procedure

1. Read `package.json`, the exact lockfile diff, Node/Expo constraints in
   `AGENTS.md`, and the relevant workflow. Do not trust package names or a
   generic audit summary.
2. Determine the published tarball/source, transitive path, installed version,
   and whether the dependency is runtime, build, test, or vendored material.
   Check the actual package manager output and current official advisory/source.
3. Run the repository caller (`node scripts/check-advisories.mjs`) and the
   relevant lockfile/signature checks exposed by CI. Do not invent an
   unconfigured lockfile or verification gate.
4. For an accepted advisory, record package, severity, no-fix evidence,
   affected path, expiry/revisit date, and why the proposed upgrade would
   violate the Expo-managed matrix or another invariant.

## Required evidence

The review includes exact package/lockfile paths, current version and source,
command output, and a compatibility decision against the installed Expo SDK
54 matrix. New production dependencies need a caller and a regression check.

## Acceptance

No unreviewed dependency or action enters the lockfile; accepted risk is named
and dated; high/critical findings block the change through the real repository
check. Never solve an advisory by silently weakening the gate.
