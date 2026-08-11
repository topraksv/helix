---
name: tdd
description: Drives small Helix behavior changes with a focused red-green-refactor loop. Use when implementing a new rule, regression fix, or testable boundary where the expected behavior can be stated first.
---

# Test-driven implementation

1. State the observable behavior and failure case. Read the existing seam and
   invariant before writing a test.
2. Add the smallest failing test that would distinguish the bug from a tautology
   or a mock-only pass.
3. Implement the smallest owning change, keep errors and ordering intact, and
   make the test pass.
4. Refactor only when the behavior is green; then run the relevant wider gate.

Acceptance is a meaningful regression test, a minimal implementation, and
fresh command output. TDD is an implementation method, not a universal reason
to rewrite already-proven tests.
