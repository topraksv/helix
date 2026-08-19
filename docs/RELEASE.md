# Helix release runbook

This file keeps only the external decisions that cannot be inferred safely from
the build scripts. `.github/workflows/ci.yml` and
`tests/release-config.test.ts` are the authority for current job names,
versions, and commands.

## Authority and delivery surfaces

A push to `main` classifies the changed paths, runs the light gate, adds the
full gate for high-risk or unrecognised paths, and automatically publishes each
surface whose bytes can have changed. A change to the delivery workflow or its
classifier also rebuilds and republishes both surfaces after the full gate; this
is the automatic recovery path when an earlier shipping push failed before
publication. Both surfaces can publish from the same successful gate and both
use the `helix` environment. Authorization to push `main` includes those
classifier-selected publications.

Manual `workflow_dispatch` remains an optional override for a check-only run or
an explicit `web`, `mobile`, or `both` redeploy. Direct deploy/OTA commands,
manual dispatch, and linked database publication still require the owner's
authorization for the exact target.

The current delivery surfaces are:

- a static GitHub Pages web application;
- an Expo Go-compatible SDK 54 update on EAS branch `preview`;
- a linked Supabase schema, updated separately when migrations change.

There is no EAS Build profile, development client, TestFlight path, store
submission, or production store binary in this repository. An OTA result is
not evidence of installation or physical-device acceptance.

## Local gate

`AGENTS.md` selects between `npm run verify` and `npm run verify:full`, and
`.nvmrc` pins the Node version both expect. Database changes also require the
local Supabase workflow below. A failed or skipped required check is not a
release candidate.

The production web export and EAS update must clear Metro's cache; the reason is
recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md). Web publishes the exact
artifact that passed the bundle budget rather than exporting again in the
deploy job.

## Supabase migrations

Migrations are forward-only and backward-compatible with the installed client.
The outbound sync policy derives its allowed columns from the LOCAL schema, so
a client that writes a new column pushes it whether or not the database has it:
publish the database migration before shipping the client that uses it.
`00000000000031_matrix_color_slots.sql` is unpublished and gates this
release: the live check still admits only the five meaning-named colour tokens,
and the client now writes the four hue-named ones. A rejected push throws for
the whole batch, so shipping the client first stops that device syncing
anything at all until the migration lands. It is written as an expand — both
vocabularies pass — so the reverse order is safe and a client that has not
taken the update keeps working.
Never run linked `db reset` or destructive SQL against production. The order is:

1. add the compatible schema change and its local RLS/constraint/RPC tests;
2. pass the full local gate and local Supabase workflow;
3. obtain explicit authorization for the linked target;
4. push, compare migration versions, lint `public`, and run pgTAP remotely;
5. regenerate `src/sync/database.types.ts` from that linked schema and
   typecheck before releasing dependent clients.

```sh
npx supabase db push --linked
npx supabase migration list --linked
npx supabase db lint --linked --schema public
npx supabase test db --linked supabase/tests
npx supabase gen types typescript --linked > src/sync/database.types.ts
npm run typecheck
```

Free-tier Supabase does not provide a repository-verifiable PITR guarantee.
Before a destructive repair or bulk migration, create an encrypted logical dump
outside the repository and prove it restores in an isolated target. Without an
approved target and restore evidence, the operation is blocked.

## Rollback and evidence limits

Rollback is a new `git revert` commit that passes the same gate; never select an
old artifact by hand, force-push, or rewrite history. A bad Expo Go update is
replaced or rolled back only on the same SDK runtime and branch. A database
rollback is a new compatible forward migration, not deletion of applied
migration history.

Record the Git SHA and workflow run. For mobile, also record EAS group, runtime,
branch, both platform update ids, and any actual device result. Browser tests do
not prove native SQLite, Keychain, OS notification UI, biometrics, app-switcher
snapshots, or store delivery; the manual native suites and their remaining
limits are documented beside them in [`e2e/native/README.md`](../e2e/native/README.md).
