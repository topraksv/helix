/**
 * Auth session store. Fully offline-capable: the last signed-in user id is
 * persisted locally, so the app opens and works without network; Supabase
 * session refresh happens opportunistically in the background. Biometric
 * lock (not network auth) protects local data (spec §2.3).
 */

import { create } from "zustand";
import { getSupabase, isSupabaseConfigured } from "../sync/supabase";
import { kv } from "../lib/kv";
import { tr } from "../i18n/tr";

const LAST_USER_KEY = "helix.last_user_id";
/** Local-only workspace id used when Supabase is not configured (dev/offline-only mode). */
const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";

interface SessionStore {
  userId: string | null;
  ready: boolean;
  isOnlineSession: boolean;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const useSession = create<SessionStore>((set) => ({
  userId: null,
  ready: false,
  isOnlineSession: false,

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
        set({ userId: data.session.user.id, ready: true, isOnlineSession: true });
        return;
      }
    } catch {
      // offline — fall through to the persisted user id
    }
    const lastUser = await kv.get(LAST_USER_KEY);
    set({ userId: lastUser, ready: true, isOnlineSession: false });
  },

  signIn: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    await kv.set(LAST_USER_KEY, data.user.id);
    set({ userId: data.user.id, isOnlineSession: true });
    return null;
  },

  signUp: async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) return tr.errors.supabaseNotConfigured;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    if (!data.user) return tr.errors.signUpFailed;
    await kv.set(LAST_USER_KEY, data.user.id);
    set({ userId: data.user.id, isOnlineSession: true });
    return null;
  },

  signOut: async () => {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // offline sign-out still clears local session state
      }
    }
    await kv.remove(LAST_USER_KEY);
    set({ userId: null, isOnlineSession: false });
  },
}));
