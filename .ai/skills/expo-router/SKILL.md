---
name: expo-router
description: Changes or diagnoses Helix Expo Router routes, stacks, tabs, modals, deep links, headers, and route parameters. Use when a task changes navigation structure or route-level behavior in the SDK 54 app.
---

# Expo Router

## Procedure

1. Read the actual `src/app` tree, `app.json`, `package.json` and the current
   router config. Existing route groups, auth/onboarding guards and deep-link
   tests outrank generic Router advice.
2. Keep route ownership and params explicit. Preserve signed-out, recovery,
   onboarding, locked and account-switch boundaries; do not bypass guards with
   a direct navigation shortcut.
3. Check modal/sheet/header/tab behavior on web and native. Avoid unstable or
   newer-SDK APIs unless current official SDK 54 documentation and the installed
   package prove support.
4. Update route/deep-link/accessibility tests for every changed path. Verify
   focus, back behavior, transition state and refresh/cold-start behavior.

## Required evidence

Record the changed route files, guard/param flow, installed `expo-router`
version, and the exact route checks run. If a feature depends on a newer SDK,
stop and report the incompatibility instead of adding a speculative package.

## Acceptance

The route resolves to the intended screen from its supported entry points,
guards and params remain safe, back/modal behavior is deterministic, and the
relevant web/native route tests pass.
