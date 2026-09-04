/**
 * How a session STARTS, and what it refuses to start.
 *
 * `session-reauth`, `session-cleanup-order`, `session-delete-failure` and
 * `password-recovery-session` each take one late question: re-auth, the order
 * of a wipe, a failed deletion, a recovery link. None of them enters through
 * `bootstrap`, `signIn` or `signUp`, which is why the file's mutation gate sat
 * at 19.4% with 220 mutants no test reaches at all.
 *
 * The question every case below is written from: when may this device hold a
 * usable session, and can any path hand one out without the workspace behind
 * it being the caller's own. That is the boundary an offline-first app has
 * instead of a server check — the local database opens whether or not the
 * network agrees, so the moment a workspace is adopted is the moment access is
 * granted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

interface FakeUser {
  id: string;
  email: string;
  last_sign_in_at?: string;
}

const harness = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    supabase: {
      auth: {
        getSession: vi.fn(async (): Promise<{ data: { session: { user: FakeUser } | null } }> => ({
          data: { session: null },
        })),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(async () => ({ error: null })),
      },
    },
    startSyncSession: vi.fn(),
    stopSyncSession: vi.fn(async () => {}),
    resetLocalWorkspace: vi.fn(async () => {}),
    writeSetting: vi.fn(async () => {}),
    configured: { value: true },
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  getSupabase: () => (harness.configured.value ? harness.supabase : null),
  get isSupabaseConfigured() {
    return harness.configured.value;
  },
  markPasswordRecoverySession: vi.fn(),
  subscribeSupabaseAuthEvents: vi.fn(),
  wasPasswordRecoveryDetected: vi.fn(() => false),
}));
vi.mock("../src/db/mutations", () => ({
  pendingOutboxCount: vi.fn(async () => 0),
  resetLocalWorkspace: harness.resetLocalWorkspace,
  writeSetting: harness.writeSetting,
}));
vi.mock("../src/sync/engine", () => ({
  flushOutbox: vi.fn(async () => {}),
  purgeRemoteAttachments: vi.fn(async () => {}),
  runSyncSessionTask: vi.fn(async (_userId: string, task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  startSyncSession: harness.startSyncSession,
  stopSyncSession: harness.stopSyncSession,
}));
vi.mock("../src/sync/status", () => ({ useSyncStatus: { getState: () => ({ set: vi.fn() }) } }));
vi.mock("../src/services/markets", () => ({ connectMarkets: vi.fn(), disconnectMarkets: vi.fn() }));
vi.mock("../src/services/fx-fetch", () => ({ clearRateCache: vi.fn(), loadRateCache: vi.fn(async () => {}) }));
vi.mock("../src/services/notifications", () => ({
  clearAccountNotifications: vi.fn(async () => {}),
  rescheduleAll: vi.fn(async () => {}),
}));
vi.mock("../src/services/diagnostics", () => ({ resetDiagnosticUploads: vi.fn() }));
// A real map, not a stub returning null: the login history this store keeps is
// read back by the same call that wrote it, and a kv that forgets would make
// `previousLoginAt` vacuously null in every case below.
vi.mock("../src/services/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => harness.store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      harness.store.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      harness.store.delete(key);
    }),
  },
}));

const { useSession } = await import("../src/auth/session");
const { LOCAL_ONLY_USER_ID } = await import("../src/domain/user-id");

const OWNER_KEY = "helix.local_owner";
const USER_KEY = "helix.last_user_id";
const EMAIL_KEY = "helix.last_email";

const USER_A = { id: "user-a", email: "a@example.com", last_sign_in_at: "2026-09-01T08:00:00.000Z" };

function reset(): void {
  harness.store.clear();
  harness.configured.value = true;
  harness.supabase.auth.getSession.mockReset();
  harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  harness.supabase.auth.signInWithPassword.mockReset();
  harness.supabase.auth.signUp.mockReset();
  harness.supabase.auth.signOut.mockClear();
  harness.startSyncSession.mockClear();
  harness.stopSyncSession.mockClear();
  harness.resetLocalWorkspace.mockReset();
  harness.resetLocalWorkspace.mockResolvedValue(undefined);
  harness.writeSetting.mockClear();
  useSession.setState({
    userId: null,
    email: null,
    ready: false,
    isOnlineSession: false,
    isNewSignup: false,
    isFreezing: false,
    previousLoginAt: null,
  });
}

beforeEach(reset);

describe("bootstrap without Supabase", () => {
  it("opens the local-only workspace and syncs it", async () => {
    harness.configured.value = false;

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({
      userId: LOCAL_ONLY_USER_ID,
      ready: true,
      isOnlineSession: false,
    });
    expect(harness.startSyncSession).toHaveBeenCalledWith(LOCAL_ONLY_USER_ID);
  });

  it("hands out no workspace when the previous owner's data could not be wiped", async () => {
    harness.configured.value = false;
    harness.store.set(OWNER_KEY, "someone-else");
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    await useSession.getState().bootstrap();

    // Ready, so the app can render its failure state — but with no user, so
    // nothing reads the rows that still belong to the previous account.
    expect(useSession.getState()).toMatchObject({ userId: null, ready: true });
    expect(harness.startSyncSession).not.toHaveBeenCalled();
    expect(harness.store.get(OWNER_KEY)).toBe("someone-else");
  });
});

describe("bootstrap with a live Supabase session", () => {
  it("adopts the session and remembers who it belongs to", async () => {
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({
      userId: USER_A.id,
      email: USER_A.email,
      ready: true,
      isOnlineSession: true,
      isNewSignup: false,
    });
    expect(harness.store.get(USER_KEY)).toBe(USER_A.id);
    expect(harness.store.get(EMAIL_KEY)).toBe(USER_A.email);
    expect(harness.startSyncSession).toHaveBeenCalledWith(USER_A.id);
  });

  it("signs the session out locally rather than keep it over another account's rows", async () => {
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });
    harness.store.set(OWNER_KEY, "user-b");
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: null, ready: true, isOnlineSession: false });
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    // The credential is gone, so the id must not be left behind for the
    // offline path below to pick up on the next launch.
    expect(harness.store.get(USER_KEY)).toBeUndefined();
  });
});

describe("bootstrap while offline", () => {
  it("reopens the last account from the device rather than showing a signed-out app", async () => {
    harness.supabase.auth.getSession.mockRejectedValue(new Error("network"));
    harness.store.set(USER_KEY, USER_A.id);
    harness.store.set(EMAIL_KEY, USER_A.email);

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({
      userId: USER_A.id,
      email: USER_A.email,
      ready: true,
      // Offline is the whole point of the fallback: it must not claim the
      // session was checked against Supabase.
      isOnlineSession: false,
    });
    expect(harness.startSyncSession).toHaveBeenCalledWith(USER_A.id);
  });

  it("stays signed out when the device has never held an account", async () => {
    harness.supabase.auth.getSession.mockRejectedValue(new Error("network"));

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: null, ready: true });
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });

  it("refuses the offline fallback too when the workspace could not be reset", async () => {
    harness.supabase.auth.getSession.mockRejectedValue(new Error("network"));
    harness.store.set(USER_KEY, USER_A.id);
    harness.store.set(OWNER_KEY, "user-b");
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: null, ready: true });
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });
});

describe("signIn", () => {
  it("reports the configuration rather than pretending to try", async () => {
    harness.configured.value = false;

    expect(await useSession.getState().signIn("a@example.com", "pw")).toBe(tr.errors.supabaseNotConfigured);
  });

  it("leaves nothing behind when the credentials are refused", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: "Invalid login credentials" } });

    const error = await useSession.getState().signIn("a@example.com", "wrong");

    expect(error).toBeTruthy();
    expect(useSession.getState().userId).toBeNull();
    expect(harness.store.get(USER_KEY)).toBeUndefined();
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });

  it("refuses a correct password when the previous account's rows are still there", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.store.set(OWNER_KEY, "user-b");
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    const error = await useSession.getState().signIn("a@example.com", "pw");

    expect(error).toBe(tr.errors.workspaceResetFailed);
    expect(useSession.getState().userId).toBeNull();
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });

  it("clears the freeze flag, because signing in IS the password check the gate asks for", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });

    expect(await useSession.getState().signIn("a@example.com", "pw")).toBeNull();

    expect(harness.writeSetting).toHaveBeenCalledWith(USER_A.id, "account_frozen", false);
    expect(useSession.getState()).toMatchObject({
      userId: USER_A.id,
      isOnlineSession: true,
      isNewSignup: false,
    });
  });
});

describe("signUp", () => {
  it("refuses a weak password on this device instead of spending a request on it", async () => {
    const result = await useSession.getState().signUp("a@example.com", "short");

    expect(result).toEqual({ status: "error", message: tr.auth.errWeakPassword });
    expect(harness.supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("creates no local workspace while the account is unconfirmed", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: { user: USER_A, session: null }, error: null });

    const result = await useSession.getState().signUp("a@example.com", "Str0ng-passphrase!");

    expect(result).toEqual({ status: "confirmation-required" });
    // No bearer token means the device cannot prove this identity, so it must
    // not adopt an offline workspace under it.
    expect(harness.store.get(OWNER_KEY)).toBeUndefined();
    expect(harness.store.get(USER_KEY)).toBeUndefined();
    expect(harness.startSyncSession).not.toHaveBeenCalled();
    expect(useSession.getState().userId).toBeNull();
  });

  it("marks a fresh account so the guard sends it to onboarding rather than waiting for a pull", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: { user: USER_A, session: { user: USER_A } }, error: null });

    expect(await useSession.getState().signUp("a@example.com", "Str0ng-passphrase!")).toEqual({ status: "signed-in" });

    expect(useSession.getState()).toMatchObject({
      userId: USER_A.id,
      isNewSignup: true,
      isOnlineSession: true,
      previousLoginAt: null,
    });
    expect(harness.startSyncSession).toHaveBeenCalledWith(USER_A.id);
  });

  it("passes the provider's refusal back as something a person can read", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: null, error: { message: "User already registered" } });

    const result = await useSession.getState().signUp("a@example.com", "Str0ng-passphrase!");

    expect(result.status).toBe("error");
    expect(result).not.toMatchObject({ message: "User already registered" });
  });
});
