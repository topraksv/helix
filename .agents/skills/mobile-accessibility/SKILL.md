---
name: mobile-accessibility
description: Audits and implements accessibility for Helix React Native and Expo surfaces. Use when changing controls, forms, modals, navigation, charts, tables, gestures, animation, status messages, touch targets, focus, labels, Dynamic Type, contrast, VoiceOver, or TalkBack behavior.
---

# Mobile Accessibility

## Overview

Make the same task perceivable and operable without vision, color perception,
fine motor precision, or motion tolerance. Start from Helix shared primitives
and the accessibility rules in `AGENTS.md`.

## Workflow

1. Identify the user's task and inspect the complete interaction, not isolated
   JSX attributes.
2. Prefer native semantic elements and shared Helix primitives. Fix reusable
   behavior at the primitive rather than patching each caller.
3. Give controls a concise accessible name, correct role, current state/value,
   and a hint only when the result is not apparent.
4. Keep visual labels persistent. Associate errors with fields and announce
   asynchronous validation/status changes without repeated noise.
5. For a modal, isolate background content, focus the heading, provide a clear
   dismiss path, and return focus to the invoker. Keep container Pressables
   `accessible={false}`.
6. Provide an accessible action alternative for drag, swipe, pinch, or other
   gesture-only behavior.
7. Preserve readable reflow and functionality under large text. Do not solve
   overflow with ellipsis, fixed heights, or reduced font size.
8. Respect Reduced Motion and never use color alone. Charts expose a complete
   textual value summary.
9. Run automated checks where available, then manually verify focus order,
   announcements, keyboard behavior, VoiceOver/TalkBack, Dynamic Type, contrast,
   and touch targets on the affected platform.
10. Record unavailable device or assistive-technology checks through
    `platform-release-acceptance`; do not call them passed.

## Platform Sources

Use `source-driven-development` when current API behavior matters. Prefer
official React Native accessibility documentation, Apple accessibility/Human
Interface Guidelines, Android accessibility guidance, and WCAG as the
standards source. Repository behavior and tested product rules remain the local
contract.

Automated scanners are helpers, not acceptance. They do not prove focus
management, spoken output, rotor/actions, gesture alternatives, or behavior on
a physical device.
