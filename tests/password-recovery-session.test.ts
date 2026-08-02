import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

const harness = vi.hoisted(() => {
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-b", email: "b@example.com" } } } })),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  };
  return { supabase, resetLocalWorkspace: vi.fn() };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  getSupabase: () => harness.supabase,
  isSupabaseConfigured: true,
  markPasswordRecoverySession: vi.fn(),
  subscribeSupabaseAuthEvents: vi.fn(),
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
  beforeEach(() => {
    harness.supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-b", email: "b@example.com" } } },
    });
    harness.supabase.auth.signOut.mockResolvedValue({ error: null });
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
});
