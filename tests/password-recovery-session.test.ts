import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

const harness = vi.hoisted(() => {
  let authEventListener: ((event: string) => void) | null = null;
  const supabase = {
    auth: {
      getSession: vi.fn(async (): Promise<{
        data: { session: { user: { id: string; email: string } } | null };
      }> => ({ data: { session: { user: { id: "user-b", email: "b@example.com" } } } })),
      setSession: vi.fn(async () => ({ data: { session: { user: { id: "user-b", email: "b@example.com" } } }, error: null })),
      signOut: vi.fn(async () => {
        authEventListener?.("SIGNED_OUT");
        return { error: null };
      }),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  };
  return {
    supabase,
    resetLocalWorkspace: vi.fn(),
    subscribeAuthEvents: (listener: (event: string) => void) => {
      authEventListener = listener;
    },
    emitAuthEvent: (event: string) => authEventListener?.(event),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  getSupabase: () => harness.supabase,
  isSupabaseConfigured: true,
  markPasswordRecoverySession: vi.fn(),
  subscribeSupabaseAuthEvents: harness.subscribeAuthEvents,
  wasPasswordRecoveryDetected: vi.fn(() => true),
}));
vi.mock("../src/db/mutations", () => ({
  pendingOutboxCount: vi.fn(async () => 0),
  resetLocalWorkspace: (...args: unknown[]) => harness.resetLocalWorkspace(...args),
  writeSetting: vi.fn(async () => {}),
}));
vi.mock("../src/sync/engine", () => ({
  flushOutbox: vi.fn(async () => {}),
  runSyncSessionTask: vi.fn(async (_userId: string, task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  startSyncSession: vi.fn(),
  stopSyncSession: vi.fn(async () => {}),
  // Account deletion clears the Storage bucket first; the sync facade owns it.
  purgeRemoteAttachments: vi.fn(async () => {}),
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
  rescheduleAll: vi.fn(),
}));
vi.mock("../src/services/kv", () => ({
  kv: {
    get: vi.fn(async () => "user-a"),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { useSession } = await import("../src/auth/session");

describe("password recovery account binding", () => {
  beforeEach(async () => {
    harness.supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    await useSession.getState().bootstrap();
    harness.supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-b", email: "b@example.com" } } },
    });
    harness.supabase.auth.signOut.mockImplementation(async () => {
      harness.emitAuthEvent("SIGNED_OUT");
      return { error: null };
    });
    harness.supabase.auth.updateUser.mockClear();
    harness.resetLocalWorkspace.mockReset();
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

  it("does not update or wipe the local account when recovery belongs to another user", async () => {
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBe(tr.auth.resetInvalidBody);

    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a foreign recovery session before exposing the password form", async () => {
    await expect(useSession.getState().preparePasswordRecovery(
      "helix://reset-password#access_token=access&refresh_token=refresh&type=recovery",
    )).resolves.toBe("invalid");

    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(useSession.getState().userId).toBe("user-a");
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
  });
});
