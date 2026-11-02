/** Visible sync state (spec §10.3: sync errors are never swallowed silently). */

import { create } from "zustand";

type SyncState = "idle" | "syncing" | "attention" | "error" | "unconfigured";

export function completedSyncState(deadLetterCount: number): SyncState {
  return deadLetterCount > 0 ? "attention" : "idle";
}

/** What a failed token refresh actually means. */
export type RefreshOutcome = "refreshed" | "expired" | "unavailable";

/**
 * Only an answer from the auth service can retire a session: a refresh that never arrived says nothing about
 * it, and calling it "signed out" would stop the retry backoff. Transport failures are `unavailable`; any
 * other answer is a real refusal, `expired`, not retried against a dead session.
 */
export function classifyRefreshFailure(error: unknown): Exclude<RefreshOutcome, "refreshed"> {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /retryable|network|fetch|timeout|timed out|offline|abort|socket|econn|dns|502|503|504/i.test(text)
    ? "unavailable"
    : "expired";
}

/** Unfiltered: the database holds one account and the table has no user_id. */
export const DEAD_LETTER_COUNT_SQL = "SELECT COUNT(*) AS count FROM sync_dead_letters";

/**
 * What the server does not hold yet: the queue and the quarantine. A quarantined row left the outbox but never
 * reached the server, so a sign-out or a freeze that counted the outbox alone wiped it unasked (spec §10.2).
 */
export const UNSYNCED_COUNT_SQL = "SELECT (SELECT COUNT(*) FROM outbox) + (SELECT COUNT(*) FROM sync_dead_letters) AS count";

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
