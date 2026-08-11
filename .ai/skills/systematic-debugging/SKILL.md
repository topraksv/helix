---
name: systematic-debugging
description: Finds the root cause of Helix failures before changing code, using bounded evidence and regression tests. Use when behavior is broken, a test is flaky, an error is intermittent, or the first visible symptom may be downstream.
---

# Systematic debugging

## Procedure

1. Capture the exact symptom, environment, input, first failing assertion and
   current diff. Reproduce it with the smallest safe command.
2. Trace backward from the failure to the first violated invariant. Compare a
   working path, inspect state transitions and instrument only development
   diagnostics; do not widen production logging.
3. Form one falsifiable hypothesis at a time. Use a targeted probe or fixture,
   then change the smallest owning boundary. Do not patch the last stack frame
   without proving causality.
4. Add a regression test for the failure and run the focused plus
   risk-appropriate full gate. Re-check callers and remove temporary probes.

## Acceptance

The report names cause, evidence, owning boundary, fix, regression test and
remaining environment limits. A workaround without a causal test is not a
completed diagnosis.
