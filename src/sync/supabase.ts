/**
 * Supabase client. Sessions persist locally (SecureStore on iOS, chunked to
 * respect its 2 KB value limit; localStorage on web) so the app opens fully
 * offline — token refresh failures never block local data access.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const CHUNK = 1900;
const MAX_AUTH_CHUNKS = 64;

async function deleteChunks(key: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
}

const secureChunkedStorage = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(`${key}.n`);
    if (!countRaw) return SecureStore.getItemAsync(key);
    const parts: string[] = [];
    for (let i = 0; i < Number(countRaw); i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join("");
  },
  async setItem(key: string, value: string): Promise<void> {
    const previousCount = Number(await SecureStore.getItemAsync(`${key}.n`)) || 0;
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await deleteChunks(key, previousCount);
      await SecureStore.deleteItemAsync(`${key}.n`);
      return;
    }
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(`${key}.n`, String(count));
    await SecureStore.deleteItemAsync(key);
    for (let i = count; i < previousCount; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  },
  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(`${key}.n`);
    // The bounded fallback also removes legacy orphan chunks left by older
    // short-token overwrites that deleted `.n` before deleting `.0…n`.
    await deleteChunks(key, Math.max(Number(countRaw) || 0, MAX_AUTH_CHUNKS));
    await SecureStore.deleteItemAsync(`${key}.n`);
    await SecureStore.deleteItemAsync(key);
  },
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
let passwordRecoveryDetected = false;

/** True only when Supabase itself completed a recovery URL before the route mounted. */
export function wasPasswordRecoveryDetected(): boolean {
  return passwordRecoveryDetected;
}

export function clearPasswordRecoveryDetected(): void {
  passwordRecoveryDetected = false;
}

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        storage: Platform.OS === "web" ? undefined : secureChunkedStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
        flowType: "pkce",
      },
    });
    client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") passwordRecoveryDetected = true;
    });
  }
  return client;
}
