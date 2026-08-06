import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

const harness = vi.hoisted(() => {
  const supabase = {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: "user-a", email: "a@example.com" } } })),
    },
  };
  return { supabase, startSyncSession: vi.fn() };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  getSupabase: () => harness.supabase,
  isSupabaseConfigured: true,
  markPasswordRecoverySession: vi.fn(),
  subscribeSupabaseAuthEvents: vi.fn(),
  wasPasswordRecoveryDetected: vi.fn(() => false),
}));
vi.mock("../src/db/mutations", () => ({
  pendingOutboxCount: vi.fn(async () => 0),
  resetLocalWorkspace: vi.fn(async () => {}),
  writeSetting: vi.fn(async () => {}),
}));
vi.mock("../src/sync/engine", () => ({
  flushOutbox: vi.fn(async () => {}),
  runSyncSessionTask: vi.fn(async (_userId: string, task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  startSyncSession: harness.startSyncSession,
  stopSyncSession: vi.fn(async () => {}),
}));
vi.mock("../src/sync/status", () => ({
  useSyncStatus: { getState: () => ({ set: vi.fn() }) },
}));
vi.mock("../src/services/markets", () => ({
  connectMarkets: vi.fn(),
  disconnectMarkets: vi.fn(),
}));
vi.mock("../src/services/fx-fetch", () => ({
  clearRateCache: vi.fn(),
  loadRateCache: vi.fn(async () => {}),
}));
vi.mock("../src/services/notifications", () => ({
  clearAccountNotifications: vi.fn(async () => {}),
  rescheduleAll: vi.fn(async () => {}),
}));
vi.mock("../src/services/kv", () => ({
  kv: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { useSession } = await import("../src/auth/session");

describe("sensitive-operation reauthentication", () => {
  beforeEach(() => {
    harness.supabase.auth.signInWithPassword.mockReset();
    harness.supabase.auth.signUp.mockReset();
    harness.supabase.auth.signOut.mockClear();
    harness.supabase.auth.updateUser.mockClear();
    harness.startSyncSession.mockClear();
    useSession.setState({
      userId: "user-a",
      email: "a@example.com",
      ready: true,
      isOnlineSession: true,
      isNewSignup: false,
      isFreezing: false,
      previousLoginAt: null,
    });
  });

  it("rejects and locally discards a successful re-auth for another account", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-b", email: "b@example.com" } },
      error: null,
    });

    await expect(useSession.getState().verifyPassword("correct-for-b")).resolves.toBe(tr.auth.errSessionExpired);
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(useSession.getState().userId).toBe("user-a");
    expect(useSession.getState().isOnlineSession).toBe(false);
  });

  it("accepts re-auth only when the Supabase identity matches the workspace owner", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-a", email: "a@example.com" } },
      error: null,
    });

    await expect(useSession.getState().verifyPassword("correct-for-a")).resolves.toBeNull();
    expect(harness.supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("sends the current password to the server-side password-change boundary", async () => {
    await expect(useSession.getState().changePassword("current-password", "new-password")).resolves.toBeNull();
    expect(harness.supabase.auth.updateUser).toHaveBeenCalledWith({
      current_password: "current-password",
      password: "new-password",
    });
  });

  it("rejects a short new password before calling Supabase", async () => {
    await expect(useSession.getState().changePassword("current-password", "short")).resolves.toBe(tr.auth.errWeakPassword);
    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("does not open a workspace before the signup e-mail is confirmed", async () => {
    useSession.setState({ userId: null, email: null, isOnlineSession: false, isNewSignup: false });
    harness.supabase.auth.signUp.mockResolvedValue({
      data: {
        user: { id: "pending-user", email: "pending@example.com" },
        session: null,
      },
      error: null,
    });

    await expect(useSession.getState().signUp("pending@example.com", "new-password"))
      .resolves.toEqual({ status: "confirmation-required" });
    expect(useSession.getState().userId).toBeNull();
    expect(useSession.getState().isOnlineSession).toBe(false);
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });
});
