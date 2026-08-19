# Helix architecture

This is the shared, durable context for humans, Codex, and Claude. It records
only boundaries and rationale that are unsafe to infer from the current tree.
Behavioral details cited by source live in [`SPEC.md`](SPEC.md); current commands
and dependency versions live in `package.json`, config, and workflows.

## Boundaries

The dependency direction is `app → data → db`, `app → domain`, and
`data|services → db`. `db` and `sync` are the one pair that points both ways:
`src/db/mutations.ts` needs `sync/tombstone-policy` to stamp a delete, and
`sync/engine.ts` needs the db client and schema to drain the outbox. The
architecture contract checks cycles per file rather than per layer, so it does
not see this pair; `tombstone-policy.ts` importing nothing is what keeps the
pair from becoming a real cycle, and giving it an import would create one.

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

[`UI.md`](UI.md) is the placement authority: which component sits where, who
owns the space around it, and how a surface changes with width. Read it before
adding a screen, a card, a control cluster or a breakpoint. Only the rules that
cost an incident to learn are repeated here.

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
- Pinning a table column changes where it sits, never what it can do and never
  how it looks. The pinned header carries the column's own action beside its
  unpin control, the same pair a scrolling header has, and both rails render a
  column through one `headerChrome`/`bodyCell` pair so a state cannot exist in
  one and not the other.
- Hover and pressed come from `interactionSurface` and nothing else, applied to
  the pressable itself. A container without a role never carries the fill or
  its transition: the transition IS the claim to be interactive. One visual
  cell lights once — an inner control reports its pointer to the outer one
  through `interactionSurface`'s `hovered` option and paints no fill itself.
- A header's rule is always reserved and recoloured, never toggled on. A border
  that appears with a state moves the text beside it by those pixels.
- Every width that changes a layout mode is a named predicate in
  `src/ui/responsive.ts`, with its measurement in the comment. A threshold
  written inline is a rule nobody can find, test, or keep level with the rule
  beside it.

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
| Auto-pay ignores a billing date on or before its rule's creation day | Saving an auto-pay subscription on its own billing day confirmed a realized expense immediately, so the current balance fell by its amount before any money moved |
| A stored UTC timestamp is converted with `localDayOfTimestamp`, never sliced | `created_at` is UTC and every date compared against it is local, so slicing reads a day behind for three hours of every day in Türkiye — enough to leak the same-day auto-pay guard |
| Notification payloads carry a target kind and record id, never a route | A route read back from OS storage is a destination this app would follow from outside its own code; a closed union mapped in one switch is an allowlist by construction |
| PDF text is inflated with SheetJS's `CFB.utils._inflateRaw` | A `FlateDecode` stream is DEFLATE, and the project already ships an inflate for `.xlsx`; adding a PDF library would put a large parser on the most sensitive file the owner has, for one function that was already present |
| Attachment bytes never enter the sync pipeline | It carries PostgREST JSON, so a blob column would push whole documents through it and replicate every receipt to every device |
| A statement row's id is derived from the printed line, not the import run | Re-downloading and re-importing the same statement must converge; an id tied to the run doubles the ledger instead |
| A repeated statement identity is skipped, never overwritten | Overwriting discards an edit the owner made to that transaction after the first import |
| A payment TO the card is read and deliberately left out, never imported | It prints exactly like a refund, so the previous period's whole settlement was offered back as income and no total the importer produced could reconcile against the paper |
| Statement wordings are matched against the FOLDED line, never with the `i` flag | A statement is printed in capitals and Turkish dotless `ı` does not case-fold to `I`, so `/yapılan/i` is false for "YAPILAN" |
| A heading naming a concrete income source outranks the balance-column filter | `\bnet\b` classified **"Net Maaş"** — the commonest Turkish payroll heading — as a balance column, so every month's salary was dropped from the import and the chained balance ran further into the red each month |
| Balance and total columns are excluded by DEFAULT, never dropped | The parser's reading of a heading was final and invisible; a sheet whose column it misreads had no way to say otherwise, and the resulting balance had no explanation on screen |
| The workbook's opening balance is stated before it is adopted, and adopting it is a choice | It was written silently and only when earlier than the current anchor, so the first import's answer was permanent — re-importing a corrected workbook could not fix the one figure the whole chain hangs off |
| A card's two days must be one to twenty nominal days apart | Only equality was refused, so `31 / 30` — a "due date" a day before the next statement closes — was accepted; and two of the three screens that create cards applied no rule at all, so both days could be "ayın sonu" |
| The attachment sweep runs from `ui/root-lifecycle`, not `runMaintenance` | The filesystem is a native service and the data layer stays loadable — and unit-testable — without one |
| The confirmation bar is dismissible by dragging it down | It leaves on its own after six seconds, and for six seconds it sits over the bottom of whatever is being read. Down only: up is where it came from |
| The drag claims the gesture only after movement | The bar carries up to two actions, and a responder that claimed on touch-down would swallow the press that reaches them |
| A table header's pin reports its hover instead of painting one | react-native-web's `Pressable` sets `contain: true`, so the inner control's hover ENDS the header's; the pin lit a 24px strip inside a column that had gone dark |
| The pin stays a SIBLING of the header's pressable, never a child | Nesting was tried to inherit the hover and produced `nested-interactive` — a button inside a button, which axe fails and assistive technology cannot reach reliably. It also did not work: `contain: true` ends the outer hover on entry whether the inner control is a child or a sibling |
| Mark slots are named for their hue, not for a meaning | The four names are the owner's and are editable account-wide, so a slot called `success` that someone renamed "Ödenmedi" would be a lie in the column |
| A retired mark slot is still readable, never dropped | A mark that stops resolving is invisible, not broken: the cell simply loses a colour the owner put there, with nothing to notice |
| The mark fill is 35%, chosen by ΔE rather than by eye | At 15% the four hues measured 2.7 ΔE apart — four washes nobody could tell apart, which is what "renkler stabil değil" was |
| A server constraint that retires a vocabulary EXPANDS first and contracts later | The check and the client ship at different moments and a stale tab is a second client. A push Postgres refuses throws for the whole batch, so one rejected colour would stop that device syncing anything at all — the retired names stay legal until no client can still write them |
| The push mutation gate is a per-file ratchet, not an absolute score | Its 98 came from the broad inventory, whose own baseline is 79.65. Applied to whatever a push touched it measured 54.22, and a gate no change can pass is one every release routes around — the release before this one shipped from a `workflow_dispatch`, which has no `github.event.before` and so quietly ran sentinels instead |

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

**Obsidian** opens `docs/` as the vault, and the graph export lands in
`docs/graph`, so one vault holds these seven documents beside a note for every
code symbol. Measured: about twenty-five seconds of indexing on open, settling
near 700 MB resident at idle. That is the price of having the codebase
searchable next to the prose describing it, and it is why the export goes here
rather than into a second vault you switch to.

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
`docs/.obsidian` is the only vault configuration in the tree, and the files
tracked inside it are the ones that decide how the vault behaves. `app.json`
keeps `useMarkdownLinks` on and `newLinkFormat` relative, so a link Obsidian
writes stays `[text](path.md)` and still renders on GitHub, where a wikilink
would resolve for no reader at all; it also sets `trashOption` to `system` so
deleting a note leaves no `.trash/` copy in the repository. `core-plugins.json`,
`graph.json` and `appearance.json` carry the plugin and view state a fresh
clone should open with. `workspace.json` is this machine's window layout and
stays ignored. `npm run graph:refresh` rebuilds the graph, exports that note-per-symbol tree
into `docs/graph`, and deletes the `.obsidian` the exporter writes there. All
three steps matter. The export is what makes the code visible in the vault; the
deletion prevents a vault inside a vault, which Obsidian documents as
unsupported and which the exporter recreates on every run; and running it as
one command is what keeps the export level with the graph, because the
post-commit hook refreshes `graph.json` alone. `docs/graph` is ignored and
absent from a fresh clone until the script runs once. Never write in it by
hand.

## Removed after use

Features that shipped, were lived with, and were then taken out by the owner.
Recorded so the reasoning is not rediscovered as a good idea.

| Removed | Why |
|---|---|
| Duplicate review on the catch-up screen | It could not tell two identical grocery shops from one row entered twice, so every pair was a question the owner had to answer from memory anyway. `domain/provenance.ts` keeps only `provenanceOf` |
| Matching an expectation to an existing transaction | It asked "is this payment already recorded?" — a question the three controls beside it (ödendi / tutarı düzelt / atla) already answer. `expected_payments.transaction_id` is still written by `confirmExpected` |
| Investment target allocation and drift | A plan the app could only measure against BOOK cost, never market value, so the one number it reported was the one nobody could check. `investment_products.target_weight_bp` stays in the schema and is carried through writes, so an existing value and every backup round-trip unchanged |
| The monthly figure in the subscription schedule card's header | The cost card below it answered the same question from a different computation; two answers to one question, a scroll apart |

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
