# iOS acceptance flows

## Why these exist

Browser tests cannot exercise native SQLite, bundled fonts, Keychain, UIKit
navigation, OS dialogs, or app lifecycle. The paths that differ are not small:
SQLite is a native driver rather than the wasm build, fonts load from the app
bundle rather than over HTTP, Keychain
replaces `localStorage`, and the navigator, the modals and the animations are
UIKit rather than DOM. A defect in any of those is invisible to the browser
suite and reaches the owner as a broken phone.

## Running them

Maestro needs a JVM and Homebrew's `openjdk` is keg-only, so `npm run
test:native` puts it on `PATH` itself.

```sh
npm run ios:build     # ~10 min cold; only after native/config/dependency changes
npm run test:native
```

The ledger and investments need a local-only build whose Supabase values were
empty at build time. They are kept in a separate suite so a normal configured
build does not fail by design:

```sh
EXPO_PUBLIC_SUPABASE_URL="" EXPO_PUBLIC_SUPABASE_ANON_KEY="" EXPO_NO_DOTENV=1 \
  npx expo run:ios --configuration Release --device "iPhone 16e" --no-bundler
npm run test:native:local
```

The app must be installed and a simulator booted. A dev-client build downloads
its JavaScript from Metro on every launch, which is why the first assertion in
each flow waits up to 90s; a release build with an embedded bundle is up in a
fraction of that.

### The scripts reset the simulator keychain first

Every flow starts from a signed-out device, and `launchApp: clearState` does
not deliver one: it empties the app's data container, but the Supabase session
lives in the iOS keychain through `expo-secure-store`. The keychain belongs to
the simulator rather than to the app, so it survives `clearState`, a delete and
a reinstall alike.

Left alone, a run that signs in changes what every later run starts from — the
app restores the session, pulls a workspace and opens the dashboard, and the
flows fail asserting a sign-in screen that was never going to appear. The
failure reads as a broken app rather than as leftover state, which is the worst
kind of red. `xcrun simctl keychain <device> reset` therefore runs inside the
npm scripts rather than living in someone's memory. Android has no keychain and
its script is unchanged.

Two rules follow for anything added here: a flow may not depend on state an
earlier flow left behind, and any device state a flow needs must be established
by the script rather than assumed.

## What each flow proves

**`01-launch.yaml` — the app opens in a native runtime.**
Four things at once, all silent in the browser suite: JavaScript ran,
`migrateDb` completed against the NATIVE SQLite driver, the splash dismissed,
and the vendored subset fonts loaded from the app bundle. The font assertion is
deliberately a Turkish sentence — ş, ı, ğ and ü live in the ranges
`scripts/subset-fonts.mjs` keeps, so a bad subset draws tofu here rather than
failing loudly anywhere else.

**`02-sign-in-surface.yaml` — the cloud entry renders, and consent gates it.**
The first screen a phone shows, and one the browser suite never sees at all:
`scripts/export-e2e-web.mjs` empties the Supabase configuration to reach the
local-only path, so nothing had ever exercised this screen.

It is also the only place that can see the KVKK consent control, so that is
asserted here: the sign-up form carries the consent gate, the notice opens OVER
the form and closes back onto it, and the notice scrolls the whole way to the
acceptance at its end. All three matter — a consent line whose notice cannot be
read is a tick-box, a notice that costs a half-typed form is one people learn
not to open, and an acceptance nobody can scroll to is unreachable while every
static assertion about it still passes.

**`03-restart-persistence.yaml` — the app survives a cold start.**
On iOS the database is a file in an app container rather than IndexedDB. The
flow proves a native process can reopen it; it does not prove file protection
while physical hardware is locked.

**`04-recovery-route.yaml` — recovery, and the way back out of it.**
The recovery routes are exempt from the signed-in and onboarding guards,
which makes "can the user still leave" a real question.

**`05-text-size.yaml` — native text scaling.**
Exercises the iOS content-size behavior that React Native Web cannot reproduce.

The separate `e2e/native-local/` suite proves local-only ledger and investment
writes survive a native process restart, and protects the investment-correction
return path.

## What they cannot reach yet, and why

Face ID, notification permission and the share sheet raise OS-owned UI a
simulator cannot answer deterministically. Their pure logic is unit-tested
(`biometric-name.ts`, `domain/notifications.ts`); the prompts stay a manual
check before a store build.

Android's recents thumbnail is now blanked by `FLAG_SECURE` rather than by a
React render, because `AppState` never reports `inactive` there — see
`src/ui/privacy-cover.tsx`. Two things about it are device-only: that the
thumbnail really is blank while signed in, and that screenshots work again
after signing out. Neither can be observed from a simulator run here.

No run here proves a physical iOS/Android install, locked-device file access,
app-switcher snapshot timing, notification delivery, biometric enforcement,
live two-device convergence, low-memory import behavior, or store delivery.
VoiceOver/TalkBack physical acceptance is owner-scoped out of the current
preview model. Report these as unverified unless a specific device/build run is
recorded in the task handoff.
