---
name: expo-native-ui
description: Builds or reviews native-feeling React Native and Expo UI using Helix tokens and installed SDK 54 capabilities. Use when a task changes native controls, platform styling, media, animation, sheets, or cross-platform surface behavior.
---

# Expo native UI

## Procedure

1. Inspect the existing primitive, token and platform pattern before adding a
   component. `src/ui/theme.ts`, `src/ui/primitives.tsx` and current
   `package.json` are authoritative.
2. Keep the surface in the `token → primitive → pattern → route` chain. Use
   semantic colors, measured spacing, real font scaling, safe areas and native
   platform behavior. Do not assume newer-SDK APIs or packages absent from the
   installed SDK 54 tree.
3. Define loading, disabled, pressed, focus, error, keyboard, reduce-motion and
   narrow-width states. Keep financial text and accessible labels intact.
4. Prefer a native control when the platform owns the interaction; write a web
   counterpart only where React Native Web lacks the prop or behavior.
5. Verify semantics, rendered contrast, hit boundaries, overflow and focus in
   the relevant browser/simulator checks, not only with TypeScript.

## Required evidence

Name the reused token/primitive, installed package/API version, platform
exceptions and geometry/accessibility evidence. Read current official Expo SDK
54 docs when the API behavior is uncertain.

## Acceptance

The screen follows the established design system, has complete interaction and
error states, preserves financial meaning, and passes the relevant UI,
accessibility and regression checks on the changed surface.
