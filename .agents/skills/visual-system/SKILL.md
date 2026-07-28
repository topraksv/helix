---
name: visual-system
description: Protects Helix's visual language, semantic color system, typography, density, responsive layout, light/dark behavior, and Turkish product copy. Use for new screens, redesigns, theme/token changes, contrast work, table or form hierarchy, empty/error states, terminology, and cross-platform visual review.
---

# Visual System

## Overview

Refine the existing product identity instead of importing a generic aesthetic.
Canonical UI rules live in `AGENTS.md`, design language in
`docs/ARCHITECTURE.md`, strings in `src/i18n/tr.ts`, and tokens/primitives in
`src/ui/`.

## Route the Task

- Use `frontend-design` only for a new screen or meaningful visual direction.
- Use `expo-native-ui` for platform-native controls and presentation.
- Use `mobile-accessibility` for semantic, focus, Dynamic Type, and assistive
  technology behavior.
- Use `web-design-guidelines` for an explicit web audit and
  `playwright-best-practices` for visual/browser regression tests.
- Use `prototype` only when the user explicitly requests disposable options.

## Workflow

1. Inspect adjacent screens, shared primitives, tokens, screenshots, and the
   complete information hierarchy before editing.
2. Define the job of each visible element. Remove decoration with no
   informational, navigational, or feedback role.
3. Use semantic tokens; never choose a raw color because it looks plausible.
   Measure every text/control/state pair in both themes and update
   `tests/theme-contrast.test.ts` with token changes.
4. Preserve financial density without sacrificing scan order, touch targets,
   wrapping, row alignment, or safe areas. Never truncate with ellipsis.
5. Design loading, refreshing, stale, error, empty, disabled, destructive,
   long-text, large-number, keyboard, and reduced-motion states.
6. Keep Turkish concise, consistent, and user-facing. Use one term per concept;
   do not leak storage/schema names. Put every string in `src/i18n/tr.ts`.
7. Check web and native layouts at real breakpoints, light/dark themes, font
   scaling, and current data extremes.
8. Use `platform-release-acceptance` for the affected surface and attach only
   the evidence required by `docs/TESTING.md`.

## Visual Guardrails

- Neutral surfaces remain neutral; accents do not tint the whole app.
- Positive, negative, warning, foreground, control, and fill roles remain
  distinct.
- Color is never the only carrier of meaning.
- Avoid generic dashboard card piles, gratuitous gradients, excessive
  rounding, decorative charts, and reduced information density.
- Ordinary and computed table content stays actionable as required by
  `AGENTS.md`.
- Matching controls share size and alignment; every row control is vertically
  centered.

An aesthetic preference is not evidence. Measure contrast, text fit, layout,
and visual diffs, then inspect the result.
