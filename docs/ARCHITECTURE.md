# Helix architecture

This is the shared, durable context for humans, Codex, and Claude. It records
only boundaries and rationale that are unsafe to infer from the current tree.
Behavioral details cited by source live in [`SPEC.md`](SPEC.md); current commands
and dependency versions live in `package.json`, config, and workflows.

## Boundaries

The dependency direction is `app → data → db`, `app → domain`, and
`data|services → db`.

- `src/app/` contains routes and orchestration, not raw SQL.
- `src/domain/` is pure: no React, storage, network, or other I/O.
- `src/data/repo.ts` is the stable persistence facade. Routes and UI do not
  import `src/data/repo/*` internals.
- `src/services/` owns side-effecting integrations and their device-local
  storage. There is deliberately no `src/lib/` catch-all.

Data-critical screens consume `*State` hooks with explicit
`loading | ready | refreshing | stale | error` states. An initial empty array or
`null` must not masquerade as a resolved account. A snapshot belongs to the
parameters that produced it: `useLive` may retain it during a same-query retry,
but must drop it when user, month, or other query dependencies change.

Every synced domain-row write pairs rows and outbox events in one `writeRows`
transaction. Deletes are tombstones because sync and undo require the row to keep existing.
Push acknowledgement uses the server-normalized `updated_at`; pull validates
ownership and shape before advancing its cursor. The cited domain rules are in
[`SPEC.md`](SPEC.md).

Root config files stay at root when their tool discovers them there by default.
Expo Router routes remain under `src/app/`; structural moves inside `src/` must
preserve `tests/architecture-contract.test.ts`. Two such moves have been
evaluated and neither is approved;
[`PROPOSED-MOVES.md`](PROPOSED-MOVES.md) records what each would change and the
evidence an approval must produce.

## Non-obvious toolchain constraints

- Node 22 is required for Expo SDK 54. Node 24/26 native TypeScript stripping
  breaks this SDK's toolchain.
- SQLite is async. The rejected synchronous web bridge required
  SharedArrayBuffer, a service worker, and a main-thread wait; it white-screened
  and froze phones.
- `xlsx` is the official SheetJS CDN tarball. Registry audit tools cannot see
  its advisories, so import changes require an upstream check.
- `expo-sharing` must not be listed as an `app.json` plugin; SDK 54 ships no
  config plugin for it and web export fails.
- Optional WASM fallback packages stay nested in `package-lock.json`. Hoisting
  them installs platform-incompatible children even when npm skips the parent.
- Expo-managed React, React Native, native libraries, ESLint, and TypeScript move
  only as a compatible SDK matrix; Dependabot guards in `.github/dependabot.yml`
  intentionally prevent isolated routine upgrades.
- A production web export and an EAS update must clear Metro's cache. Its key
  does not include `EXPO_PUBLIC_*`, so a local-only E2E export can otherwise
  remove Supabase configuration from a later production bundle.

The byte-identical pairs `assets/images/splash-icon{,-dark}.png` and
`assets/brand/symbol-{light,dark}-t.png` are intentional. Splash files are baked
into a native binary; brand files are imported by `src/ui/brand.tsx` and can ship
over OTA. Keeping separate paths makes those lifecycles visible.

The only deliberate runtime module back-edge is
`components → calculator → components`: `AmountField` resolves the calculator
after `components.tsx` initializes. Moving shared primitives solely to appease a
cycle tool would widen the interface without changing Metro's bundle.

## Security controls that must survive simplification

| Control | What it prevents | Authority |
|---|---|---|
| Session epoch | Late work from account A writing after sign-out or into account B | `src/sync/session-epoch.ts`, `src/auth/session.ts` |
| `tombstone_version` | A stale offline client's clock resurrecting a remotely deleted row | migration 12, `src/sync/merge-policy.ts` |
| Verification brake | Unbounded sensitive sign-in attempts without leaking one account's cooldown into another | `src/auth/verification-brake.ts` |
| Account freeze | Half-frozen accounts when network or cleanup fails | `src/auth/freeze.ts` and account-security tests |
| Chunked SecureStore | Oversized or partial native auth sessions being accepted from secure storage | `src/sync/secure-chunked-storage.ts` |
| Install-script allowlist | A new dependency silently executing code during `npm ci` | `tests/install-scripts.test.ts` |

RLS, not a client guard, is the authorization boundary. Details and accepted
residual risks live in [`SECURITY.md`](SECURITY.md).

## Interface contract

Helix is a connected financial ledger, not a bank console or card dashboard.
`src/ui/theme.ts` owns the complete light/dark palettes and semantic roles;
`src/ui/components.tsx` and focused primitives own reusable interaction
patterns. New screens reuse those interfaces rather than restyling them inline.

- Integer kuruş and ISO calendar dates retain financial precision.
- The product says “Yatırım”; persisted `transfer` names remain unchanged
  because they are sync and backup compatibility fields.
- Income/positive is green, expense/negative red, warning amber. Accent color
  expresses hierarchy, not financial meaning.
- Inter carries dense content; the IBM Plex Serif display face is limited to
  brand-level headings and high-value totals.
- Phone layouts keep one reading column. Dense financial data stays in shared
  tables rather than becoming one card per value.
- Motion uses the shared reduced-motion source in `src/ui/motion.ts`.
- Labels remain visible; placeholders never carry a field's only instruction.

## Incident-derived decisions

These are retained because the tree shows the current mechanism but not the
failure that selected it.

| Decision | Failure it prevents |
|---|---|
| Nested-tab pushes use an anchor and record their source | A pushed route could become the stack root; a global back target then fixed one entry path and broke another |
| Route params are validated before date/range helpers | Values such as `2026-13` throw during render |
| `controlBorder` is separate from decorative `border` | Toggle outlines otherwise fell to 1:1 contrast on an active-toned row |
| Chart colors are ordered by circular hue distance | Green, amber, and red otherwise read as one misleading status ramp |
| Account freeze rolls back every failure path | Earlier partial cleanup left `account_frozen` and `isFreezing` stuck |
| Table privileges are explicit migrations | RLS filters rows but does not grant access; schema replay once left `authenticated` with no table privileges |
| `dist/404.html` copies root `index.html` | Copying Expo Router's `+not-found` output hydrated the wrong deep-link route |
| iOS `NSFileProtectionComplete` is conditional | It is safe only while the app performs no background file work; revisit before adding background execution |
| Loading uses one three-dot indicator for the whole wait | Replacing it mid-wait with the detailed logo changed shape and rendered as a smudge; the owner closed this alternative on 2026-07-26 |

## Testing policy

Visual regressions are proved first with behavior, semantics/accessibility,
actual geometry, overflow, focus, and rendered contrast. Add a screenshot
baseline only when those layers cannot express a named risk, and record that
reason beside the baseline. Never weaken an assertion, threshold, or tolerance
merely to turn a failing run green.

[`BASELINE.md`](BASELINE.md) is the frozen measurement transcript. Its numbers
are deliberately not updated; it is the comparison point for later performance
and coverage work.

### Simplifications already tried and reverted

These are recorded so they are not attempted again. Each passed the normal gate
yet lost detection, so each was fully reverted:

- `src/domain/input.ts` — `for...of` code-point iteration instead of manual
  iterator management introduced an `@typescript-eslint/no-unused-vars` warning
  into the routine gate. A cleanup-induced warning is a net quality regression.
- `src/domain/balance.ts` — a private helper for the duplicated
  realized/pending month-bucket append dropped scoped mutation from 96.74% to
  96.70%; it removed two distinctions the tests detected.
- `src/domain/installments.ts` — a local avoiding a second `plan.dueDay ?? 1`
  evaluation dropped scoped mutation from 98.90% to 98.89%.

These are evidence for keeping the current implementations, not a backlog.

## Derived indexes and navigation

Neither tool below is an authority; `AGENTS.md` states how far an agent may
trust the index. This section records only why each is wired the way it is,
and nothing either produces is committed.

**Graphify** is installed as a user-scope skill, never with `--project`. A
project install writes an unlocked directory into `.agents/skills/` or
`.claude/skills/`, which `npm run control:check` reports as drift and which the
`npx skills` lockfile cannot describe. `graphify update .` rebuilds
`graphify-out/` from the AST in seconds with no network call and no API key, so
the output is regenerated rather than tracked. `.graphifyignore` holds the
vendored skill bodies out of the scan; without it their 224 files outnumber
Helix's own source and the detected communities describe their publishers'
prose instead of this codebase.

`graphify hook install` writes `.git/hooks/post-commit` and `post-checkout`,
which rebuild the graph in a detached process. Those hooks live in `.git/`, so
they are per-checkout and invisible to Git: an unexplained rebuild of
`graphify-out/` is almost always one of them, and a clone that lacks them will
never refresh on its own. `GRAPHIFY_SKIP_HOOK=1` disables both.

**Obsidian** opens `docs/` as the vault, and `docs/graph` symlinks the graph
export into it, so one vault holds these seven documents beside a note for
every code symbol. Measured: about twenty-five seconds of indexing on open,
settling near 700 MB resident at idle. That is the price of having the codebase
searchable next to the prose describing it, and it is why the export is linked
in rather than kept as a vault you switch to.

The repository root is not the vault, and the reason is content rather than
cost: of the ~4,900 Markdown files under it, all but eleven are `node_modules`
READMEs, vendored skill bodies, or the graph export already reachable through
`docs/graph`. Obsidian's excluded-files setting only de-emphasises a path in
search, it does not stop indexing, so no configuration keeps them out.
Obsidian also has no concept of a `.ts` file: no vault scope turns the 363
source files into notes, and only the graph export represents them at all.

`AGENTS.md`, `CLAUDE.md`, `README.md`, and `e2e/native/README.md` stay outside
the vault; each is loaded by a tool or read beside the code it describes. The
consequence is that the two `../e2e/native/README.md` links here resolve on
GitHub but not inside Obsidian; that is an accepted cost, not a broken link to
repair.
`docs/.obsidian/app.json` keeps `useMarkdownLinks` on and `newLinkFormat`
relative, so a link Obsidian writes stays `[text](path.md)` and still renders
on GitHub, where a wikilink would resolve for no reader at all. `trashOption`
is `system`, so deleting a note never leaves a `.trash/` copy inside the
repository. `graphify export obsidian` writes that note-per-symbol tree into
`graphify-out/obsidian/`, wikilinked, with an overview note per community.
`docs/graph` is a symlink to it rather than a second copy, so one export
refreshes both the ignored directory and the vault. Never write in it by hand,
and re-export after a rebuild: the post-commit hook refreshes `graph.json` but
not this export.

## Deliberately absent

- No analytics, product telemetry, or session recording: this is a one-user app
  and those tools would export behavior to answer questions the owner can answer.
- No third-party crash-reporting or alerting service:
  `src/services/diagnostics.ts` keeps a bounded local buffer and uploads only
  redacted first-party events to the owner's Supabase rows. Silent failures
  still do not alert the owner; privacy details live in [`PRIVACY.md`](PRIVACY.md).
- No feature-flag framework, second state/data library, server API tier, or
  component catalogue. A measured need must precede any of them.
- No multi-tenant workspace model: every remote row is owner-scoped.
- No device CI lane. Maestro suites are manual; hardware-only behavior remains
  unverified until a recorded device run exists.
- No i18n framework while Turkish is the only locale.
