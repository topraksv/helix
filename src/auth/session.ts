/**
 * Auth session store. Fully offline-capable: the last signed-in user id is
 * persisted locally, so the app opens and works without network; Supabase
 * session refresh happens opportunistically in the background. Biometric
 * lock (not network auth) protects local data (spec §2.3).
 */

import { create } from "zustand";
import { getSupabase, isSupabaseConfigured } from "../sync/supabase";
import { resetLocalWorkspace, writeSetting } from "../db/mutations";
import { SYNCED_TABLES, type SyncedTableName } from "../db/schema";
import { cancelSync } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { disconnectMarkets } from "../services/markets";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";

const LAST_USER_KEY = "helix.last_user_id";
/** Owner of the data currently in the local DB (for account-switch detection). */
const LOCAL_OWNER_KEY = "helix.local_owner";
/** Local-only workspace id used when Supabase is not configured (dev/offline-only mode). */
const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";

/** Supabase auth errors arrive in English; map them to the Turkish UI. */
function friendlyAuthError(raw: string): string {
  if (/invalid login credentials|invalid_credentials/i.test(raw)) return tr.auth.errInvalidCredentials;
  if (/already registered|already exists/i.test(raw)) return tr.auth.errUserExists;
  if (/rate limit|too many/i.test(raw)) return tr.auth.errRateLimit;
  if (/network|fetch|timeout/i.test(raw)) return tr.auth.errNetwork;
  if (/password should be|weak password/i.test(raw)) return tr.auth.errWeakPassword;
  if (/email not confirmed/i.test(raw)) return tr.auth.errEmailNotConfirmed;
  if (/invalid.*email|email.*invalid|validate email/i.test(raw)) return tr.auth.errInvalidEmail;
  return tr.auth.errGeneric;
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
  const owner = await kv.get(LOCAL_OWNER_KEY);
  if (owner && owner !== userId) {
    try {
      await resetLocalWorkspace();
    } catch {
      return tr.errors.workspaceResetFailed;
    }
  }
  if (owner !== userId) await kv.set(LOCAL_OWNER_KEY, userId);
  return null;
}

interface SessionStore {
  userId: string | null;
  ready: boolean;
  isOnlineSession: boolean;
  /** True only for the session created by a fresh sign-UP (no cloud data to
   *  pull) so the route guard sends it straight to onboarding instead of
   *  holding for a first pull. Sign-in / bootstrap clear it. */
  isNewSignup: boolean;
  /** Set while a "freeze" is in progress (write flag → push → sign out) so the
   *  guard doesn't flash the frozen gate on the initiating device. */
  isFreezing: boolean;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Permanently delete all data (cloud + this device) and sign out. Returns a
   *  user-facing error string when the cloud wipe could not complete. */
  deleteAccount: () => Promise<string | null>;
}

/**
 * Delete every synced row this user owns from the cloud (RLS also scopes it,
 * but we filter by user_id explicitly). Throws on the first failing table so
 * the caller can surface that the wipe was incomplete rather than sign the user
 * out believing their data is gone.
 */
async function deleteAllCloudData(userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  for (const table of Object.keys(SYNCED_TABLES) as SyncedTableName[]) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export const useSession = create<SessionStore>((set) => ({
  userId: null,
  ready: false,
  isOnlineSession: false,
  isNewSignup: false,
  isFreezing: false,

  bootstrap: async () => {
    if (!isSupabaseConfigured) {
      set({ userId: LOCAL_USER_ID, ready: true, isOnlineSession: false });
      return;
    }
    const supabase = getSupabase()!;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) {
        await kv.set(LAST_USER_KEY, data.session.user.id);
        set({ userId: data.session.user.id, ready: true, isOnlineSession: true, isNewSignup: false });
        return;
      }
    } catch {
      // offline — fall through to the persisted user id
    }
    const lastUser = await kv.get(LAST_USER_KEY);
    set({ userId: lastUser, ready: true, isOnlineSession: false, isNewSignup: false });
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
    // Signing in IS the password check, so it unfreezes a frozen account: clear
    // the synced flag (a newer LWW write than the freeze) so the reactivation
    // gate never reappears after a successful login.
    await writeSetting(data.user.id, "account_frozen", false).catch(() => {});
    set({ userId: data.user.id, isOnlineSession: true, isNewSignup: false });
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
    // A brand-new account has no cloud data to pull → go straight to onboarding
    // (isNewSignup), skipping the "await first pull" hold used for existing
    // accounts syncing onto a fresh device.
    set({ userId: data.user.id, isOnlineSession: true, isNewSignup: true });
    return null;
  },

  signOut: async () => {
    // Stop any scheduled sync/retry so a stale timer never fires for this
    // account after the wipe below, and close the live market feed so no
    // stream survives the session.
    cancelSync();
    disconnectMarkets();
    useSyncStatus.getState().set({ lastSyncAt: null });
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // offline sign-out still clears local session state
      }
    }
    // Best practice for a finance app: leave no plaintext financial data on the
    // device after an explicit sign-out. The cloud (RLS-scoped) is the source
    // of truth, so the next sign-in re-hydrates via the initial pull. Clearing
    // the owner marker keeps that first pull clean.
    try {
      await resetLocalWorkspace();
    } catch {
      // best-effort; a failed wipe still clears the session below
    }
    await kv.remove(LOCAL_OWNER_KEY);
    await kv.remove(LAST_USER_KEY);
    set({ userId: null, isOnlineSession: false, isNewSignup: false, isFreezing: false });
  },

  deleteAccount: async () => {
    const state = useSession.getState();
    const userId = state.userId;
    if (!userId) return null;
    // Wipe the cloud first: if it fails (offline), abort before touching local
    // data so we never report "deleted" while the rows still live in the cloud.
    if (isSupabaseConfigured) {
      try {
        await deleteAllCloudData(userId);
      } catch (e) {
        return `${tr.account.deleteCloudFailed} (${e instanceof Error ? e.message : String(e)})`;
      }
    }
    // Cloud is clear (or local-only mode): stop timers/streams, wipe the device,
    // and end the session.
    cancelSync();
    disconnectMarkets();
    useSyncStatus.getState().set({ lastSyncAt: null });
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // offline sign-out still clears local session state
      }
    }
    try {
      await resetLocalWorkspace();
    } catch {
      // best-effort; the cloud is already gone and the session is cleared below
    }
    await kv.remove(LOCAL_OWNER_KEY);
    await kv.remove(LAST_USER_KEY);
    set({ userId: null, isOnlineSession: false, isNewSignup: false, isFreezing: false });
    return null;
  },
}));
