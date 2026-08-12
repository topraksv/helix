# iOS acceptance flows

## Contents
- Why these exist
- Running them
- What each flow proves
- What they cannot reach yet, and why
- What they found

## Why these exist

Every one of the 86 Playwright tests runs in Chromium, and the app ships to
iOS. The paths that differ are not small: SQLite is a native driver rather than
the wasm build, fonts load from the app bundle rather than over HTTP, Keychain
replaces `localStorage`, and the navigator, the modals and the animations are
UIKit rather than DOM. A defect in any of those is invisible to the browser
suite and reaches the owner as a broken phone.

There were four Maestro files under `.ai/tmp/audit/native/` before these. They
took screenshots and asserted nothing, which makes them probes for a human to
look at once. These assert.

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

## What each flow proves

**`01-launch.yaml` — the app opens on a real device.**
Four things at once, all silent in the browser suite: JavaScript ran,
`migrateDb` completed against the NATIVE SQLite driver, the splash dismissed,
and the vendored subset fonts loaded from the app bundle. The font assertion is
deliberately a Turkish sentence — ş, ı, ğ and ü live in the ranges
`scripts/subset-fonts.mjs` keeps, so a bad subset draws tofu here rather than
failing loudly anywhere else.

**`02-sign-in-surface.yaml` — the cloud entry renders.**
The first screen a phone shows, and one the browser suite never sees at all:
`scripts/export-e2e-web.mjs` empties the Supabase configuration to reach the
local-only path, so nothing had ever exercised this screen.

**`03-restart-persistence.yaml` — the app survives a cold start.**
On iOS the database is a file in an app container sealed while the device is
locked (`NSFileProtectionComplete`). That entitlement is the one thing that
could make it unreadable on a real relaunch, and no browser test can ask.

**`04-recovery-route.yaml` — recovery, and the way back out of it.**
The recovery routes are exempt from the signed-in and onboarding guards,
which makes "can the user still leave" a real question.

## What they cannot reach yet, and why

The ledger itself — onboarding, entering a transaction, the matrix — sits
behind authentication on a native build, because the app compiles the Supabase
configuration in. Emptying it in Metro is not enough; it has to be empty at
BUILD time, the same way `scripts/export-e2e-web.mjs` does for the web
artifact:

```sh
EXPO_PUBLIC_SUPABASE_URL="" EXPO_PUBLIC_SUPABASE_ANON_KEY="" EXPO_NO_DOTENV=1 \
  npx expo run:ios --device "iPhone 17 Pro"
```

That is untested — it is the obvious next step, not a verified recipe. Until it
is, the ledger flows are covered on web only.

Face ID, notification permission and the share sheet raise OS-owned UI a
simulator cannot answer deterministically. Their pure logic is unit-tested
(`biometric-name.ts`, `domain/notifications.ts`); the prompts stay a manual
check before a store build.

## What they found

Writing them was worth it before they ever ran green:

- **A baseline defect on the sign-in screen.** "Hesabın yok mu?" and "Kayıt ol"
  sat on different baselines, because the row defaulted to `alignItems:
  stretch` and the plain text grew to the 44px touch target beside it. The
  repository's own invariant says a paired row shares one baseline. The browser
  suite could never have caught it — it never loads this screen.
- **Recovery is a state, not a push.** An edge-swipe assertion would have
  passed on Android and meant nothing on iOS.
- **The card merges its accessibility label**, so a screen reader announces
  "…seni bekliyor.. E-posta…" with two full stops.
