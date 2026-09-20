# Offline-build native flows

These two flows need a build whose Supabase values were **empty at build time**.
That is the whole reason they are a separate directory rather than two more
files next to `../native/`: the suite there signs in against a configured
project, and a single Maestro run cannot have the app built both ways.

Run them against an offline build:

```sh
npm run test:native:offline
```

What they prove that the configured suite cannot: the ledger, investments and
settings survive a relaunch when SQLite is the only store — no cloud read can
paper over a native write that never happened. `02-investment-correction.yaml`
additionally pins a regression where removing a product raced the correction
screen's pop, leaving UIKit on an empty scene.

The directory was called `native-local` until 2026-09-20. The name said where
the test runs, which is the same place as every other native flow; what it
needed to say is which build it runs against.
