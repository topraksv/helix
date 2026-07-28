---
name: native-interaction
description: Implements and reviews Helix motion, gestures, drag/reorder behavior, press feedback, scrolling, modals, transitions, and haptics using the repository's current Expo/React Native stack. Use when changing Animated, PanResponder, touch handling, shared motion primitives, reduced-motion behavior, or native interaction performance.
---

# Native Interaction

## Overview

Use one interaction mechanism per behavior, preserve platform parity, and make
motion explain state or spatial change. Start from `src/ui/motion.ts`,
`src/ui/modal-motion.ts`, `src/ui/haptics.ts`, and existing shared primitives.

## Workflow

1. Read the relevant call sites and current shared primitive before choosing an
   API. Check the installed packages in `package.json`.
2. Describe the state transition, interrupt/cancel behavior, gesture ownership,
   accessibility alternative, and platform-specific result.
3. Prefer current React Native `Animated`, `PanResponder`, and Helix helpers
   while they meet the requirement. Reanimated, Gesture Handler, Skia, WebGPU,
   or another native dependency requires a separate measured need and explicit
   approval.
4. Keep animation state off React render state when it changes per frame. Limit
   animated properties to those the chosen driver supports and avoid layout
   work inside continuous gestures.
5. Respect Reduced Motion. Essential state changes remain understandable
   without movement; decorative motion disappears.
6. Route haptics through `src/ui/haptics.ts`; they are iOS-only, change-based,
   and never allowed to block the action.
7. Test interruption, rapid repeat, back/dismiss, keyboard, scroll nesting,
   safe areas, and gesture competition. A vertically draggable editor is not an
   iOS sheet.
8. Measure frame behavior in a release build for performance claims and use
   `platform-release-acceptance` for device evidence.

## Review Questions

- Does the feedback correspond to a real state change?
- Can two timers, guards, drivers, or gestures own the same behavior?
- What happens halfway through when the user reverses, dismisses, backgrounds,
  or repeats the action?
- Is content readable and operable with motion disabled?
- Does web still have an equivalent outcome, even when native polish differs?
- Can a native failure prevent the user's financial action?

Do not add continuous decoration, universal press scaling, gratuitous haptics,
or a new animation system to solve a local interaction.
