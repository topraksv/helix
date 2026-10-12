/**
 * Account freeze lifecycle: mark the account frozen, prove that reached the
 * cloud, then end the session so every device lands on the reactivation gate.
 * The flag is persisted before the network work, so any failure afterwards,
 * returned or thrown, has to put it back.
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
  onPhase?: (phase: AccountFreezePhase) => void;
}

export type AccountFreezePhase =
  | "marking"
  | "syncing"
  | "signing-out"
  | "rolling-back"
  | "complete";

type AccountFreezeOutcome =
  /** Frozen and signed out; every device will show the reactivation gate. */
  | { status: "frozen" }
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
    effects.onPhase?.("rolling-back");
    await effects.setFrozen(false);
    effects.scheduleSync();
    return { status: "failed", reason, message, rolledBack: true };
  } catch {
    return { status: "failed", reason, message, rolledBack: false };
  }
}

export async function performAccountFreeze(effects: AccountFreezeEffects): Promise<AccountFreezeOutcome> {
  try {
    effects.onPhase?.("marking");
    await effects.setFrozen(true);

    // Freezing is only meaningful once the flag — and every unsynced row it is
    // supposed to protect — is on the server. A push that "succeeded" while
    // rows remain queued has not achieved that.
    effects.onPhase?.("syncing");
    const synced = await effects.syncNow();
    if (!synced || (await effects.pendingOutboxCount()) > 0) {
      return await abandonFreeze(effects, "sync", null);
    }

    effects.onPhase?.("signing-out");
    const signOutError = await effects.signOut();
    if (signOutError) return await abandonFreeze(effects, "sign-out", signOutError);

    effects.onPhase?.("complete");
    return { status: "frozen" };
  } catch (error) {
    return await abandonFreeze(effects, "unexpected", error instanceof Error ? error.message : String(error));
  }
}
