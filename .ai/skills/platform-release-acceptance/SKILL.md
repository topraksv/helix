---
name: platform-release-acceptance
description: Selects and verifies the correct Helix web, Expo Go OTA, native, or database acceptance surface. Use when a task changes release configuration, CI/deploy behavior, build output, migrations, or asks whether a change is shippable.
---

# Platform and release acceptance

## Procedure

1. Read `AGENTS.md`, `package.json`, `app.json`, `eas.json` and the relevant
   workflow. Current Helix delivery is GitHub Pages web plus one Expo Go
   preview OTA; there is no standalone binary or store submission.
2. Classify changed surfaces: product web, browser E2E, Expo Go update, native
   config, Supabase migration, dependency, or CI. Use only commands exposed by
   the current `package.json` and workflow.
3. Run the required local gate (`verify` or `verify:full`), build/budget checks,
   database checks and live smoke for the actual surface. Keep the exact
   artifact that was checked as the artifact that is published.
4. Report unsupported physical-device, SMTP, WebKit, crash/OTA, or linked
   database checks instead of converting them to passes.

## Acceptance

The changed delivery surface has fresh command/CI/live evidence, the release
policy matches the current config, and every unavailable/manual check is named
with its owner and next action.
