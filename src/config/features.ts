/**
 * Phase 2 rollout flags.
 *
 * One boolean per user-visible Phase 2 surface, so a feature can be taken back
 * out without reverting a merge. The branch belongs at the MOUNT POINT only —
 * a route registration, a tab entry, a card's render. A flag that reaches a
 * repository, a domain calculation or a sync path is a bug: the write path must
 * behave identically whether or not the surface is shown, or turning a flag off
 * leaves rows nothing can read.
 *
 * A flag is deleted once its package has shipped and been accepted on a device.
 * Dead flags are worse than no flags.
 *
 * Scope, ordering and the rest of the rollback contract: `docs/PHASE2.md`.
 */

export type Phase2Flag =
  | "palettes"
  | "glassTabBar"
  | "privacyPeek"
  | "extendedCurrencies"
  | "scenarioLab"
  | "investments"
  | "receiptVault"
  | "sharedLists"
  | "tourV2";

/** Not `as const`: these are switches, and literal `false` would narrow every guarded branch to dead code. */
export const PHASE2_FLAGS: Record<Phase2Flag, boolean> = {
  palettes: false,
  glassTabBar: false,
  privacyPeek: false,
  extendedCurrencies: false,
  scenarioLab: false,
  investments: false,
  receiptVault: false,
  sharedLists: false,
  tourV2: false,
};
