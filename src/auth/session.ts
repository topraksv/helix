/**
 * Auth session store. Fully offline-capable: the last signed-in user id is
 * persisted locally, so the app opens and works without network; Supabase
 * session refresh happens opportunistically in the background. Biometric
 * lock (not network auth) protects local data (spec §2.3).
 */

import { create } from "zustand";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import {
  clearPasswordRecoveryDetected,
  getSupabase,
  isSupabaseConfigured,
  subscribeSupabaseAuthEvents,
  wasPasswordRecoveryDetected,
} from "../sync/supabase";
import { resetLocalWorkspace, writeSetting } from "../db/mutations";
import { runSyncSessionTask, startSyncSession, stopSyncSession } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { connectMarkets, disconnectMarkets } from "../services/markets";
import { clearRateCache, loadRateCache } from "../services/fx-fetch";
import { clearAccountNotifications, rescheduleAll } from "../services/notifications";
import { kv } from "../services/kv";
import { tr } from "../i18n/tr";
import { friendlyAuthError } from "./auth-errors";
import { signOutWithLocalFallback } from "./sign-out";
import { loadPreviousLogin, recordSuccessfulLogin, seedCurrentLogin, startLoginHistory } from "./login-history";
import { parsePasswordRecoveryUrl, webPasswordRecoveryRedirectUrl } from "./recovery";
import { LOCAL_ONLY_USER_ID } from "../domain/user-id";
import {
  IDLE_BRAKE,
  isVerificationBlocked,
  recordVerificationFailure,
  recordVerificationSuccess,
  type VerificationBrake,
} from "./verification-brake";

/** Owner-keyed brake on password verification — see verification-brake.ts. */
let verificationBrake: VerificationBrake = IDLE_BRAKE;
let authLifecycleSubscribed = false;
let explicitSignOutInProgress = false;
let invalidationCleanup: Promise<void> | null = null;

const LAST_USER_KEY = "helix.last_user_id";
/** Signed-in e-mail, persisted so an offline bootstrap can still re-auth. */
const LAST_EMAIL_KEY = "helix.last_email";
/** Owner of the data currently in the local DB (for account-switch detection). */
const LOCAL_OWNER_KEY = "helix.local_owner";

/**
 * Ensure the local DB belongs to `userId`. If a different account previously
 * used this device, wipe the local workspace so its rows never sync under the
 * new session; the cloud re-hydrates the incoming account's data on next pull.
 * Returns a user-facing error when the wipe fails — the sign-in must NOT
 * proceed then, or the previous account's data would remain readable (and the
 * owner marker would go stale).
 */
async function ensureWorkspaceFor(userId: string): Promise<string | null> {
  const owner = await kv.get(LOCAL_OWNER_KEY);
  if (owner && owner !== userId) {
    await stopSyncSession();
    disconnectMarkets();
    clearRateCache();
    await clearAccountNotifications(true).catch(() => {});
    try {
      await resetLocalWorkspace();
    } catch {
      return tr.errors.workspaceResetFailed;
    }
  }
  if (owner !== userId) await kv.set(LOCAL_OWNER_KEY, userId);
  return null;
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
  useSyncStatus.getState().set({ lastSyncAt: null });
  try {
    await resetLocalWorkspace();
  } catch {
    // Keep LOCAL_OWNER_KEY so a different account must retry the wipe. Remove
    // bootstrap credentials below so this invalid session cannot reopen.
  }
  if (useSession.getState().userId !== userId) return;
  await kv.remove(LAST_USER_KEY);
  await kv.remove(LAST_EMAIL_KEY);
  useSession.setState({
    userId: null,
    email: null,
    isOnlineSession: false,
    isNewSignup: false,
    isFreezing: false,
    previousLoginAt: null,
  });
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
  signUp: (email: string, password: string) => Promise<string | null>;
  /** Send a neutral, expiring Supabase password-reset link. */
  requestPasswordReset: (email: string) => Promise<string | null>;
  /** Exchange a web/native recovery deep link for a short-lived session. */
  preparePasswordRecovery: (url: string | null) => Promise<"ready" | "expired" | "invalid">;
  /** Update the password from the recovery session and end that session. */
  completePasswordRecovery: (newPassword: string) => Promise<string | null>;
  /** Wipe local finance data and end the session. Returns an error if the wipe
   *  failed; in that case the authenticated session remains active. */
  signOut: () => Promise<string | null>;
  /** Permanently delete all data (cloud + this device) and sign out. Returns a
   *  user-facing error string when the cloud wipe could not complete. */
  deleteAccount: () => Promise<string | null>;
  /** Re-authenticate the current account to confirm a sensitive action
   *  (delete / freeze / credential change). Returns null when the password is
   *  correct, otherwise a user-facing error — including a local cooldown
   *  after repeated failures, since every attempt is a real sign-in that
   *  counts against Supabase's shared login rate limit. */
  verifyPassword: (password: string) => Promise<string | null>;
  /** Request an e-mail change (Supabase confirms via a link). Returns an error
   *  string, or null on success. */
  changeEmail: (newEmail: string) => Promise<string | null>;
  /** Set a new password (the session is fresh from a prior verifyPassword).
   *  Returns an error string, or null on success. */
  changePassword: (newPassword: string) => Promise<string | null>;
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
        await kv.set(LAST_USER_KEY, data.session.user.id);
        if (data.session.user.email) await kv.set(LAST_EMAIL_KEY, data.session.user.email);
        await seedCurrentLogin(
          kv,
          data.session.user.id,
          data.session.user.last_sign_in_at ?? new Date().toISOString(),
        );
        const previousLoginAt = await loadPreviousLogin(kv, data.session.user.id);
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
      await supabase.auth.signOut().catch(() => {});
      return wsError;
    }
    await kv.set(LAST_USER_KEY, data.user.id);
    await kv.set(LAST_EMAIL_KEY, data.user.email ?? email);
    const previousLoginAt = await recordSuccessfulLogin(
      kv,
      data.user.id,
      data.user.last_sign_in_at ?? new Date().toISOString(),
    );
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
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return friendlyAuthError(error.message);
    if (!data.user) return tr.errors.signUpFailed;
    const wsError = await ensureWorkspaceFor(data.user.id);
    if (wsError) {
      await supabase.auth.signOut().catch(() => {});
      return wsError;
    }
    await kv.set(LAST_USER_KEY, data.user.id);
    await kv.set(LAST_EMAIL_KEY, data.user.email ?? email);
    await startLoginHistory(kv, data.user.id, new Date().toISOString());
    // A brand-new account has no cloud data to pull → go straight to onboarding
    // (isNewSignup), skipping the "await first pull" hold used for existing
    // accounts syncing onto a fresh device.
    startSyncSession(data.user.id);
    set({ userId: data.user.id, email: data.user.email ?? email, isOnlineSession: true, isNewSignup: true, previousLoginAt: null });
    return null;
  },

  requestPasswordReset: async (email) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const redirectTo = Platform.OS === "web" && globalThis.location
      ? webPasswordRecoveryRedirectUrl(globalThis.location.origin, process.env.EXPO_BASE_URL ?? "/")
      : Linking.createURL("/reset-password");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (!error) return null;
    // Supabase normally returns the same success for unknown addresses. Keep
    // that guarantee even if a project policy returns an account lookup error.
    if (/user.*not found|email.*not found/i.test(error.message)) return null;
    return friendlyAuthError(error.message);
  },

  preparePasswordRecovery: async (url) => {
    const supabase = getSupabase();
    if (!supabase) return "invalid";
    const target = Platform.OS === "web" && globalThis.location
      ? { platform: "web" as const, origin: globalThis.location.origin, baseUrl: process.env.EXPO_BASE_URL ?? "/" }
      : { platform: "native" as const, scheme: "helix" };
    const link = parsePasswordRecoveryUrl(url, target);
    if (link.kind === "expired") return "expired";
    if (link.kind === "code") {
      const { error } = await supabase.auth.exchangeCodeForSession(link.code);
      if (!error) return "ready";
      // On web, detectSessionInUrl may win the race and consume the one-time
      // code before this screen mounts. Accept only an observed recovery event,
      // never an unrelated existing session.
      const { data } = await supabase.auth.getSession();
      return data.session && wasPasswordRecoveryDetected() ? "ready" : "invalid";
    }
    if (link.kind === "tokens") {
      const { error } = await supabase.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      return error ? "invalid" : "ready";
    }
    const { data } = await supabase.auth.getSession();
    return data.session && wasPasswordRecoveryDetected() ? "ready" : "invalid";
  },

  completePasswordRecovery: async (newPassword) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return friendlyAuthError(error.message);
    clearPasswordRecoveryDetected();
    if (get().userId) {
      const signOutError = await get().signOut();
      if (signOutError) return signOutError;
    }
    else await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    return null;
  },

  signOut: async () => {
    const userId = get().userId;
    // Abort scheduled/network work and wait for registered maintenance tasks.
    // The database cannot be wiped while an old user task can still write.
    await stopSyncSession(userId ?? undefined);
    disconnectMarkets();
    clearRateCache();
    await clearAccountNotifications(true).catch(() => {});
    useSyncStatus.getState().set({ lastSyncAt: null });
    // Best practice for a finance app: leave no plaintext financial data on the
    // device after an explicit sign-out. The cloud (RLS-scoped) is the source
    // of truth, so the next sign-in re-hydrates via the initial pull. Clearing
    // the owner marker keeps that first pull clean.
    try {
      await resetLocalWorkspace();
    } catch {
      if (userId) {
        // The wipe failed, so the session stays alive and its background work
        // is restored. That work MUST be session-scoped: a bare
        // an unowned floating `Promise.allSettled(...)` had no owner, so `stopSyncSession`
        // could not await it, and if the user retried the sign-out and signed
        // into another account, `rescheduleAll` for the old account could still
        // land and schedule its notifications under the new one.
        startSyncSession(userId);
        connectMarkets();
        void runSyncSessionTask(userId, async () => {
          await Promise.allSettled([loadRateCache(userId), rescheduleAll(userId)]);
        });
      }
      return tr.errors.workspaceResetFailed;
    }
    const supabase = getSupabase();
    if (supabase) {
      explicitSignOutInProgress = true;
      try {
        await signOutWithLocalFallback((options) => supabase.auth.signOut(options));
      } finally {
        explicitSignOutInProgress = false;
      }
    }
    await kv.remove(LOCAL_OWNER_KEY);
    await kv.remove(LAST_USER_KEY);
    await kv.remove(LAST_EMAIL_KEY);
    set({ userId: null, email: null, isOnlineSession: false, isNewSignup: false, isFreezing: false, previousLoginAt: null });
    return null;
  },

  deleteAccount: async () => {
    const state = get();
    const userId = state.userId;
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
    if (isSupabaseConfigured) {
      const supabase = getSupabase();
      if (supabase) {
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
    }
    // Cloud is erased (or local-only mode): stop timers/streams, wipe the device,
    // and end the session.
    disconnectMarkets();
    clearRateCache();
    await clearAccountNotifications(true).catch(() => {});
    useSyncStatus.getState().set({ lastSyncAt: null });
    const supabase = getSupabase();
    if (supabase) {
      explicitSignOutInProgress = true;
      try {
        await signOutWithLocalFallback((options) => supabase.auth.signOut(options));
      } finally {
        explicitSignOutInProgress = false;
      }
    }
    try {
      await resetLocalWorkspace();
    } catch {
      // The cloud identity is already gone, so keep the local owner marker and
      // surface an actionable error. A future account cannot open this
      // workspace: ensureWorkspaceFor will retry the wipe first.
      return tr.errors.workspaceResetFailed;
    }
    await kv.remove(LOCAL_OWNER_KEY);
    await kv.remove(LAST_USER_KEY);
    await kv.remove(LAST_EMAIL_KEY);
    set({ userId: null, email: null, isOnlineSession: false, isNewSignup: false, isFreezing: false, previousLoginAt: null });
    return null;
  },

  verifyPassword: async (password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    // The brake belongs to the account being verified. Anonymous/local-only
    // sessions have no account to rate limit, so they use a stable placeholder.
    const brakeOwner = get().userId ?? LOCAL_ONLY_USER_ID;
    if (isVerificationBlocked(verificationBrake, brakeOwner, Date.now())) return tr.auth.errRateLimit;
    // The store's e-mail is empty after an offline bootstrap (no live Supabase
    // session at launch). Recover it from the auth session or the device record
    // before failing — returning "Supabase not configured" here mislabeled
    // every verification (including a merely wrong password) with a setup error.
    let email = get().email;
    if (!email) {
      try {
        const { data } = await supabase.auth.getUser();
        email = data.user?.email ?? null;
      } catch {
        email = null;
      }
      if (!email) email = await kv.get(LAST_EMAIL_KEY);
      if (!email) return tr.auth.errSessionExpired;
      set({ email });
    }
    // Re-authenticate with the current e-mail: a successful sign-in confirms
    // the password. It re-issues tokens for the same account (no identity
    // change), which is exactly the "recent login" Supabase wants before a
    // sensitive credential update.
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
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
    if (error) return friendlyAuthError(error.message);
    return null;
  },

  changePassword: async (newPassword) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return friendlyAuthError(error.message);
    return null;
  },
}));
