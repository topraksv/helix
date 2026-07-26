# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

Phase 2 package P1 is merged, web-deployed, published to the `preview` EAS
channel and owner-accepted. Do not begin the next package until the owner starts
it.

### P1 — visual identity and loading feedback

- Three warm palettes (Kil, Kum and Tarçın) share the existing semantic colour
  roles. The device-local preference is resolved before the app renders, and
  the settings selector is the new surface protected by
  `PHASE2_FLAGS.palettes`.
- Existing loading feedback now has one 350 ms visibility threshold. Short
  operations remain quiet; visible operations show their name, data-safety
  message, optional caller-owned phase progress and an immediate cancel action.
- Import progress belongs to the import wizard's four user-facing phases;
  restore progress belongs to its three phases. Database and repository writes
  carry no UI progress parameters.
- Cancellation remains `AbortController` based. JSON restore checks the signal
  inside its atomic transaction; stale reports and cleanup are guarded by
  controller identity. Stall detection, retry state and their dead warning
  token were removed.
- The three settings waits use the shared loading primitive. The existing
  primitive refinements have no separate rollout flag: the P1 merge revert is
  their rollback boundary.

The simplification is intentional. Retry duplicated the initiating action,
stall state delayed cancellation, and row-based progress exposed an
implementation unit rather than the user's operation phases.

## Validation

- Final `npm run verify:release` passed: typecheck, zero-warning lint, **70
  Vitest files / 559 tests**, production export budgets and **40 Playwright
  tests**.
- PR #72 `quality` passed, then the protected `main` release repeated the full
  gate successfully.
- All **23 visual baselines** remained unchanged; no actual/diff evidence was
  produced.
- With `PHASE2_FLAGS.palettes` temporarily set to `false`, `npm run verify`
  passed with **70 files / 559 tests**. The flag was restored to `true`.
- The owner interactively tested and accepted P1. The current palette colours
  and names are not the desired final choices, but the accepted structure makes
  that a palette-value and label change rather than another theme redesign.

## Not yet proven

- No physical iOS or Android acceptance was run for palette persistence,
  startup theme resolution or cancellation.
- The fresh P1 OTA has no recorded installs yet. Expo Go can exercise the P1 UI
  through a development server, but it does not consume the runtime `1.0.0`
  `preview` channel; installed OTA delivery still needs the preview build and
  two cold starts.
- Once the atomic Excel repository commit begins, it is deliberately not
  interruptible; cancellation is available around the caller-owned phases and
  the all-or-nothing data invariant remains authoritative.

## Delivery and rollback evidence

- P1 merged through PR #72 as `73e8477`. GitHub reports the squash commit's
  signature as verified; its parent is `75e42c2`.
- Pages run `30196865809` passed `quality` and deployed the production
  artefact. Root, Upcoming and Settings returned 200; the dynamic
  `/cash-flow/2026-07` route returned the expected 404 with a body identical to
  the root shell, and its entry JavaScript asset returned 200.
- Preview OTA group `0610a0a0-e3fb-4eaa-9f07-f975b6e74a34` was published from
  the clean P1 app commit `73e8477` for runtime `1.0.0`: Android
  `019f9dea-4ce0-7eaf-b7ab-9ba6fd001a44`, iOS
  `019f9dea-4ce0-730d-8b35-a6039bdc9f71`.
- The `preview` channel still has one unconditional mapping to the `preview`
  branch, and both updates report the expected commit with
  `isGitWorkingTreeDirty=false`. Initial insights are 0 installs, 0 failed
  installs and 0% crash rate on both platforms; this proves publication, not
  installed delivery.
- Rollback is a protected revert of `73e8477`; `75e42c2` is the pre-P1 main
  anchor.

## Next package

Follow the execution order and device rule in the current Phase 2 contract.
Do not redesign the palette mechanism when revisiting colours and names.

## Next exact step

`NEXT EXACT STEP = owner checks P1 through Expo Go and, separately, verifies the preview OTA with two cold starts; do not begin another package until explicitly requested.`
