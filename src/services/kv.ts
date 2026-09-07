/**
 * Tiny cross-platform key-value store (SecureStore on native, localStorage on
 * web).
 *
 * Device-local, non-secret values only. Everything here is either a preference
 * (theme, biometric opt-in, notification opt-in, table layout), an identifier
 * used to re-open the right workspace offline (last user id, local owner, last
 * e-mail, last used category/source), public market prices, the bounded
 * diagnostics event shape, or the timestamp marking how much of that ring has
 * already been uploaded. Financial rows live in SQLite, never here.
 *
 * No credential, password, access token or refresh token belongs in this store:
 * supabase-js owns session material and its own storage. On web the backing
 * store is `localStorage`, which is readable by any script on the origin, so
 * putting a token here would genuinely expose it — `tests/privacy.test.ts`
 * enforces that boundary rather than leaving it to review.
 *
 * Every method is BEST-EFFORT on web, and that is a contract callers rely on
 * rather than an implementation detail. A browser told to block site data
 * throws on the `localStorage` property access itself, and a full one throws on
 * the write; both are absorbed, so a refused write is dropped rather than
 * raised. What that buys is that no preference can fail the operation that set
 * it — `signIn` writes here after the account is already authenticated, and a
 * raised error there refused a session that had in fact been granted.
 *
 * What it costs is that a resolved `set` is not proof of a stored value. Any
 * caller that needs that proof has to read the value back; `ensureWorkspaceFor`
 * in `src/auth/session.ts` is the one place that does, because the workspace
 * owner marker decides whose rows this device may open.
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
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // The same hazard `get` already absorbs, and it has to be absorbed the
        // same way. `?.` guards a nullish store, not a throwing one: a browser
        // told to block site data throws `SecurityError` on the property access
        // itself, and a full store throws `QuotaExceededError` on the write.
        // Dropping the write costs a device-local preference. Rethrowing costs
        // the operation that made it — `signIn` awaits this AFTER Supabase has
        // already authenticated the account, and the sign-in screen renders any
        // rejection as the generic "istek basarisiz", so the account ends up
        // authenticated, refused, and told the wrong reason.
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Symmetric with `set`: a store that cannot be written cannot be
        // cleared either, and a sign-out must not be the thing that fails.
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
