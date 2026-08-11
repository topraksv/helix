---
name: performance-optimization
description: Measures and improves Helix Expo, web, SQLite, Supabase, and Playwright performance without changing behavior blindly. Use when a task reports jank, slow startup, large bundles, long queries, or an explicit performance goal.
---

# Performance

## Procedure

1. Establish a reproducible baseline in the real target: device/browser,
   dataset, route and command. Read existing budgets and measurements before
   proposing an optimization.
2. Attribute the cost to derivation, render, I/O, network, bundle or test
   orchestration. Use the repository's bundle budget, browser vitals, tests or
   database explain evidence; do not substitute generic Lighthouse/APM claims.
3. Make the smallest behavior-preserving change, then measure the same scenario
   again. Revert an unmeasured or regressive “optimization”.
4. Preserve offline behavior, financial ordering, accessibility and platform
   geometry. Add a regression assertion for a stable state or budget when
   timing variance makes a threshold unsafe.

## Acceptance

The report includes before/after measurements, target conditions, changed
surface, correctness checks and remaining variance. A smaller bundle or faster
isolated function without a real-user path is not sufficient evidence.
