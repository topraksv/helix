import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const callbacks: ((event: string, session: unknown) => void)[] = [];
  const client = {
    auth: {
      verifyOtp: vi.fn(async (_request: { token_hash: string; type: string }) => ({ error: null as { message: string } | null })),
      signOut: vi.fn(async (_options: { scope: string }) => ({ error: null })),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        callbacks.push(callback);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { callbacks, client, platform: { OS: "web" } };
});

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => harness.client),
}));

/** A fresh copy of the module, so its client and recovery marker start empty. */
async function load(env: { url?: string; key?: string } = { url: "https://example.supabase.co", key: "publishable-test-key" }) {
  vi.resetModules();
  harness.callbacks.length = 0;
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", env.url ?? "");
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", env.key ?? "");
  const module = await import("../../src/sync/supabase");
  const { createClient } = await import("@supabase/supabase-js");
  vi.mocked(createClient).mockClear();
  return { ...module, createClient: vi.mocked(createClient) };
}

function emitter() {
  const emit = harness.callbacks[0];
  if (!emit || harness.callbacks.length !== 1) throw new Error("expected exactly one Supabase auth listener");
  return emit;
}

describe("password recovery session binding", () => {
  beforeEach(() => {
    harness.platform.OS = "web";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clears a recovery marker when a different account signs in", async () => {
    const { getSupabase, wasPasswordRecoveryDetected } = await load();
    expect(getSupabase()).not.toBeNull();
    const emit = emitter();

    emit("PASSWORD_RECOVERY", { user: { id: "user-b" } });
    expect(wasPasswordRecoveryDetected()).toBe(true);
    expect(wasPasswordRecoveryDetected("user-b")).toBe(true);
    expect(wasPasswordRecoveryDetected("user-c")).toBe(false);

    emit("TOKEN_REFRESHED", { user: { id: "user-b" } });
    emit("INITIAL_SESSION", null);
    emit("TOKEN_REFRESHED", {});
    expect(wasPasswordRecoveryDetected("user-b")).toBe(true);

    emit("SIGNED_IN", { user: { id: "user-c" } });
    expect(wasPasswordRecoveryDetected()).toBe(false);
  });

  it("ends a recovery binding on sign-out or when asked", async () => {
    const { clearPasswordRecoveryDetected, getSupabase, markPasswordRecoverySession, wasPasswordRecoveryDetected } =
      await load();
    getSupabase();
    const emit = emitter();

    expect(wasPasswordRecoveryDetected()).toBe(false);
    markPasswordRecoverySession("user-b");
    expect(wasPasswordRecoveryDetected("user-b")).toBe(true);
    emit("SIGNED_OUT", null);
    expect(wasPasswordRecoveryDetected()).toBe(false);

    markPasswordRecoverySession("user-b");
    clearPasswordRecoveryDetected();
    expect(wasPasswordRecoveryDetected()).toBe(false);
  });

  /**
   * The landing is read before the app's client exists, and the token is
   * redeemed on a client of its own: the account being confirmed may not be
   * the one this device is signed in with, and confirming it must not sign
   * anyone in here. Only Auth's answer is reported as "confirmed".
   */
  it("confirms an e-mail link's token with Auth, once, and says what Auth said", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/?token_hash=pkce_0b6f&type=email" });
    vi.stubGlobal("history", { state: { key: 1 }, replaceState });
    try {
      const web = await load();
      expect(web.takeEmailLinkLanding()).toBeNull();
      web.getSupabase();
      // Out of the address bar before anything else runs: a reload must not
      // spend the same token a second time and report the refusal.
      expect(replaceState).toHaveBeenCalledWith({ key: 1 }, "", "https://topraksv.github.io/helix/");
      await expect(web.takeEmailLinkLanding()).resolves.toBe("confirmed");
      expect(web.takeEmailLinkLanding()).toBeNull();
      expect(harness.client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "pkce_0b6f", type: "email" });
      expect(harness.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(web.createClient).toHaveBeenCalledTimes(2);
      expect(web.createClient.mock.calls[0]?.[2]).toMatchObject({ auth: { persistSession: false } });

      harness.client.auth.verifyOtp.mockResolvedValueOnce({ error: { message: "Token has expired or is invalid" } });
      const refused = await load();
      refused.getSupabase();
      await expect(refused.takeEmailLinkLanding()).resolves.toBe("unusable");

      vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/?token_hash=pkce_7c1d&type=email_change" });
      const change = await load();
      change.getSupabase();
      await expect(change.takeEmailLinkLanding()).resolves.toBe("changeConfirmed");
      expect(harness.client.auth.verifyOtp).toHaveBeenLastCalledWith({ token_hash: "pkce_7c1d", type: "email_change" });

      vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/#error_code=otp_expired" });
      const expired = await load();
      expired.getSupabase();
      await expect(expired.takeEmailLinkLanding()).resolves.toBe("unusable");

      replaceState.mockClear();
      vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/?tab=durum" });
      const ordinary = await load();
      ordinary.getSupabase();
      expect(ordinary.takeEmailLinkLanding()).toBeNull();
      expect(replaceState).not.toHaveBeenCalled();

      // A native build has no address bar; a location stubbed onto it is not one.
      vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/?token_hash=pkce_0b6f&type=email" });
      harness.platform.OS = "ios";
      const native = await load();
      native.getSupabase();
      expect(native.takeEmailLinkLanding()).toBeNull();

      harness.platform.OS = "web";
      vi.stubGlobal("location", undefined);
      const bare = await load();
      expect(() => bare.getSupabase()).not.toThrow();
      expect(bare.takeEmailLinkLanding()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      harness.client.auth.verifyOtp.mockClear();
      harness.client.auth.signOut.mockClear();
    }
  });

  // A signed-in device has no sign-in screen to show it on; after a sign-out
  // it would greet the next person with news about somebody else's link.
  it("drops an unread landing once a session exists", async () => {
    vi.stubGlobal("location", { href: "https://topraksv.github.io/helix/#error_code=otp_expired" });
    vi.stubGlobal("history", { state: null, replaceState: vi.fn() });
    try {
      const web = await load();
      web.getSupabase();
      const emit = emitter();
      emit("INITIAL_SESSION", null);
      await expect(web.takeEmailLinkLanding()).resolves.toBe("unusable");

      const signedIn = await load();
      signedIn.getSupabase();
      emitter()("SIGNED_IN", { user: { id: "user-b" } });
      expect(signedIn.takeEmailLinkLanding()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("creates one persisted PKCE client, reading the session from the URL only on web", async () => {
    const web = await load();
    const client = web.getSupabase();
    expect(web.getSupabase()).toBe(client);
    expect(web.createClient).toHaveBeenCalledTimes(1);
    expect(web.createClient).toHaveBeenCalledWith("https://example.supabase.co", "publishable-test-key", {
      auth: {
        storage: undefined,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });

    harness.platform.OS = "ios";
    const native = await load();
    native.getSupabase();
    const options = native.createClient.mock.calls[0]?.[2] as { auth: Record<string, unknown> };
    expect(options.auth.detectSessionInUrl).toBe(false);
    expect(options.auth.storage).toEqual(expect.objectContaining({
      getItem: expect.any(Function),
      setItem: expect.any(Function),
      removeItem: expect.any(Function),
    }));
  });

  it("hands every auth event to subscribers until they leave", async () => {
    const { createClient, subscribeSupabaseAuthEvents } = await load();
    const seen: unknown[] = [];
    const leave = subscribeSupabaseAuthEvents((event, session) => seen.push([event, session]));
    expect(createClient).toHaveBeenCalledTimes(1);

    const session = { user: { id: "user-a" } };
    emitter()("SIGNED_IN", session);
    expect(leave()).toBe(true);
    emitter()("SIGNED_OUT", null);
    expect(seen).toEqual([["SIGNED_IN", session]]);
  });

  it("offers no client when the project is not configured", async () => {
    for (const env of [{}, { url: "https://example.supabase.co" }, { key: "publishable-test-key" }]) {
      const { createClient, createRecoveryClient, getSupabase, isSupabaseConfigured } = await load(env);
      expect(isSupabaseConfigured, JSON.stringify(env)).toBe(false);
      expect(getSupabase()).toBeNull();
      expect(createRecoveryClient()).toBeNull();
      expect(createClient).not.toHaveBeenCalled();
    }
  });

  /**
   * A reset link is redeemed on a client that keeps its session in this
   * document's memory. supabase-js mirrors a persisted session to every tab
   * over a BroadcastChannel named after its storage key, and opens that
   * channel only for a persisted session — so this is what keeps the account a
   * link belongs to out of the tab already running Helix.
   */
  it("redeems reset links on a client whose session never leaves the tab", async () => {
    const { createClient, createRecoveryClient } = await load();
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
