/**
 * Tiny cross-platform key-value store (SecureStore on native, localStorage on
 * web).
 *
 * Device-local, non-secret values only. Everything here is either a preference
 * (theme, biometric opt-in, notification opt-in, table layout), an identifier
 * used to re-open the right workspace offline (last user id, local owner, last
 * e-mail, last used category/source), public market prices, or the bounded
 * diagnostics event shape. Financial rows live in SQLite, never here.
 *
 * No credential, password, access token or refresh token belongs in this store:
 * supabase-js owns session material and its own storage. On web the backing
 * store is `localStorage`, which is readable by any script on the origin, so
 * putting a token here would genuinely expose it — `tests/privacy.test.ts`
 * enforces that boundary rather than leaving it to review.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const kv = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
