/** Visible sync state (spec §5: sync errors are never swallowed silently). */

import { create } from "zustand";

type SyncState = "idle" | "syncing" | "attention" | "error" | "unconfigured";

export function completedSyncState(deadLetterCount: number): SyncState {
  return deadLetterCount > 0 ? "attention" : "idle";
}

/** What a failed token refresh actually means. */
export type RefreshOutcome = "refreshed" | "expired" | "unavailable";

/**
 * Only an answer FROM the auth service can retire a session.
 *
 * A refresh that fails because the request never arrived says nothing about the
 * session: the refresh token may be perfectly good and the device simply
 * offline. Collapsing both into "signed out" told a user in a tunnel to sign in
 * again — at a login screen they cannot reach either — and stopped the retry
 * backoff that would otherwise have recovered on its own. Anything that looks
 * like transport is `unavailable`; everything else is a real refusal and is
 * treated as `expired` rather than retried against a dead session forever.
 *
 * Lives here, beside `completedSyncState`, because `engine.ts` imports React
 * Native and cannot be loaded by the unit runner.
 */
export function classifyRefreshFailure(error: unknown): Exclude<RefreshOutcome, "refreshed"> {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /retryable|network|fetch|timeout|timed out|offline|socket|econn|dns|502|503|504/i.test(text)
    ? "unavailable"
    : "expired";
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
  /** When a pull last replaced rows this device already had, so the UI can say
   *  so once. Null until it happens; reset with the account. */
  remoteChangeAt: string | null;
  set: (patch: Partial<Omit<SyncStatusStore, "set">>) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: "idle",
  lastSyncAt: null,
  error: null,
  remoteChangeAt: null,
  set: (patch) => set(patch),
}));
