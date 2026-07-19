/**
 * Account freeze lifecycle: mark the account frozen, prove that decision
 * actually reached the cloud, then end the session so every device lands on
 * the reactivation gate.
 *
 * This lives outside the screen because the FAILURE path is the whole problem.
 * The flag is persisted before the network work, so anything that goes wrong
 * afterwards — a returned error or a thrown one — has to put it back. When the
 * screen owned this inline, only the happy path and two returned-error paths
 * cleaned up: a rejection from the sync, the outbox read or the sign-out
 * escaped into a floating promise, leaving the account persisted as frozen and
 * the session's `isFreezing` flag stuck on. That flag suppresses the
 * reactivation gate, so the user saw a button that did nothing, no error, and a
 * locked app on the next launch.
 */

export interface AccountFreezeEffects {
  /** Persist the synced `account_frozen` setting. */
  setFrozen: (frozen: boolean) => Promise<void>;
  /** Push now; false means the account's rows did not reach the server. */
  syncNow: () => Promise<boolean>;
  /** Rows still queued locally after a "successful" push. */
  pendingOutboxCount: () => Promise<number>;
  /** Returns an error message, or null when the session ended. */
  signOut: () => Promise<string | null>;
  scheduleSync: () => void;
  /** False for a local-only workspace: there is no cloud to confirm against. */
  requiresCloud: boolean;
}

export type AccountFreezeOutcome =
  /** Frozen and signed out; every device will show the reactivation gate. */
  | { status: "frozen" }
  /** Local-only workspace: flagged and queued, the session stays open. */
  | { status: "local" }
  /**
   * Nothing was frozen. `rolledBack` reports whether the local flag was
   * actually restored — if even that failed the account is still marked
   * frozen locally and the caller must say so rather than imply success.
   */
  | { status: "failed"; reason: "sync" | "sign-out" | "unexpected"; message: string | null; rolledBack: boolean };

async function abandonFreeze(
  effects: AccountFreezeEffects,
  reason: "sync" | "sign-out" | "unexpected",
  message: string | null,
): Promise<AccountFreezeOutcome> {
  // The rollback itself runs in the same degraded conditions that caused the
  // failure, so it may fail too. Report the ORIGINAL reason either way; a
  // rollback error must never replace the explanation the user needs.
  try {
    await effects.setFrozen(false);
    effects.scheduleSync();
    return { status: "failed", reason, message, rolledBack: true };
  } catch {
    return { status: "failed", reason, message, rolledBack: false };
  }
}

export async function performAccountFreeze(effects: AccountFreezeEffects): Promise<AccountFreezeOutcome> {
  try {
    await effects.setFrozen(true);

    if (!effects.requiresCloud) {
      effects.scheduleSync();
      return { status: "local" };
    }

    // Freezing is only meaningful once the flag — and every unsynced row it is
    // supposed to protect — is on the server. A push that "succeeded" while
    // rows remain queued has not achieved that.
    const synced = await effects.syncNow();
    if (!synced || (await effects.pendingOutboxCount()) > 0) {
      return await abandonFreeze(effects, "sync", null);
    }

    const signOutError = await effects.signOut();
    if (signOutError) return await abandonFreeze(effects, "sign-out", signOutError);

    return { status: "frozen" };
  } catch (error) {
    return await abandonFreeze(effects, "unexpected", error instanceof Error ? error.message : String(error));
  }
}
