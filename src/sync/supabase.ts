/**
 * Supabase client. Sessions persist locally (SecureStore on iOS, chunked to
 * respect its 2 KB value limit; localStorage on web) so the app opens fully
 * offline — token refresh failures never block local data access.
 */

import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { Database } from "./database.types";
import { createSecureChunkedStorage } from "./secure-chunked-storage";

const secureChunkedStorage = createSecureChunkedStorage(SecureStore);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient<Database> | null = null;
const authEventListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

/** Subscribe without creating a second Supabase auth listener. Callbacks must
 * schedule async work outside Supabase's synchronous auth callback. */
export function subscribeSupabaseAuthEvents(
  listener: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  getSupabase();
  authEventListeners.add(listener);
  return () => authEventListeners.delete(listener);
}

/**
 * A client for a reset code that shares nothing with the app's own: on web
 * supabase-js mirrors a persisted session to every tab, so the reset's account would land in the tab
 * already running the app. An unpersisted session stays in this document's memory.
 */
export function createRecoveryClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  return createClient<Database>(url!, anonKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "helix-password-recovery",
    },
  });
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient<Database>(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : secureChunkedStorage,
        autoRefreshToken: true,
        persistSession: true,
        // Every auth mail carries a code and no link, so no address the page
        // opens on holds a session to take.
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
    client.auth.onAuthStateChange((event, session) => {
      for (const listener of authEventListeners) listener(event, session);
    });
  }
  return client;
}
