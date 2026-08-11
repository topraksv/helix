---
name: playwright-best-practices
description: Builds and diagnoses Helix React Native Web browser E2E tests for auth, imports, offline recovery, accessibility, geometry, and CI. Use when a task changes Playwright tests/configuration or needs browser-level evidence.
---

# Helix browser E2E

## Procedure

1. Read `playwright.config.ts`, `e2e/` helpers/specs, the exported web entry
   and current `@playwright/test` version. The supported suite is the actual
   React Native Web app, not a generic framework example.
2. Prefer role/label/test-id semantics and observable state over sleeps,
   implementation selectors or screenshots. Wait for the condition that proves
   the app is ready; isolate account and storage state per test.
3. For auth/import/offline flows, assert ownership, invalid input, atomicity,
   reload/relaunch and user-visible recovery. For UI, assert semantic labels,
   focus, contrast, viewport geometry, overflow and control boundaries.
4. Run the narrow browser project first, then `npm run test:e2e:only` or the
   required smoke/full command. Keep Chromium/Firefox support explicit; do not
   silently add unsupported WebKit behavior.

## Acceptance

The test proves the user-visible risk at the browser boundary, is deterministic
under the repository's server/export setup, and passes with its exact command.
Failures distinguish an application defect from browser/runtime limitations.
