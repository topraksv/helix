---
name: native-interaction
description: Designs or diagnoses Helix native interaction, motion, gestures, reorder, scrolling, modals, and haptics. Use when a task changes how a user presses, drags, scrolls, opens, dismisses, or receives feedback from a control.
---

# Native interaction

## Procedure

1. Trace the current Pressable/gesture/scroll/modal owner and platform
   fallback. Keep interaction state on the control that owns the hit boundary.
2. Define idle, pressed, focused, disabled, cancelled, interrupted and reduced
   motion states. A modal closes by unmounting unless an existing platform
   contract proves otherwise.
3. Keep motion short, directional and meaningful: only the hero value animates
   in dense financial surfaces; every family honors Reduce Motion.
4. Verify touch/focus boundaries, gesture cancellation, back behavior and web
   parity with the closest real-device/browser test.

## Acceptance

The interaction has an explicit state model, no accidental double action or
focus trap, accessible feedback, platform-safe motion, and passing behavior plus
geometry evidence.
