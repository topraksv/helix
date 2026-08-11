---
name: expo-data-fetching
description: Implements or diagnoses Helix network requests, sync reads, caching, cancellation, and offline state. Use when a task adds or changes fetch/API behavior, remote data, retries, or data-loading state in the Expo SDK 54 app.
---

# Data fetching

## Procedure

1. Read `.ai/INVARIANTS.md`, the existing service/hook caller and the current
   installed packages. Do not add React Query, SWR, server loaders, or another
   data library unless the repository has a deliberate dependency change.
2. Define the state machine: loading, ready, refreshing, stale and error.
   Never use an initial empty array/null as proof of an empty account.
3. Bound the request with the session abort signal, timeout, response size and
   runtime shape validation. Treat provider data as untrusted and preserve
   user/account ownership at the repository boundary.
4. Decide cache scope, freshness, retry and offline behavior explicitly. A late
   response must be ignored after account/session change.
5. Add a regression test for cancellation, malformed/oversized data, stale
   state, or account isolation as applicable; run the relevant verify gate.

## Required evidence

Show the caller, state transitions, abort/timeout path, runtime validator,
cache scope and test output. Current official Expo/SDK 54 documentation outranks
any stale reference that describes a newer loader API.

## Acceptance

The request is bounded and session-safe, the UI distinguishes unresolved from
empty/error data, missing external values fail closed, and the changed failure
path has a passing regression test.
