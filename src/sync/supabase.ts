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
let passwordRecoveryDetected = false;
const authEventListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

/** True only when Supabase itself completed a recovery URL before the route mounted. */
export function wasPasswordRecoveryDetected(): boolean {
  return passwordRecoveryDetected;
}

export function clearPasswordRecoveryDetected(): void {
  passwordRecoveryDetected = false;
}

/** Subscribe without creating a second Supabase auth listener. Callbacks must
 * schedule async work outside Supabase's synchronous auth callback. */
export function subscribeSupabaseAuthEvents(
  listener: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  getSupabase();
  authEventListeners.add(listener);
  return () => authEventListeners.delete(listener);
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient<Database>(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : secureChunkedStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
        flowType: "pkce",
      },
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") passwordRecoveryDetected = true;
      for (const listener of authEventListeners) listener(event, session);
    });
  }
  return client;
}
