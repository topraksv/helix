import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "publishable-test-key";
  const callbacks: Array<(event: string, session: unknown) => void> = [];
  const client = {
    auth: {
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        callbacks.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  };
  return { callbacks, client };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => harness.client),
}));

const { clearPasswordRecoveryDetected, createRecoveryClient, getSupabase, wasPasswordRecoveryDetected } = await import(
  "../src/sync/supabase"
);
const { createClient } = await import("@supabase/supabase-js");

describe("password recovery session binding", () => {
  it("clears a recovery marker when a different account signs in", () => {
    const supabase = getSupabase();
    expect(supabase).not.toBeNull();
    const emit = harness.callbacks[0];
    if (!emit) throw new Error("Supabase auth listener was not registered");

    emit("PASSWORD_RECOVERY", { user: { id: "user-b" } });
    expect(wasPasswordRecoveryDetected()).toBe(true);

    emit("SIGNED_IN", { user: { id: "user-c" } });
    expect(wasPasswordRecoveryDetected()).toBe(false);

    clearPasswordRecoveryDetected();
  });

  /**
   * A reset link is redeemed on a client that keeps its session in this
   * document's memory. supabase-js mirrors a persisted session to every tab
   * over a BroadcastChannel named after its storage key, and opens that
   * channel only for a persisted session — so this is what keeps the account a
   * link belongs to out of the tab already running Helix.
   */
  it("redeems reset links on a client whose session never leaves the tab", () => {
    vi.mocked(createClient).mockClear();
    expect(createRecoveryClient()).toBe(harness.client);
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "publishable-test-key", {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "helix-password-recovery",
      },
    });
  });
});
