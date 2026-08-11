---
name: visual-system
description: Leads Helix visual and UI decisions from the existing token system through measured native and web surfaces. Use when a task changes layout, typography, color, density, responsive behavior, UI copy, or a web visual audit.
---

# Helix visual system

## Source truth

Start with `src/ui/theme.ts`, `src/ui/primitives.tsx`, shared UI components,
`src/i18n/tr.ts`, and the design-system/contrast tests. The existing system
answers before a new aesthetic direction is invented. Follow
`token → primitive → pattern → surface`; semantic colors, spacing, typography,
motion and interaction fills are not per-screen guesses.

## Procedure

1. Identify the surface, viewport/platform matrix, Turkish copy and current
   primitive. Reuse the established token and pattern or state why a new one is
   necessary.
2. Preserve accessible labels, real font scaling, pressed/focus/disabled/error
   states, safe areas and financial meaning. Measure contrast, control
   boundaries, wrapping, overflow/clipping and modal focus in the real font and
   viewport.
3. For a genuinely new direction, compare a small set of variants against the
   existing system and keep the one that improves task clarity without adding a
   parallel design language.
4. For `web` mode, read the pinned [web interface reference](references/web-interface-guidelines.md)
   on demand. Review actual web files and return concise file/line findings;
   never fetch a mutable upstream guide at runtime.

## Required evidence and acceptance

Name tokens/primitives, measured dimensions/contrast and tested states. The
changed UI passes the nearest semantic, geometry, contrast and browser/native
checks. A screenshot is secondary evidence and never replaces the measurements.
