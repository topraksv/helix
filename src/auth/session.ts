/**
 * Auth session store. Fully offline-capable: the last signed-in user id is
 * persisted locally, so the app opens and works without network; Supabase
 * session refresh happens opportunistically in the background. Biometric
 * lock (not network auth) protects local data (spec §10.2).
 */

import { create } from "zustand";
import { createRecoveryClient, getSupabase, isSupabaseConfigured, subscribeSupabaseAuthEvents } from "../sync/supabase";
import { pendingOutboxCount, resetLocalWorkspace, writeSetting } from "../db/mutations";
import { eraseDeviceAttachments, flushOutbox, purgeRemoteAttachments, reconcileAttachments, runSyncSessionTask, startSyncSession, stopSyncSession, unsentAttachments } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { connectMarkets, disconnectMarkets } from "../services/markets";
import { clearRateCache, loadRateCache } from "../services/fx-fetch";
import { clearAccountNotifications, rescheduleAll } from "../services/notifications";
import { kv } from "../services/kv";
import { tr } from "../i18n/tr";
import { friendlyAuthError } from "./auth-errors";
import { requestPasswordRecoveryEmail, resendSignUpConfirmation } from "./email-flows";
import { pendingChangesWouldBeLost, signOutWithLocalFallback } from "./sign-out";
import { loadPreviousLogin, recordSuccessfulLogin, startLoginHistory } from "./login-history";
import { LOCAL_ONLY_USER_ID } from "../domain/user-id";
import { resetDiagnosticUploads } from "../services/diagnostics";
import {
  IDLE_BRAKE,
  isVerificationBlocked,
  recordVerificationFailure,
  recordVerificationSuccess,
  type VerificationBrake,
} from "./verification-brake";
import { isValidNewPassword } from "../domain/input";

/** Owner-keyed brake on password verification — see verification-brake.ts. */
let verificationBrake: VerificationBrake = IDLE_BRAKE;
let authLifecycleSubscribed = false;
let explicitSignOutInProgress = false;
let invalidationCleanup: Promise<void> | null = null;
/**
 * The account whose opening this launch has already counted. A remount runs
 * bootstrap again, and after a sign-in it would otherwise record the sign-in a
 * moment ago as "the previous one".
 */
let openingCountedFor: string | null = null;
/** A reset code already checked, kept until its password is saved or another code is asked for. */
let verifiedReset: { email: string; client: NonNullable<ReturnType<typeof createRecoveryClient>> } | null = null;

/** The codes of the change last asked for that Auth has taken: each is spent once checked. */
let acceptedChange: { email: string; accepted: EmailChangeAnswer["accepted"] } | null = null;

/** A refused code reads as one, unless the request never reached Auth or hit its rate limit. */
function codeRefusal(error: { name?: string; message: string } | null): string {
  if (!error) return tr.auth.errCode;
  return error.name === "AuthRetryableFetchError" || /rate limit|too many|only request this after/i.test(error.message)
    ? friendlyAuthError(error.message)
    : tr.auth.errCode;
}

/**
 * Sign-out refused because rows or documents would be lost. Safe to show
 * as-is — it names the outcome, not the machinery — and identity-comparable so
 * the caller can offer "sign out anyway" instead of treating it as a failure.
 */
export const SIGN_OUT_PENDING_CHANGES = tr.auth.signOutPendingBlocked;
/** `deleteAccount` stopped because documents would outlive the account. */
export const DELETE_DOCUMENTS_REMAIN = tr.account.deleteDocumentsTitle;

const LAST_USER_KEY = "helix.last_user_id";
/** Signed-in e-mail, persisted so an offline bootstrap can still re-auth. */
const LAST_EMAIL_KEY = "helix.last_email";
/** Owner of the data currently in the local DB (for account-switch detection). */
const LOCAL_OWNER_KEY = "helix.local_owner";
/** A failed invalidation wipe must be retried even if the same account returns. */
const LOCAL_WIPE_PENDING_OWNER = "__helix_wipe_pending__";
/** Entry-form defaults (`helix.last.<type>`) hold ids that exist only in one account's workspace; `tests/domain/privacy.test.ts` checks the list against the writer. */
const ENTRY_DEFAULT_KEYS = ["helix.last.income", "helix.last.expense", "helix.last.transfer"];

/** Matrix pins are column keys built from category ids, so they too belong to one account; `helix.matrix.pinned` is the pre-split key a device may still hold. */
const MATRIX_PIN_KEYS = ["helix.matrix.pinned", "helix.matrix.pinned.rows", "helix.matrix.pinned.columns"];

/** Device-local state that belongs to the account: the sync banner would show the previous account's failure until the next first sync. Reset with the workspace, not after it. */
async function clearAccountScopedDeviceState(): Promise<void> {
  useSyncStatus.getState().set({ state: "idle", lastSyncAt: null, error: null, remoteChangeAt: null });
  // The diagnostics watermark is per account: kept, the next owner would skip every incident recorded before they signed in.
  await resetDiagnosticUploads();
  await Promise.all(
    [...ENTRY_DEFAULT_KEYS, ...MATRIX_PIN_KEYS].map((key) => kv.remove(key).catch(() => {})),
  );
}

/**
 * Remove a Supabase session that does not belong to the open workspace.
 * Suppressing the ordinary SIGNED_OUT cleanup is load-bearing: that listener
 * owns full workspace erasure, while this path must discard only the foreign
 * bearer session and preserve the current user's offline rows.
 */
async function discardForeignSupabaseSession(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) await endAuthSession(supabase, "local");
}

/** Signs out with the flag up, so the SIGNED_OUT listener leaves the workspace alone. */
async function endAuthSession(supabase: NonNullable<ReturnType<typeof getSupabase>>, scope: "local" | "global"): Promise<void> {
  explicitSignOutInProgress = true;
  try {
    await signOutWithLocalFallback((options) => supabase.auth.signOut(options), scope);
  } finally {
    explicitSignOutInProgress = false;
  }
}

async function forgetAccount(): Promise<void> {
  for (const key of [LOCAL_OWNER_KEY, LAST_USER_KEY, LAST_EMAIL_KEY]) await kv.remove(key).catch(() => {});
}

/**
 * Ensure the local DB belongs to `userId`. If a different account previously
 * used this device, wipe the local workspace so its rows never sync under the
 * new session; the cloud re-hydrates the incoming account's data on next pull.
 * Returns a user-facing error when the wipe fails — the sign-in must NOT
 * proceed then, or the previous account's data would remain readable (and the
 * owner marker would go stale).
 */
async function ensureWorkspaceFor(userId: string): Promise<string | null> {
  // Read, write and verify: this marker is the only record that the wipe happened. A failed read must not
  // pass for "no previous owner", the answer that skips the wipe and hands the previous account's rows on.
  let owner: string | null;
  try {
    owner = await kv.get(LOCAL_OWNER_KEY);
  } catch {
    return tr.errors.workspaceOwnerUnrecorded;
  }
  if (owner && owner !== userId) {
    await stopSyncSession();
    disconnectMarkets();
    clearRateCache();
    await clearAccountNotifications(true).catch(() => {});
    await clearAccountScopedDeviceState();
    try {
      await resetLocalWorkspace();
    } catch {
      return tr.errors.workspaceResetFailed;
    }
  }
  if (owner !== userId) {
    // `kv` drops a write the browser refuses, so prove the marker landed and refuse the sign-in as a failed wipe does.
    const recorded = await kv
      .set(LOCAL_OWNER_KEY, userId)
      .then(() => kv.get(LOCAL_OWNER_KEY))
      .catch(() => null);
    if (recorded !== userId) return tr.errors.workspaceOwnerUnrecorded;
  }
  return null;
}

/**
 * The signed-out state, then this device's documents erased.
 *
 * Before any key removal: an emptied workspace under a live user id reads as
 * "setup never finished", and the route guard sends the user to Quick Start
 * instead of sign-in. The documents go with the session because their bytes
 * live beside the database the wipe empties, and the prune that removes orphans
 * runs only for an open session — a signed-out device kept every receipt
 * readable until somebody next signed in.
 */
async function endLocalSession(): Promise<void> {
  useSession.setState({ userId: null, email: null, isOnlineSession: false, isNewSignup: false, isFreezing: false, previousLoginAt: null });
  await eraseDeviceAttachments();
}

/** A revoked/deleted remote session must stop exposing its cached workspace
 * once Supabase reports SIGNED_OUT. Network failure does not emit this event,
 * so ordinary offline access remains intact. The captured owner checks keep a
 * late A event from clearing a newly active B session. */
async function clearInvalidatedSession(): Promise<void> {
  const userId = useSession.getState().userId;
  if (!userId || explicitSignOutInProgress) return;
  await stopSyncSession(userId);
  if (useSession.getState().userId !== userId) return;
  disconnectMarkets();
  clearRateCache();
  await clearAccountNotifications(true).catch(() => {});
  await clearAccountScopedDeviceState();
  try {
    await resetLocalWorkspace();
  } catch {
    // Keep a non-user owner marker so BOTH a different account and this same
    // account must retry the wipe before any cached rows can be reopened.
    await kv.set(LOCAL_OWNER_KEY, LOCAL_WIPE_PENDING_OWNER).catch(() => {});
  }
  if (useSession.getState().userId !== userId) return;
  // Whether or not the rows were wiped: a retried wipe does not need the
  // documents, and nobody is signed in to read them.
  await endLocalSession();
  await kv.remove(LAST_USER_KEY);
  await kv.remove(LAST_EMAIL_KEY);
}

function ensureAuthLifecycleSubscription(): void {
  if (authLifecycleSubscribed || !isSupabaseConfigured) return;
  authLifecycleSubscribed = true;
  subscribeSupabaseAuthEvents((event) => {
    if (event !== "SIGNED_OUT" || explicitSignOutInProgress || invalidationCleanup) return;
    // Supabase warns against awaiting other auth operations inside its callback.
    // Defer the workspace cleanup and serialize repeated SIGNED_OUT events.
    queueMicrotask(() => {
      if (invalidationCleanup || explicitSignOutInProgress) return;
      invalidationCleanup = clearInvalidatedSession().finally(() => {
        invalidationCleanup = null;
      });
    });
  });
}

interface SessionStore {
  userId: string | null;
  /** Signed-in account e-mail (for re-auth prompts and the account screen). */
  email: string | null;
  ready: boolean;
  isOnlineSession: boolean;
  /** True only for the session created by a fresh sign-UP (no cloud data to
   *  pull) so the route guard sends it straight to onboarding instead of
   *  holding for a first pull. Sign-in / bootstrap clear it. */
  isNewSignup: boolean;
  /** Set while a "freeze" is in progress (write flag → push → sign out) so the
   *  guard doesn't flash the frozen gate on the initiating device. */
  isFreezing: boolean;
  /** Login before the current successful session; never the current start. */
  previousLoginAt: string | null;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  /** Send a neutral, expiring password-reset code. */
  requestPasswordReset: (email: string) => Promise<string | null>;
  /** Send a new sign-up code; the last one lives five minutes. */
  resendSignUpConfirmation: (email: string) => Promise<string | null>;
  /** The code the confirmation e-mail carries, which opens the new account here. */
  confirmSignUp: (email: string, code: string) => Promise<string | null>;
  /** The reset e-mail's code and the new password; signs nobody in here. */
  resetPassword: (email: string, code: string, newPassword: string) => Promise<string | null>;
  /** End the session on THIS device and wipe its local finance data. Returns an
   *  error if the wipe failed or if unsynced rows would be destroyed
   *  (`SIGN_OUT_PENDING_CHANGES`); in both cases the session stays active. Pass
   *  `force` once the user has accepted losing those rows. */
  signOut: (options?: { force?: boolean }) => Promise<string | null>;
  /** Permanently delete all data (cloud + this device) and sign out. Returns a
   *  user-facing error string when the cloud wipe could not complete, or
   *  `DELETE_DOCUMENTS_REMAIN` when the stored documents could not be erased;
   *  pass `force` once the user has accepted leaving them behind. */
  deleteAccount: (options?: { force?: boolean }) => Promise<string | null>;
  /** Re-authenticate the current account to confirm a sensitive action
   *  (delete / freeze / credential change). Returns null when the password is
   *  correct, otherwise a user-facing error — including a local cooldown
   *  after repeated failures, since every attempt is a real sign-in that
   *  counts against Supabase's shared login rate limit. */
  verifyPassword: (password: string) => Promise<string | null>;
  /** Mails a code to the current address and one to the new; the change waits for both. */
  changeEmail: (newEmail: string) => Promise<string | null>;
  /** Checks the two codes `changeEmail` mailed; a code already accepted is not asked again. */
  confirmEmailChange: (newEmail: string, codes: EmailChangeCodes) => Promise<EmailChangeAnswer>;
  /** Set a new password (the session is fresh from a prior verifyPassword).
   *  Returns an error string, or null on success. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}

/** The code mailed to the address now on the account, and the one mailed to the address it moves to. */
export type EmailChangeCodes = { current: string; next: string };
/** No error is the change made; otherwise which codes Auth has already taken. */
export type EmailChangeAnswer = { error: string | null; accepted: Record<keyof EmailChangeCodes, boolean> };

type SignUpResult =
  | { status: "signed-in" }
  | { status: "confirmation-required" }
  | { status: "error"; message: string };

/**
 * A first session for an account just made, from sign-up or its code. A
 * brand-new account has no cloud data to pull, so it goes straight to
 * onboarding (`isNewSignup`), skipping the "await first pull" hold used for
 * existing accounts syncing onto a fresh device.
 */
async function openNewAccount(
  supabase: NonNullable<ReturnType<typeof getSupabase>>,
  user: { id: string; email?: string },
  email: string,
): Promise<string | null> {
  const wsError = await ensureWorkspaceFor(user.id);
  if (wsError) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return wsError;
  }
  await kv.set(LAST_USER_KEY, user.id).catch(() => {});
  await kv.set(LAST_EMAIL_KEY, user.email ?? email.trim()).catch(() => {});
  openingCountedFor = user.id;
  await startLoginHistory(kv, user.id, new Date().toISOString()).catch(() => {});
  startSyncSession(user.id);
  useSession.setState({ userId: user.id, email: user.email ?? email.trim(), isOnlineSession: true, isNewSignup: true, previousLoginAt: null });
  return null;
}

export const useSession = create<SessionStore>((set, get) => ({
  userId: null,
  email: null,
  ready: false,
  isOnlineSession: false,
  isNewSignup: false,
  isFreezing: false,
  previousLoginAt: null,

  bootstrap: async () => {
    ensureAuthLifecycleSubscription();
    if (!isSupabaseConfigured) {
      const wsError = await ensureWorkspaceFor(LOCAL_ONLY_USER_ID);
      if (wsError) {
        set({ userId: null, ready: true, isOnlineSession: false });
        return;
      }
      startSyncSession(LOCAL_ONLY_USER_ID);
      set({ userId: LOCAL_ONLY_USER_ID, ready: true, isOnlineSession: false });
      return;
    }
    const supabase = getSupabase()!;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        const wsError = await ensureWorkspaceFor(data.session.user.id);
        if (wsError) {
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          set({ userId: null, ready: true, isOnlineSession: false });
          return;
        }
        await kv.set(LAST_USER_KEY, data.session.user.id).catch(() => {});
        if (data.session.user.email) {
          await kv.set(LAST_EMAIL_KEY, data.session.user.email).catch(() => {});
        }
        // Every opening counts, not only a password sign-in: the session
        // refreshes itself, so counting sign-ins alone left the dashboard's
        // "previous sign-in" on one date for months.
        const countOpening = openingCountedFor !== data.session.user.id;
        openingCountedFor = data.session.user.id;
        const previousLoginAt = await (countOpening
          ? recordSuccessfulLogin(kv, data.session.user.id, new Date().toISOString())
          : loadPreviousLogin(kv, data.session.user.id)
        ).catch(() => null);
        startSyncSession(data.session.user.id);
        set({ userId: data.session.user.id, email: data.session.user.email ?? null, ready: true, isOnlineSession: true, isNewSignup: false, previousLoginAt });
        return;
      }
    } catch {
      // offline — fall through to the persisted user id
    }
    const lastUser = await kv.get(LAST_USER_KEY);
    if (lastUser) {
      const wsError = await ensureWorkspaceFor(lastUser);
      if (wsError) {
        set({ userId: null, ready: true, isOnlineSession: false, isNewSignup: false, previousLoginAt: null });
        return;
      }
    }
    const previousLoginAt = lastUser ? await loadPreviousLogin(kv, lastUser) : null;
    const lastEmail = lastUser ? await kv.get(LAST_EMAIL_KEY) : null;
    if (lastUser) startSyncSession(lastUser);
    set({ userId: lastUser, email: lastEmail, ready: true, isOnlineSession: false, isNewSignup: false, previousLoginAt });
  },

  signIn: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return friendlyAuthError(error.message);
    const wsError = await ensureWorkspaceFor(data.user.id);
    if (wsError) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return wsError;
    }
    // Past this line the account is authenticated and the workspace is proven
    // its own. Everything below is device-local convenience — who to re-open
    // offline, and a timestamp to show — so a store that refuses it costs a
    // convenience, never the session that was just granted. Before these
    // guards a keychain error surfaced as the sign-in screen's generic "istek
    // basarisiz", which refused an account that had in fact signed in, blamed
    // the wrong thing, and failed identically on every retry.
    await kv.set(LAST_USER_KEY, data.user.id).catch(() => {});
    await kv.set(LAST_EMAIL_KEY, data.user.email ?? email).catch(() => {});
    openingCountedFor = data.user.id;
    const previousLoginAt = await recordSuccessfulLogin(
      kv,
      data.user.id,
      data.user.last_sign_in_at ?? new Date().toISOString(),
    ).catch(() => null);
    // Signing in IS the password check, so it unfreezes a frozen account: clear
    // the synced flag (a newer LWW write than the freeze) so the reactivation
    // gate never reappears after a successful login.
    await writeSetting(data.user.id, "account_frozen", false).catch(() => {});
    startSyncSession(data.user.id);
    set({ userId: data.user.id, email: data.user.email ?? email, isOnlineSession: true, isNewSignup: false, previousLoginAt });
    return null;
  },

  signUp: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return { status: "error", message: tr.errors.supabaseNotConfigured };
    if (!isValidNewPassword(password)) return { status: "error", message: tr.auth.errWeakPassword };
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { status: "error", message: friendlyAuthError(error.message) };
    if (!data.user) return { status: "error", message: tr.errors.signUpFailed };
    // With e-mail confirmation enabled Supabase deliberately returns no
    // bearer session. Do not create an offline workspace under an identity the
    // device cannot authenticate yet; the confirmed sign-in owns that step.
    if (!data.session) return { status: "confirmation-required" };
    const wsError = await openNewAccount(supabase, data.user, email);
    return wsError ? { status: "error", message: wsError } : { status: "signed-in" };
  },

  confirmSignUp: async (email, code) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    // "signup", not "email": Auth takes a reset code as "email" too, which would
    // open an existing account here as a new one.
    const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "signup" });
    if (error || !data.user) return codeRefusal(error);
    return openNewAccount(supabase, data.user, email);
  },

  requestPasswordReset: async (email) => {
    const client = createRecoveryClient();
    if (!client) return tr.errors.supabaseNotConfigured;
    // A refused resend leaves the sent code standing, and the session it opened with it.
    const refused = await requestPasswordRecoveryEmail(client.auth, email);
    if (!refused) verifiedReset = null;
    return refused;
  },

  resendSignUpConfirmation: async (email) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    return resendSignUpConfirmation(supabase.auth, email);
  },

  resetPassword: async (email, code, newPassword) => {
    if (!isValidNewPassword(newPassword)) return tr.auth.errWeakPassword;
    const address = email.trim();
    // On a client of its own: the code opens a session for the account it
    // resets, which need not be the one this device is signed in with. Kept
    // past a refused save, since the code is spent once checked.
    let client = verifiedReset?.email === address ? verifiedReset.client : null;
    if (!client) {
      client = createRecoveryClient();
      if (!client) return tr.errors.supabaseNotConfigured;
      const { error } = await client.auth.verifyOtp({ email: address, token: code, type: "recovery" });
      if (error) return codeRefusal(error);
      verifiedReset = { email: address, client };
    }
    const { error: refused } = await client.auth.updateUser({ password: newPassword });
    if (refused) return friendlyAuthError(refused.message);
    verifiedReset = null;
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    // A new password ends the account's other sessions, this device's among
    // them: its next refresh would fail and wipe the workspace, so it signs in again now.
    // `email` is set only while signed in, so it alone says whose device this is.
    const signedIn = get().email;
    if (signedIn?.toLowerCase() !== address.toLowerCase()) return null;
    // The code is spent and the password saved: a retry would only be told the code is wrong.
    return (await get().signIn(signedIn, newPassword)) ? tr.auth.passwordResetSignInAgain : null;
  },

  signOut: async (options) => {
    const userId = get().userId;
    // Unsynced rows and unsent documents only exist here. Send them first and,
    // if any survive, stop rather than delete a change the user believes is
    // saved; `force` is the caller's proof that the user was asked and
    // accepted the loss.
    if (
      userId &&
      !options?.force &&
      isSupabaseConfigured &&
      (await pendingChangesWouldBeLost({
        pendingCount: async () => (await pendingOutboxCount()) + (await unsentAttachments(userId)).count,
        flush: () => Promise.allSettled([flushOutbox(userId), reconcileAttachments(userId)]),
      }))
    ) {
      return SIGN_OUT_PENDING_CHANGES;
    }
    // Abort scheduled/network work and wait for registered maintenance tasks.
    // The database cannot be wiped while an old user task can still write.
    await stopSyncSession(userId ?? undefined);
    disconnectMarkets();
    clearRateCache();
    await Promise.all([clearAccountNotifications(true).catch(() => {}), clearAccountScopedDeviceState()]);
    // Best practice for a finance app: leave no plaintext financial data on the
    // device after an explicit sign-out. The cloud (RLS-scoped) is the source
    // of truth, so the next sign-in re-hydrates via the initial pull. Clearing
    // the owner marker keeps that first pull clean.
    try {
      await resetLocalWorkspace();
    } catch {
      if (userId) {
        // Restored as session work so stopSyncSession awaits it before another account signs in.
        startSyncSession(userId);
        connectMarkets();
        void runSyncSessionTask(userId, async () => {
          await Promise.allSettled([loadRateCache(userId), rescheduleAll(userId)]);
        });
      }
      return tr.errors.workspaceResetFailed;
    }
    // Ends the session in the same turn as the wipe, before the remote revoke
    // and the key removals below, which can take seconds on a device — that
    // window was the whole bug. Only here, past the point of no return: a failed
    // wipe above keeps the session, and a session that stays keeps its documents.
    await endLocalSession();
    const supabase = getSupabase();
    if (supabase) await endAuthSession(supabase, "local");
    await forgetAccount();
    return null;
  },

  deleteAccount: async (options) => {
    const userId = get().userId;
    if (!userId) return null;
    await stopSyncSession(userId);
    // Erase the cloud account FIRST: if it fails (offline / RPC missing), abort
    // before touching local data so we never report "deleted" while it lives on.
    //
    // We delete the auth.users identity via the delete_own_account() RPC. Its
    // ON DELETE CASCADE removes every app row in the same server-side
    // transaction. This is what actually frees the e-mail for re-registration
    // and invalidates the credentials — deleting only the app tables (the old
    // behavior) left auth.users intact, so re-signup hit "already registered"
    // and the deleted account could still sign in.
    const supabase = getSupabase();
    if (supabase) {
      // Storage has no foreign key to the account, so nothing cascades the
      // documents away, and nothing on the server repeats this removal (see
      // `purgeRemoteAttachments`). A second attempt absorbs a dropped
      // request; past that the owner decides, because a receipt left behind
      // an identity that no longer exists is theirs to accept, and an
      // unreachable file must never by itself keep an account alive.
      const purge = () => purgeRemoteAttachments(userId).catch(() => false);
      if (!((await purge()) || (await purge())) && !options?.force) {
        startSyncSession(userId);
        return DELETE_DOCUMENTS_REMAIN;
      }
      const { error } = await supabase.rpc("delete_own_account");
      if (error) {
        startSyncSession(userId);
        // An expired session gets its precise remedy; every other failure
        // (offline, RPC missing, server error) keeps the accurate "nothing
        // was deleted" message instead of a raw English engine string.
        const friendly = friendlyAuthError(error.message);
        return friendly === tr.auth.errSessionExpired ? friendly : tr.account.deleteCloudFailed;
      }
    }
    // Cloud is erased (or local-only mode): stop timers/streams, wipe the device,
    // and end the session.
    disconnectMarkets();
    clearRateCache();
    await Promise.all([clearAccountNotifications(true).catch(() => {}), clearAccountScopedDeviceState()]);
    // The revocation is a round trip and the wipe is local, so they run side by side.
    // The identity is gone, so every device's token goes with it: the one global revocation.
    const revoke = supabase ? endAuthSession(supabase, "global") : Promise.resolve();
    const [, wiped] = await Promise.all([revoke, resetLocalWorkspace().then(() => true, () => false)]);
    if (!wiped) {
      // The cloud identity is already gone, so keep the local owner marker and
      // surface an actionable error. A future account cannot open this
      // workspace: ensureWorkspaceFor will retry the wipe first.
      await kv.set(LOCAL_OWNER_KEY, LOCAL_WIPE_PENDING_OWNER).catch(() => {});
      await endLocalSession();
      await kv.remove(LAST_USER_KEY).catch(() => {});
      await kv.remove(LAST_EMAIL_KEY).catch(() => {});
      return tr.errors.workspaceResetFailed;
    }
    await endLocalSession();
    await forgetAccount();
    return null;
  },

  verifyPassword: async (password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    // The brake belongs to the account being verified. Anonymous/local-only
    // sessions have no account to rate limit, so they use a stable placeholder.
    const brakeOwner = get().userId ?? LOCAL_ONLY_USER_ID;
    if (isVerificationBlocked(verificationBrake, brakeOwner, Date.now())) return tr.auth.errRateLimit;
    // After an offline start the store has no address; Auth or the device may.
    let email = get().email;
    if (!email) {
      email = (await supabase.auth.getUser().catch(() => null))?.data.user?.email ?? (await kv.get(LAST_EMAIL_KEY).catch(() => null));
      if (!email) return tr.auth.errSessionExpired;
      set({ email });
    }
    // Re-authenticate with the current e-mail: a successful sign-in confirms
    // the password. It re-issues tokens for the same account (no identity
    // change), which is exactly the "recent login" Supabase wants before a
    // sensitive credential update.
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      if (data.user.id !== brakeOwner) {
        await stopSyncSession(brakeOwner);
        await discardForeignSupabaseSession();
        set({ isOnlineSession: false });
        return tr.auth.errSessionExpired;
      }
      verificationBrake = recordVerificationSuccess(verificationBrake, brakeOwner);
      return null;
    }
    verificationBrake = recordVerificationFailure(verificationBrake, brakeOwner, Date.now());
    // Only the password was typed here (the e-mail is the fixed current
    // account), so bad credentials get the precise message; other failures
    // (network, provider rate limit) keep their own friendly mapping.
    if (/invalid login credentials|invalid_credentials/i.test(error.message)) return tr.account.wrongPassword;
    return friendlyAuthError(error.message);
  },

  changeEmail: async (newEmail) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    // A refused resend leaves the sent codes, and the ones Auth took, standing.
    if (error) return friendlyAuthError(error.message);
    acceptedChange = null;
    return null;
  },

  confirmEmailChange: async (newEmail, codes) => {
    const supabase = getSupabase();
    const current = get().email;
    const address = newEmail.trim();
    if (acceptedChange?.email !== address) acceptedChange = { email: address, accepted: { current: false, next: false } };
    const { accepted } = acceptedChange;
    if (!supabase || !current) return { error: supabase ? tr.auth.errSessionExpired : tr.errors.supabaseNotConfigured, accepted: { ...accepted } };
    let changed = false;
    for (const side of ["next", "current"] as const) {
      if (accepted[side]) continue;
      const { data, error } = await supabase.auth.verifyOtp({ email: side === "next" ? address : current, token: codes[side], type: "email_change" });
      if (error) {
        const refused = codeRefusal(error);
        return { error: refused === tr.auth.errCode ? tr.account.emailCodeRefused[side] : refused, accepted: { ...accepted } };
      }
      accepted[side] = true;
      // Auth answers the first of the two codes with no session, so only a
      // session says the change is made; the flags are this device's memory.
      changed = Boolean(data.session);
    }
    acceptedChange = null;
    // Auth started over behind this device (a resend whose reply was lost,
    // another tab), so a code taken earlier no longer counts.
    if (!changed) return { error: tr.account.emailChangeRestarted, accepted: { current: false, next: false } };
    set({ email: address });
    await kv.set(LAST_EMAIL_KEY, address).catch(() => {});
    return { error: null, accepted: { current: true, next: true } };
  },

  changePassword: async (currentPassword, newPassword) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    if (!isValidNewPassword(newPassword)) return tr.auth.errWeakPassword;
    const { error } = await supabase.auth.updateUser({ current_password: currentPassword, password: newPassword });
    return error ? friendlyAuthError(error.message) : null;
  },
}));
