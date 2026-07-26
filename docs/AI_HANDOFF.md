# Helix AI handoff

Short-lived state only. Git and the working tree win. Stable rules belong in
[`AGENTS.md`](../AGENTS.md); architecture, tests, release, security and privacy
facts belong in their canonical documents. Replace this file; never append a
history log.

## Current state — 2026-07-26, Europe/Istanbul

Phase 2 package P1 is implemented on `phase-2/p1-gorsel-imza` and is awaiting
the required pull-request quality gate and owner merge approval.

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
- All **23 visual baselines** remained unchanged; no actual/diff evidence was
  produced.
- With `PHASE2_FLAGS.palettes` temporarily set to `false`, `npm run verify`
  passed with **70 files / 559 tests**. The flag was restored to `true`.

## Not yet proven

- No physical iOS or Android acceptance was run for palette persistence,
  startup theme resolution or cancellation.
- Once the atomic Excel repository commit begins, it is deliberately not
  interruptible; cancellation is available around the caller-owned phases and
  the all-or-nothing data invariant remains authoritative.
- The required pull-request `quality` check and owner merge approval are still
  pending.

## Open items and next package

- P1 must remain unmerged until the owner reviews the pull request and its
  required check.
- After P1 is merged, the next package is **P2 — navigation shell**. Start with
  its design gate and current Phase 2 contract; do not carry forward an older
  scope note.

## Next exact step

`NEXT EXACT STEP = open the P1 pull request, wait for the required quality check, and stop for owner approval without merging.`
