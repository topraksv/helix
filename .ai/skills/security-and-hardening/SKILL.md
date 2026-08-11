---
name: security-and-hardening
description: Reviews Helix auth, RLS, storage, sync, imports, logging, privacy, CI, and release trust boundaries. Use when a task changes security-sensitive code or requires threat modeling, hardening, or fail-closed behavior.
---

# Security and hardening

## Procedure

1. Read the relevant `.ai/INVARIANTS.md` section, source boundary, schema/RLS
   policy and current test. Identify attacker-controlled input, authenticated
   identity, account owner and trusted server decision.
2. Validate at the runtime boundary, fail closed on malformed/foreign/stale
   data, and keep secrets, tokens, payloads and financial values out of logs.
   Client checks never replace Supabase authorization.
3. Trace both success and failure paths through local storage, sync, restore,
   diagnostics, redirects and CI/release. Check account switching and late
   responses explicitly.
4. Add a regression test or structural gate for the threat. Run the relevant
   security, database, dependency, browser or full verification check.

## Acceptance

The threat boundary, owner decision, fail-closed behavior and test/command
evidence are recorded. Any unavailable DAST/MASVS, linked-service or physical
device check remains marked as such.
