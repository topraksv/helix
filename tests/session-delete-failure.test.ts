import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

const harness = vi.hoisted(() => {
  const values = new Map<string, string>([
    ["helix.local_owner", "user-a"],
    ["helix.last_user_id", "user-a"],
    ["helix.last_email", "a@example.com"],
  ]);
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async () => ({ error: null })),
  };
  return {
    values,
    supabase,
    resetLocalWorkspace: vi.fn(),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  getSupabase: () => harness.supabase,
  isSupabaseConfigured: true,
  subscribeSupabaseAuthEvents: vi.fn(),
  wasPasswordRecoveryDetected: vi.fn(() => false),
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
vi.mock("../src/services/markets", () => ({
  clearMarkets: vi.fn(),
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
    get: vi.fn(async (key: string) => harness.values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void harness.values.set(key, value)),
    remove: vi.fn(async (key: string) => void harness.values.delete(key)),
  },
}));

const { useSession } = await import("../src/auth/session");

describe("account deletion after a local wipe failure", () => {
  beforeEach(() => {
    harness.values.set("helix.local_owner", "user-a");
    harness.values.set("helix.last_user_id", "user-a");
    harness.values.set("helix.last_email", "a@example.com");
    harness.resetLocalWorkspace.mockReset().mockRejectedValue(new Error("storage unavailable"));
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    harness.supabase.auth.signOut.mockResolvedValue({ error: null });
    harness.supabase.rpc.mockResolvedValue({ error: null });
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

  it("does not reopen the deleted account on the next offline bootstrap", async () => {
    await expect(useSession.getState().deleteAccount()).resolves.toBe(tr.errors.workspaceResetFailed);

    await useSession.getState().bootstrap();

    expect(useSession.getState().userId).toBeNull();
    expect(harness.values.get("helix.local_owner")).toBe("__helix_wipe_pending__");
    expect(harness.values.has("helix.last_user_id")).toBe(false);
    expect(harness.values.has("helix.last_email")).toBe(false);
  });
});
