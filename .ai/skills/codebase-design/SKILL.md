---
name: codebase-design
description: Shapes Helix modules around clear ownership, seams, adapters, and local reasoning. Use when designing a new boundary or changing a module interface, dependency direction, or deep-module seam.
---

# Codebase design

## Scope

Use this for structure and vocabulary, not for routine cleanup or a broad
architecture rewrite. Repository source and tests define the actual boundary.

## Procedure

1. Trace the current caller and data flow before proposing a new seam. Identify
   the concept that owns the rule, the stable interface, and the code that
   should remain private.
2. Prefer a deep module with a small interface, a named adapter at an external
   boundary, and one owner for each shared answer. Avoid a generic layer until
   a third real caller proves it is needed.
3. Compare the smallest viable design with the current design. Keep the option
   that removes concepts and preserves locality, testability and error paths.
   A bounded read-only comparison is enough; do not spawn a review swarm.
4. Check cycles, route/repository boundaries, dynamic imports and generated
   code. Add or update a source contract test when the boundary is enforced by
   convention.

## Required evidence

Show the caller set, ownership decision, dependency direction and a test or
static check that would fail if the new boundary regressed. Record rejected
abstractions when they explain why the design is intentionally small.

## Acceptance

The change leaves one clear owner, a smaller or equally legible interface, no
new cycle, and a focused regression/contract check. If the design only moves
complexity, do not ship it as simplification.
