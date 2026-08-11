---
name: property-based-testing
description: Designs TypeScript fast-check properties for Helix financial, serialization, normalization, and account-boundary invariants. Use when examples do not cover a meaningful input space or a domain invariant needs generative evidence.
---

# Property testing

## Procedure

1. Choose a pure rule or a bounded repository oracle and state the invariant in
   plain language. Do not property-test UI snapshots or an implementation by
   reusing the same helper as the production answer.
2. Build typed generators for supported amounts, dates, currencies, rows,
   references and mutation sequences. Constrain only what the contract allows;
   include invalid and boundary inputs deliberately.
3. Assert conservation, normalization, round-trip, idempotence, ownership,
   ordering or atomicity properties. Keep seeds and shrinking output
   reproducible.
4. Run the focused Vitest property suite and the relevant coverage/mutation or
   full verification gate. Inspect surviving cases rather than hiding them.

## Acceptance

The property has an independent oracle, a bounded generator, useful shrinking,
explicit invalid cases, reproducible failure output and evidence that it tests
Helix's TypeScript/fast-check contract rather than restating the implementation.
