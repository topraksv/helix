---
name: mobile-accessibility
description: Reviews Helix React Native and Expo accessibility semantics, focus, text scaling, contrast, and touch geometry. Use when a task changes controls, labels, focus order, Dynamic Type, VoiceOver/TalkBack behavior, or accessible layout.
---

# Mobile accessibility

## Procedure

1. Inspect the existing primitive and platform implementation. Preserve
   accessible names, roles, states, hints and test IDs while changing layout.
2. Check keyboard/focus order on web, VoiceOver/TalkBack semantics, minimum
   control boundaries, Dynamic Type/text scaling, reduced motion and rendered
   contrast. `hitSlop` is not a web geometry fix.
3. Measure real layout at narrow, landscape, iPad and large-font sizes. Do not
   hide overflow by disabling font scaling or truncating required copy.
4. Update the closest semantic/geometry regression test and run the relevant
   browser/native check.

## Required evidence and acceptance

Record the accessible name/role/state, measured boundary/viewport, contrast or
   scaling result, and test output. Completion requires behavior, semantics and
   geometry evidence; a passing lint is insufficient.
