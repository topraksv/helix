import { beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../src/i18n/tr";

const harness = vi.hoisted(() => {
  const values = new Map<string, string>([
    ["helix.local_owner", "user-a"],
    ["helix.last_user_id", "user-a"],
    ["helix.last_email", "a@example.com"],
  ]);
  // Annotated rather than inferred: `async () => ({ error: null })` infers the
  // error as `null` itself, so a test that makes the cloud REFUSE could not
  // state what it refused with. The refusals are the point of this file.
  type SupabaseError = { message: string } | null;
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      signOut: vi.fn(async (): Promise<{ error: SupabaseError }> => ({ error: null })),
    },
    rpc: vi.fn(async (): Promise<{ error: SupabaseError }> => ({ error: null })),
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
  // Account deletion clears the Storage bucket first; the sync facade owns it.
  purgeRemoteAttachments: vi.fn(async () => {}),
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

/**
 * Signing out, which wipes the device on purpose.
 *
 * A finance app leaves no plaintext records behind after an explicit sign-out,
 * so this is a destructive path guarded by one promise: it will not run while
 * a change the owner believes is saved is still only on this device. Every arm
 * of that promise — the refusal, the override, and what happens when the wipe
 * itself fails — was written down in the module and covered by nothing.
 */
describe("signing out", () => {
  beforeEach(() => {
    harness.values.clear();
    harness.values.set("helix.local_owner", "user-a");
    harness.values.set("helix.last_user_id", "user-a");
    harness.values.set("helix.last_email", "a@example.com");
    harness.resetLocalWorkspace.mockReset().mockResolvedValue(undefined);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    harness.supabase.auth.signOut.mockReset().mockResolvedValue({ error: null });
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

  async function pendingRowsRemain(count: number): Promise<void> {
    const { pendingOutboxCount } = await import("../src/db/mutations");
    vi.mocked(pendingOutboxCount).mockResolvedValue(count);
  }

  it("refuses while a change exists only on this device", async () => {
    await pendingRowsRemain(3);

    const result = await useSession.getState().signOut();

    expect(result).toBe(tr.auth.signOutPendingBlocked);
    // Refusing means refusing: nothing was wiped and the session stands.
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
    expect(useSession.getState().userId).toBe("user-a");
  });

  /** `force` is the caller's proof that the owner was asked and accepted. */
  it("goes ahead when the caller has taken responsibility for the loss", async () => {
    await pendingRowsRemain(3);

    const result = await useSession.getState().signOut({ force: true });

    expect(result).toBeNull();
    expect(harness.resetLocalWorkspace).toHaveBeenCalled();
    expect(useSession.getState().userId).toBeNull();
    expect(harness.values.has("helix.local_owner")).toBe(false);
  });

  it("signs out normally once nothing is left unsynced", async () => {
    await pendingRowsRemain(0);

    const result = await useSession.getState().signOut();

    expect(result).toBeNull();
    expect(useSession.getState().userId).toBeNull();
    expect(harness.values.has("helix.last_user_id")).toBe(false);
  });

  /**
   * The wipe failing is not the same as the sign-out failing. The session has
   * to come BACK — with its background work restored — or the app is left
   * holding a live account's records under no account at all.
   */
  it("keeps the session alive when the device could not be wiped", async () => {
    await pendingRowsRemain(0);
    harness.resetLocalWorkspace.mockRejectedValue(new Error("storage unavailable"));

    const result = await useSession.getState().signOut();

    expect(result).toBe(tr.errors.workspaceResetFailed);
    expect(useSession.getState().userId).toBe("user-a");
    expect(harness.values.get("helix.local_owner")).toBe("user-a");
    const { startSyncSession } = await import("../src/sync/engine");
    expect(startSyncSession).toHaveBeenCalledWith("user-a");
  });
});

/**
 * What happens BEFORE the local wipe, which is the half that decides whether
 * any of it happens at all.
 *
 * Deleting an account erases the cloud identity first and only then touches the
 * device, so that a failure can never report "deleted" over data that is still
 * there. Every arm of that ordering was written down in the module and
 * exercised by nothing — and the arms are not interchangeable: one of them must
 * abort and keep everything, one must continue and lose nothing, and one must
 * name a remedy instead of a generic failure.
 */
describe("account deletion when the cloud refuses", () => {
  beforeEach(() => {
    harness.values.clear();
    harness.values.set("helix.local_owner", "user-a");
    harness.values.set("helix.last_user_id", "user-a");
    harness.values.set("helix.last_email", "a@example.com");
    // Succeeds here, so the only thing under test is what the cloud says.
    harness.resetLocalWorkspace.mockReset().mockResolvedValue(undefined);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    harness.supabase.auth.signOut.mockReset().mockResolvedValue({ error: null });
    harness.supabase.rpc.mockReset().mockResolvedValue({ error: null });
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

  /**
   * The whole reason the cloud goes first. If the identity survives, the device
   * must survive with it — otherwise the owner is signed out of an account that
   * still exists, holding a device that no longer has their records.
   */
  it("touches nothing on the device when the identity could not be deleted", async () => {
    harness.supabase.rpc.mockResolvedValue({ error: { message: "network request failed" } });

    const result = await useSession.getState().deleteAccount();

    expect(result).toBe(tr.account.deleteCloudFailed);
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
    expect(useSession.getState().userId).toBe("user-a");
    expect(harness.values.get("helix.local_owner")).toBe("user-a");
  });

  /**
   * An expired session is the one refusal with an action attached: sign in
   * again. Reporting it as "nothing was deleted" would be true and useless.
   */
  it("names the remedy when the refusal is an expired session", async () => {
    harness.supabase.rpc.mockResolvedValue({ error: { message: "JWT expired" } });

    const result = await useSession.getState().deleteAccount();

    expect(result).toBe(tr.auth.errSessionExpired);
    expect(harness.resetLocalWorkspace).not.toHaveBeenCalled();
  });

  /**
   * The opposite rule, and the reason it is written down: an unreachable FILE
   * must never become the reason an account survives. Migration 35 repeats the
   * removal inside the RPC, so the account is cleaned either way.
   */
  it("deletes the account even when the stored documents cannot be reached", async () => {
    const { purgeRemoteAttachments } = await import("../src/sync/engine");
    vi.mocked(purgeRemoteAttachments).mockRejectedValueOnce(new Error("storage unreachable"));

    const result = await useSession.getState().deleteAccount();

    expect(result).toBeNull();
    expect(harness.supabase.rpc).toHaveBeenCalledWith("delete_own_account");
    expect(harness.resetLocalWorkspace).toHaveBeenCalled();
    expect(useSession.getState().userId).toBeNull();
  });

  /**
   * The successful path, end to end, and the state it must leave behind: no
   * owner marker at all, rather than the wipe-pending marker its failing
   * sibling writes. A leftover marker would refuse the next account.
   */
  it("clears every device marker when the whole delete succeeds", async () => {
    const result = await useSession.getState().deleteAccount();

    expect(result).toBeNull();
    expect(harness.values.has("helix.local_owner")).toBe(false);
    expect(harness.values.has("helix.last_user_id")).toBe(false);
    expect(harness.values.has("helix.last_email")).toBe(false);
    // Every device's token, not just this one: the identity is gone.
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});
