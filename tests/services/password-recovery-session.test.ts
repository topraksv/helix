import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../../src/i18n/tr";

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
      verifyOtp: vi.fn(async (): Promise<{
        data: { session: { user: { id: string; email: string } } | null };
        error: { name: string; message: string; code?: string; status?: number } | null;
      }> => ({ data: { session: { user: { id: "user-b", email: "b@example.com" } } }, error: null })),
    },
  };
  // The client a reset link is redeemed on: its own, never the app's.
  const recovery = {
    auth: {
      verifyOtp: vi.fn(async (): Promise<{
        data: { session: { user: { id: string; email: string } } | null };
        error: { name: string; message: string; code?: string; status?: number } | null;
      }> => ({ data: { session: { user: { id: "user-b", email: "b@example.com" } } }, error: null })),
      updateUser: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return {
    supabase,
    recovery,
    resetLocalWorkspace: vi.fn(),
    subscribeAuthEvents: (listener: (event: string) => void) => {
      authEventListener = listener;
    },
    emitAuthEvent: (event: string) => authEventListener?.(event),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("../../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: vi.fn(),
  createRecoveryClient: () => harness.recovery,
  getSupabase: () => harness.supabase,
  isSupabaseConfigured: true,
  markPasswordRecoverySession: vi.fn(),
  subscribeSupabaseAuthEvents: harness.subscribeAuthEvents,
  wasPasswordRecoveryDetected: vi.fn(() => true),
}));
vi.mock("../../src/db/mutations", () => ({
  pendingOutboxCount: vi.fn(async () => 0),
  resetLocalWorkspace: (...args: unknown[]) => harness.resetLocalWorkspace(...args),
  writeSetting: vi.fn(async () => {}),
}));
vi.mock("../../src/sync/engine", () => ({
  flushOutbox: vi.fn(async () => {}),
  runSyncSessionTask: vi.fn(async (_userId: string, task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  startSyncSession: vi.fn(),
  stopSyncSession: vi.fn(async () => {}),
  // Account deletion clears the Storage bucket first; the sync facade owns it.
  purgeRemoteAttachments: vi.fn(async () => {}),
}));
vi.mock("../../src/sync/status", () => ({
  useSyncStatus: { getState: () => ({ set: vi.fn() }) },
}));
vi.mock("../../src/services/markets", () => ({
  connectMarkets: vi.fn(),
  disconnectMarkets: vi.fn(),
}));
vi.mock("../../src/services/fx-fetch", () => ({
  clearRateCache: vi.fn(),
  loadRateCache: vi.fn(async () => {}),
}));
vi.mock("../../src/services/notifications", () => ({
  clearAccountNotifications: vi.fn(async () => {}),
  rescheduleAll: vi.fn(),
}));
vi.mock("../../src/services/kv", () => ({
  kv: {
    get: vi.fn(async () => "user-a"),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { useSession } = await import("../../src/auth/session");

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

/**
 * The link the reset e-mail carries now: the token arrives unspent and is
 * redeemed on save, on a client of its own — so it works in whichever browser
 * the mail app opens, a link checker that fetches the page spends nothing, and
 * nothing the device is signed in with is touched.
 */
describe("password recovery from an unspent token link", () => {
  // Node has no `location`, so the store reads links as the native target does.
  const link = "helix://reset-password?token_hash=pkce_token&type=recovery";
  const recovery = harness.recovery.auth;
  const authError = (name: string, message: string, code?: string, status?: number) => ({
    data: { session: null },
    error: { name, message, code, status },
  });

  beforeEach(async () => {
    recovery.verifyOtp.mockClear();
    recovery.updateUser.mockClear();
    recovery.signOut.mockClear();
    harness.supabase.auth.updateUser.mockClear();
    harness.supabase.auth.signOut.mockClear();
    harness.supabase.auth.setSession.mockClear();
    harness.resetLocalWorkspace.mockReset();
    harness.supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-b", email: "b@example.com" } } },
    });
    useSession.setState({ userId: null, email: null, isOnlineSession: false });
    // Preparing a link clears whatever an earlier case left held for a retry.
    await useSession.getState().preparePasswordRecovery(link);
  });

  it("opens the form without spending the token", async () => {
    // No session to fall back on: "ready" can only come from the token itself.
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(useSession.getState().preparePasswordRecovery(link)).resolves.toBe("ready");
    expect(recovery.verifyOtp).not.toHaveBeenCalled();
  });

  it("spends the token on save and really changes the password, on a client of its own", async () => {
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBeNull();

    expect(recovery.verifyOtp).toHaveBeenCalledWith({ token_hash: "pkce_token", type: "recovery" });
    expect(recovery.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(recovery.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(harness.supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("changes another account's password without touching the account signed in here", async () => {
    useSession.setState({ userId: "user-a", email: "a@example.com", isOnlineSession: true });

    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBeNull();

    expect(recovery.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(harness.supabase.auth.signOut).not.toHaveBeenCalled();
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
    expect(useSession.getState().userId).toBe("user-a");
  });

  it("sends a spent or expired token to the expired screen and changes nothing", async () => {
    recovery.verifyOtp.mockResolvedValueOnce(authError("AuthApiError", "Email link is invalid or has expired", "otp_expired", 403));
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBe(tr.auth.resetExpiredBody);
    expect(recovery.updateUser).not.toHaveBeenCalled();
  });

  it("sends any other refusal to the invalid screen", async () => {
    recovery.verifyOtp.mockResolvedValueOnce(authError("AuthApiError", "Token has been revoked", "bad_jwt", 400));
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBe(tr.auth.resetInvalidBody);
    expect(recovery.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the token when the request never reached Auth, so the same link works on retry", async () => {
    recovery.verifyOtp.mockResolvedValueOnce(authError("AuthRetryableFetchError", "Failed to fetch", undefined, 0));

    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBe(tr.auth.errNetwork);
    expect(recovery.updateUser).not.toHaveBeenCalled();
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBeNull();

    expect(recovery.verifyOtp).toHaveBeenCalledTimes(2);
    expect(recovery.updateUser).toHaveBeenCalledTimes(1);
  });

  it("keeps the redeemed session when the save is refused, so a retry needs no new link", async () => {
    recovery.updateUser.mockResolvedValueOnce({ error: { message: "New password should be different from the old password." } });

    await expect(useSession.getState().completePasswordRecovery("old-password")).resolves.toBe(tr.auth.errSamePassword);
    expect(recovery.signOut).not.toHaveBeenCalled();
    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBeNull();

    expect(recovery.verifyOtp).toHaveBeenCalledTimes(1);
    expect(recovery.updateUser).toHaveBeenCalledTimes(2);
  });

  it("does not spend a token an earlier link left behind", async () => {
    await expect(useSession.getState().preparePasswordRecovery("helix://reset-password?error_code=otp_expired")).resolves.toBe("expired");
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    await expect(useSession.getState().completePasswordRecovery("new-password")).resolves.toBe(tr.auth.resetInvalidBody);
    expect(recovery.verifyOtp).not.toHaveBeenCalled();
  });

  it("refuses an older link in a tab that does not hold Helix, rather than sharing that tab's session", async () => {
    await expect(useSession.getState().preparePasswordRecovery(
      "helix://reset-password#access_token=access&refresh_token=refresh&type=recovery",
      { standalone: true },
    )).resolves.toBe("invalid");
    expect(harness.supabase.auth.setSession).not.toHaveBeenCalled();
    // A token link is still welcome there: it never touches the shared session.
    await expect(useSession.getState().preparePasswordRecovery(link, { standalone: true })).resolves.toBe("ready");
  });
});
