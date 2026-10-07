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
import { parseEmailLinkLanding } from "../auth/recovery";

const secureChunkedStorage = createSecureChunkedStorage(SecureStore);

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient<Database> | null = null;
let passwordRecoveryUserId: string | null = null;
type EmailLinkAnswer = "confirmed" | "changeConfirmed" | "unusable";
let emailLinkLanding: Promise<EmailLinkAnswer> | null = null;
const authEventListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

/** What Auth said about the e-mail link this page opened from, once. */
export function takeEmailLinkLanding(): Promise<EmailLinkAnswer> | null {
  const landing = emailLinkLanding;
  emailLinkLanding = null;
  return landing;
}

/** True only for the recovery session belonging to `userId`, when supplied. */
export function wasPasswordRecoveryDetected(userId?: string): boolean {
  return passwordRecoveryUserId !== null && (userId === undefined || passwordRecoveryUserId === userId);
}

/** Bind a recovery flow that Supabase established through an explicit link. */
export function markPasswordRecoverySession(userId: string): void {
  passwordRecoveryUserId = userId;
}

export function clearPasswordRecoveryDetected(): void {
  passwordRecoveryUserId = null;
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

/**
 * A client for redeeming a reset link that shares nothing with the app's own.
 *
 * On web the app's session lives in localStorage, and supabase-js mirrors it
 * to every tab over a BroadcastChannel named after its storage key. A reset
 * link redeemed through that client handed the account it belongs to — the
 * owner's partner's, opened on the owner's computer — to the tab already
 * running Helix, and signed that tab out when the reset finished. An
 * unpersisted session stays in this document's memory, and supabase-js opens
 * the cross-tab channel only for a persisted one.
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

/**
 * Redeem a confirmation token on a client of its own, as a reset token is:
 * the account it confirms may not be the one this device is signed in with,
 * and confirming it signs nobody in here. The token leaves the address bar
 * first, so a reload cannot spend it twice and report the refusal.
 */
function landEmailLink(href: string): Promise<EmailLinkAnswer> | null {
  const landing = parseEmailLinkLanding(href);
  if (landing === null) return null;
  if (landing === "unusable") return Promise.resolve(landing);
  const address = new URL(href);
  address.search = "";
  address.hash = "";
  globalThis.history.replaceState(globalThis.history.state, "", address.href);
  const verifier = createRecoveryClient()!;
  return verifier.auth.verifyOtp({ token_hash: landing.tokenHash, type: landing.type }).then(async ({ error }) => {
    if (error) return "unusable";
    await verifier.auth.signOut({ scope: "local" });
    // One side of a change is not the change: with both addresses asked,
    // Auth accepts the first link and still waits for the other.
    return landing.type === "email_change" ? "changeConfirmed" : "confirmed";
  });
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    // Before the client exists: with `detectSessionInUrl` it rewrites the
    // address bar, and with it the only sign a confirmation landed.
    if (Platform.OS === "web" && globalThis.location) emailLinkLanding = landEmailLink(globalThis.location.href);
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
      const userId = session?.user?.id ?? null;
      // A signed-in device shows no sign-in screen to read it on, and after a
      // sign-out it would be news about a link nobody here just opened.
      if (session) emailLinkLanding = null;
      if (event === "PASSWORD_RECOVERY") {
        passwordRecoveryUserId = userId;
      } else if (event === "SIGNED_OUT" || (passwordRecoveryUserId && userId && userId !== passwordRecoveryUserId)) {
        passwordRecoveryUserId = null;
      }
      for (const listener of authEventListeners) listener(event, session);
    });
  }
  return client;
}
