/** Visible sync state (spec §5: sync errors are never swallowed silently). */

import { create } from "zustand";

type SyncState = "idle" | "syncing" | "attention" | "error" | "unconfigured";

export function completedSyncState(deadLetterCount: number): SyncState {
  return deadLetterCount > 0 ? "attention" : "idle";
}

/**
 * Quarantine count feeding `completedSyncState`. Deliberately unfiltered: the
 * local database holds exactly one account (`resetLocalWorkspace` wipes every
 * synced table, the outbox and this one when a different account signs in) and
 * `sync_dead_letters` has no `user_id` column.
 *
 * A `WHERE user_id = ?` predicate lived here and threw "no such column" AFTER a
 * successful push+pull, so every healthy sync was reported as an error:
 * `lastSyncAt` never advanced, the backoff retried forever, `syncNow` always
 * resolved `false` and account freeze could never complete. It lives beside the
 * state it feeds — and outside `engine.ts`'s React Native imports — so
 * `tests/sync-dead-letters.test.ts` can execute it against the real schema.
 */
export const DEAD_LETTER_COUNT_SQL = "SELECT COUNT(*) AS count FROM sync_dead_letters";

interface SyncStatusStore {
  state: SyncState;
  lastSyncAt: string | null;
  error: string | null;
  set: (patch: Partial<Omit<SyncStatusStore, "set">>) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: "idle",
  lastSyncAt: null,
  error: null,
  set: (patch) => set(patch),
}));
