---
name: platform-release-acceptance
description: Defines and verifies Helix acceptance across static web, installed iOS, future Android, Supabase, GitHub Pages, EAS Update, and native rebuild boundaries. Use when a change affects navigation, headers, modals, gestures, notifications, storage, native configuration, deep links, migrations, release workflows, or anything that can work on web while failing on device.
---

# Platform Release Acceptance

## Overview

Match the evidence to the surface that changed. A green web export cannot prove
native presentation, and an OTA update cannot carry a native configuration
change.

## Workflow

1. Read `docs/TESTING.md` and `docs/RELEASE.md`; classify the changed surfaces
   before implementation.
2. Build an acceptance matrix with rows only for affected surfaces: unit/type,
   browser, iOS simulator/device, Android, linked Supabase, Pages, OTA, or
   native build.
3. State what each row can prove and what it cannot. Reuse the canonical device
   acceptance cases instead of inventing a second checklist.
4. For navigation, header, modal, keyboard, gesture, animation, haptic,
   safe-area, privacy-cover, deep-link, or notification changes, inspect the
   native-specific path and use the relevant `expo-router`,
   `native-interaction`, `expo-native-ui`, and `mobile-accessibility` skills.
5. Run `npm run verify`; run `npm run verify:release` for release-affecting
   changes. Add linked database checks and real-device evidence where the
   canonical matrix requires them.
6. Record blocked rows explicitly with the missing device/account/authority.
   Do not report the package as fully accepted until required rows pass.
7. Choose the delivery mechanism from `docs/RELEASE.md`: web merge, EAS Update,
   or native rebuild. Never infer one from another.

## Evidence Rules

- A screenshot proves pixels, not focus order, gesture competition, haptics,
  secure storage, background behavior, or assistive technology.
- Simulator evidence does not prove physical-device haptics, lock state, or all
  notification behavior.
- Automated accessibility does not replace VoiceOver/TalkBack, keyboard, focus,
  contrast, and Dynamic Type checks.
- A successful build does not prove routing or persistence behavior.
- Keep artifact paths and failure measurements; do not retain disposable
  screenshots, traces, or reports after the task.

This skill does not publish, merge, submit, migrate, or rotate secrets unless
the user separately authorizes that action.
