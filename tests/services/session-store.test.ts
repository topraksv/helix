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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tr } from "../../src/i18n/tr";

interface FakeUser {
  id: string;
  email: string;
  last_sign_in_at?: string;
}

const harness = vi.hoisted(() => {
  const store = new Map<string, string>();
  /** Every side effect a session change has, in the order it happened. */
  const log: string[] = [];
  return {
    store,
    log,
    supabase: {
      auth: {
        getSession: vi.fn(async (): Promise<{ data: { session: { user: FakeUser } | null } }> => ({
          data: { session: null },
        })),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(async (_options?: unknown) => ({ error: null })),
        getUser: vi.fn(),
        updateUser: vi.fn(async (_attributes: unknown) => ({ error: null as { message: string } | null })),
        resetPasswordForEmail: vi.fn(async (_email: string, _options: unknown) => ({ error: null })),
        exchangeCodeForSession: vi.fn(),
        setSession: vi.fn(),
      },
      rpc: vi.fn(async (_name: string) => ({ error: null as { message: string } | null })),
    },
    platform: { OS: "web" },
    authListeners: [] as ((event: string) => void)[],
    recovery: {
      clear: vi.fn(),
      mark: vi.fn(),
      detected: vi.fn((_userId?: string) => false),
    },
    pendingOutbox: vi.fn(async () => 0),
    flushOutbox: vi.fn(async (_userId: string) => {}),
    startSyncSession: vi.fn(),
    stopSyncSession: vi.fn(async (userId?: string) => {
      log.push(`stop:${userId}`);
    }),
    resetLocalWorkspace: vi.fn(async () => {}),
    writeSetting: vi.fn(async () => {}),
    configured: { value: true },
    // Device-local writes that refuse, chosen by key. On native this is a
    // keychain error from SecureStore; on web a browser told to block site
    // data. Null by default, so every other case sees the plain map above.
    kvWriteFails: { pattern: null as RegExp | null },
    kvReadFails: { pattern: null as RegExp | null },
    // A store that resolves the write and keeps nothing — what `kv` now does
    // on web when the browser refuses it.
    kvDropsWrites: { pattern: null as RegExp | null },
  };
});

vi.mock("react-native", () => ({ Platform: harness.platform }));
vi.mock("../../src/sync/supabase", () => ({
  clearPasswordRecoveryDetected: harness.recovery.clear,
  getSupabase: () => (harness.configured.value ? harness.supabase : null),
  get isSupabaseConfigured() {
    return harness.configured.value;
  },
  markPasswordRecoverySession: harness.recovery.mark,
  subscribeSupabaseAuthEvents: (listener: (event: string) => void) => {
    harness.authListeners.push(listener);
    return () => true;
  },
  wasPasswordRecoveryDetected: harness.recovery.detected,
}));
vi.mock("../../src/db/mutations", () => ({
  pendingOutboxCount: harness.pendingOutbox,
  resetLocalWorkspace: async () => {
    harness.log.push("wipe");
    return harness.resetLocalWorkspace();
  },
  writeSetting: harness.writeSetting,
}));
vi.mock("../../src/sync/engine", () => ({
  flushOutbox: harness.flushOutbox,
  eraseDeviceAttachments: async () => {
    harness.log.push("attachments:erase");
  },
  purgeRemoteAttachments: async () => {
    harness.log.push("attachments:purge");
    return true;
  },
  reconcileAttachments: async () => {
    harness.log.push("attachments:send");
  },
  unsentAttachments: async () => ({ count: 0, verified: true }),
  runSyncSessionTask: vi.fn(async (_userId: string, task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  startSyncSession: harness.startSyncSession,
  stopSyncSession: harness.stopSyncSession,
}));
vi.mock("../../src/sync/status", () => ({
  useSyncStatus: { getState: () => ({ set: (state: unknown) => harness.log.push(`status:${JSON.stringify(state)}`) }) },
}));
vi.mock("../../src/services/markets", () => ({
  connectMarkets: () => harness.log.push("markets:on"),
  disconnectMarkets: () => harness.log.push("markets:off"),
}));
vi.mock("../../src/services/fx-fetch", () => ({
  clearRateCache: () => harness.log.push("fx:clear"),
  loadRateCache: async (userId: string) => {
    harness.log.push(`fx:load:${userId}`);
  },
}));
vi.mock("../../src/services/notifications", () => ({
  clearAccountNotifications: async (resetDetails?: boolean) => {
    harness.log.push(`notifications:clear:${resetDetails}`);
  },
  rescheduleAll: async (userId: string) => {
    harness.log.push(`notifications:plan:${userId}`);
  },
}));
vi.mock("../../src/services/diagnostics", () => ({
  resetDiagnosticUploads: async () => {
    harness.log.push("diagnostics:reset");
  },
}));
// A real map, not a stub returning null: the login history this store keeps is
// read back by the same call that wrote it, and a kv that forgets would make
// `previousLoginAt` vacuously null in every case below.
vi.mock("../../src/services/kv", () => ({
  kv: {
    get: vi.fn(async (key: string) => {
      if (harness.kvReadFails.pattern?.test(key)) throw new Error("keychain unavailable");
      return harness.store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      harness.log.push(`kv:set:${key}`);
      if (harness.kvWriteFails.pattern?.test(key)) throw new Error("keychain unavailable");
      if (harness.kvDropsWrites.pattern?.test(key)) return;
      harness.store.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      harness.log.push(`kv:remove:${key}`);
      harness.store.delete(key);
    }),
  },
}));

const { SIGN_OUT_PENDING_CHANGES, useSession } = await import("../../src/auth/session");
const { LOCAL_ONLY_USER_ID } = await import("../../src/domain/user-id");

const OWNER_KEY = "helix.local_owner";
const USER_KEY = "helix.last_user_id";
const EMAIL_KEY = "helix.last_email";

const USER_A = { id: "user-a", email: "a@example.com", last_sign_in_at: "2026-09-01T08:00:00.000Z" };

function reset(): void {
  harness.store.clear();
  harness.log.length = 0;
  harness.platform.OS = "web";
  harness.recovery.clear.mockClear();
  harness.recovery.mark.mockClear();
  harness.recovery.detected.mockReset();
  harness.recovery.detected.mockReturnValue(false);
  harness.pendingOutbox.mockReset();
  harness.pendingOutbox.mockResolvedValue(0);
  harness.flushOutbox.mockReset();
  harness.flushOutbox.mockResolvedValue(undefined);
  harness.supabase.auth.getUser.mockReset();
  harness.supabase.auth.updateUser.mockReset();
  harness.supabase.auth.updateUser.mockResolvedValue({ error: null });
  harness.supabase.auth.resetPasswordForEmail.mockClear();
  harness.supabase.auth.exchangeCodeForSession.mockReset();
  harness.supabase.auth.setSession.mockReset();
  harness.supabase.rpc.mockReset();
  harness.supabase.rpc.mockResolvedValue({ error: null });
  harness.configured.value = true;
  harness.supabase.auth.getSession.mockReset();
  harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
  harness.supabase.auth.signInWithPassword.mockReset();
  harness.supabase.auth.signUp.mockReset();
  harness.supabase.auth.signOut.mockReset();
  harness.supabase.auth.signOut.mockResolvedValue({ error: null });
  harness.startSyncSession.mockClear();
  harness.stopSyncSession.mockClear();
  harness.resetLocalWorkspace.mockReset();
  harness.resetLocalWorkspace.mockResolvedValue(undefined);
  harness.writeSetting.mockClear();
  harness.kvWriteFails.pattern = null;
  harness.kvReadFails.pattern = null;
  harness.kvDropsWrites.pattern = null;
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

  /**
   * The matrix pin is the entry form's problem again, one key family over.
   * `togglePin` stores a COLUMN KEY, and `src/domain/cash-flow-matrix.ts`
   * builds those from `category.id` and `column.id` — row ids that exist only
   * inside one account's workspace. Nothing removed them, so on web a shared
   * browser carried the previous account's ids past sign-out, exactly as
   * `helix.last.*` did before it was fixed.
   */
  it("clears the previous account's pinned matrix ids on an account switch", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.store.set(OWNER_KEY, "user-b");
    harness.store.set("helix.matrix.pinned.rows", "b-category-id");
    harness.store.set("helix.matrix.pinned.columns", "b-computed-column-id");
    harness.store.set("helix.matrix.pinned", "b-legacy-pin-id");

    expect(await useSession.getState().signIn("a@example.com", "pw")).toBeNull();

    expect(harness.store.get("helix.matrix.pinned.rows")).toBeUndefined();
    expect(harness.store.get("helix.matrix.pinned.columns")).toBeUndefined();
    expect(harness.store.get("helix.matrix.pinned")).toBeUndefined();
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

  /**
   * The remembered-user and login-history writes are conveniences for the NEXT
   * cold start; the account is already authenticated by the time they run.
   * Letting one reject loses the session that was just granted, and the
   * sign-in screen turns the rejection into "istek basarisiz" — so the user is
   * refused, told the wrong reason, and refused again on every retry, because
   * the retry fails at the same write. Offline re-open degrades; the sign-in
   * itself must not.
   */
  it("keeps a session the account already earned when the device cannot remember it", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.kvWriteFails.pattern = /^helix\.(last_|login\.)/;

    expect(await useSession.getState().signIn("a@example.com", "pw")).toBeNull();

    expect(useSession.getState()).toMatchObject({ userId: USER_A.id, isOnlineSession: true, previousLoginAt: null });
    expect(harness.startSyncSession).toHaveBeenCalledWith(USER_A.id);
  });

  /**
   * The owner marker is the opposite case, and it is why the writes above are
   * softened one by one rather than by making the store swallow everything. It
   * is the only record that this device's rows belong to this account, so a
   * marker that cannot be stored means the NEXT account would skip the wipe
   * and open them. Refuse, and say which thing failed.
   */
  it("refuses a sign-in whose workspace owner the device cannot record", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.kvWriteFails.pattern = /^helix\.local_owner$/;

    expect(await useSession.getState().signIn("a@example.com", "pw"))
      .toBe(tr.errors.workspaceOwnerUnrecorded);

    expect(useSession.getState().userId).toBeNull();
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });

  /**
   * A store that accepts the write and keeps nothing is the web half of the
   * same failure, and the one a rejection-only check misses entirely.
   */
  it("refuses a sign-in when the owner marker is accepted but not kept", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.kvDropsWrites.pattern = /^helix\.local_owner$/;

    expect(await useSession.getState().signIn("a@example.com", "pw"))
      .toBe(tr.errors.workspaceOwnerUnrecorded);

    expect(useSession.getState().userId).toBeNull();
    expect(harness.startSyncSession).not.toHaveBeenCalled();
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

const USER_B = { id: "user-b", email: "b@example.com" };
const STRONG = "Str0ng-passphrase!";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const SIGNED_OUT = { userId: null, email: null, isOnlineSession: false, isNewSignup: false, isFreezing: false, previousLoginAt: null };
/** What leaving an account clears from the device, in the order it does it. */
const ACCOUNT_DEVICE_STATE = [
  `status:${JSON.stringify({ state: "idle", lastSyncAt: null, error: null, remoteChangeAt: null })}`,
  "diagnostics:reset",
  ...["helix.last.income", "helix.last.expense", "helix.last.transfer",
    "helix.matrix.pinned", "helix.matrix.pinned.rows", "helix.matrix.pinned.columns"].map((key) => `kv:remove:${key}`),
];
const LEAVE_ACCOUNT = ["markets:off", "fx:clear", "notifications:clear:true", ...ACCOUNT_DEVICE_STATE, "wipe"];

/** The store as a fresh module, so its one-time subscription and brake start clean. */
async function freshSession() {
  vi.resetModules();
  harness.authListeners.length = 0;
  return (await import("../../src/auth/session")).useSession;
}

function openAccount(session: typeof useSession, user: { id: string; email: string } = USER_A): void {
  session.setState({ ...SIGNED_OUT, userId: user.id, email: user.email, ready: true, isOnlineSession: true });
  harness.store.set(OWNER_KEY, user.id);
  harness.store.set(USER_KEY, user.id);
  harness.store.set(EMAIL_KEY, user.email);
  harness.log.length = 0;
}

describe("a fresh store", () => {
  it("starts signed out and not ready", async () => {
    const session = await freshSession();
    expect(session.getState()).toMatchObject({ ...SIGNED_OUT, ready: false });
  });
});

describe("a session the server ends", () => {
  it("listens once, and only when there is a server to listen to", async () => {
    harness.configured.value = false;
    await (await freshSession()).getState().bootstrap();
    expect(harness.authListeners).toHaveLength(0);

    harness.configured.value = true;
    const session = await freshSession();
    await session.getState().bootstrap();
    await session.getState().bootstrap();
    expect(harness.authListeners).toHaveLength(1);
  });

  it("erases the workspace in order when the server signs this account out", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    openAccount(session);

    harness.authListeners[0]!("SIGNED_OUT");
    await vi.waitFor(() => expect(harness.log).toContain(`kv:remove:${EMAIL_KEY}`));

    expect(harness.log).toEqual([`stop:${USER_A.id}`, ...LEAVE_ACCOUNT, "attachments:erase", `kv:remove:${USER_KEY}`, `kv:remove:${EMAIL_KEY}`]);
    expect(session.getState()).toMatchObject(SIGNED_OUT);
  });

  it("ignores other events, a closed workspace, and a second sign-out while the first runs", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    harness.authListeners[0]!("SIGNED_OUT");
    await settle();
    expect(harness.log, "nothing is open, so nothing is erased").toEqual([]);

    openAccount(session);
    harness.authListeners[0]!("TOKEN_REFRESHED");
    await settle();
    expect(harness.log).toEqual([]);

    let release!: () => void;
    harness.stopSyncSession.mockImplementationOnce(async (userId?: string) => {
      harness.log.push(`stop:${userId}`);
      await new Promise<void>((resolve) => (release = resolve));
    });
    harness.authListeners[0]!("SIGNED_OUT");
    harness.authListeners[0]!("SIGNED_OUT");
    await settle();
    harness.authListeners[0]!("SIGNED_OUT");
    release();
    await vi.waitFor(() => expect(session.getState().userId).toBeNull());
    await settle();
    expect(harness.log.filter((entry) => entry.startsWith("stop:"))).toHaveLength(1);
  });

  it("leaves an account that took over while the old one was stopping", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    openAccount(session);
    harness.stopSyncSession.mockImplementationOnce(async () => {
      session.setState({ userId: USER_B.id });
    });

    harness.authListeners[0]!("SIGNED_OUT");
    await settle();
    await settle();

    expect(harness.log).not.toContain("wipe");
    expect(session.getState().userId).toBe(USER_B.id);
  });

  it("leaves an account that took over during the wipe", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    openAccount(session);
    harness.resetLocalWorkspace.mockImplementationOnce(async () => {
      session.setState({ userId: USER_B.id });
    });

    harness.authListeners[0]!("SIGNED_OUT");
    await vi.waitFor(() => expect(harness.log).toContain("wipe"));
    await settle();

    expect(session.getState().userId).toBe(USER_B.id);
    expect(harness.store.get(USER_KEY)).toBe(USER_A.id);
  });

  it("marks the workspace for a retried wipe when the device could not be erased", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    openAccount(session);
    harness.resetLocalWorkspace.mockRejectedValueOnce(new Error("disk"));

    harness.authListeners[0]!("SIGNED_OUT");
    await vi.waitFor(() => expect(session.getState().userId).toBeNull());

    expect(harness.store.get(OWNER_KEY)).toBe("__helix_wipe_pending__");
    expect(harness.log, "the session is over either way, so its documents go").toContain("attachments:erase");
  });

  it("does not erase this workspace for the sign-out that discards another account's session", async () => {
    const session = await freshSession();
    await session.getState().bootstrap();
    openAccount(session);
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_B }, error: null });
    harness.supabase.auth.signOut.mockImplementation(async () => {
      harness.authListeners[0]!("SIGNED_OUT");
      return { error: null };
    });

    expect(await session.getState().verifyPassword("pw")).toBe(tr.auth.errSessionExpired);
    await settle();

    expect(harness.log).not.toContain("wipe");
    expect(session.getState()).toMatchObject({ userId: USER_A.id, isOnlineSession: false });

    harness.supabase.auth.signOut.mockResolvedValue({ error: null });
    harness.authListeners[0]!("SIGNED_OUT");
    await vi.waitFor(() => expect(session.getState().userId).toBeNull());
  });
});

describe("switching accounts on one device", () => {
  it("clears the previous account's device state in order before adopting the next", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.store.set(OWNER_KEY, USER_B.id);

    expect(await useSession.getState().signIn(USER_A.email, "pw")).toBeNull();

    expect(harness.log.slice(0, harness.log.indexOf("wipe") + 1)).toEqual([`stop:undefined`, ...LEAVE_ACCOUNT]);
    expect(harness.supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: USER_A.email, password: "pw" });
  });

  it("adopts an unowned device without erasing it, and never rewrites its own marker", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });

    await useSession.getState().signIn(USER_A.email, "pw");
    expect(harness.log).not.toContain("wipe");
    expect(harness.log.filter((entry) => entry === `kv:set:${OWNER_KEY}`)).toHaveLength(1);

    harness.log.length = 0;
    await useSession.getState().signIn(USER_A.email, "pw");
    expect(harness.log).not.toContain(`kv:set:${OWNER_KEY}`);
    expect(harness.log).not.toContain("wipe");
  });

  it("refuses when the device cannot say who owns it", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: USER_A }, error: null });
    harness.kvReadFails.pattern = /^helix\.local_owner$/;

    expect(await useSession.getState().signIn(USER_A.email, "pw")).toBe(tr.errors.workspaceOwnerUnrecorded);
    expect(harness.log).not.toContain("wipe");
    expect(harness.log, "an unknown owner is never overwritten").not.toContain(`kv:set:${OWNER_KEY}`);
  });
});

describe("bootstrap, field by field", () => {
  it("reports a refused local-only workspace as offline", async () => {
    harness.configured.value = false;
    harness.store.set(OWNER_KEY, "someone-else");
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));
    useSession.setState({ isOnlineSession: true });

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: null, ready: true, isOnlineSession: false });
  });

  it("remembers no e-mail a session did not carry", async () => {
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: USER_A.id } as FakeUser } } });

    await useSession.getState().bootstrap();

    expect(harness.store.has(EMAIL_KEY)).toBe(false);
    expect(useSession.getState().email).toBeNull();
  });

  it("opens even when the login history cannot be read", async () => {
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });
    harness.kvReadFails.pattern = /^helix\.login\./;

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: USER_A.id, previousLoginAt: null });
  });

  it("reopens an account offline as offline and not as a fresh sign-up", async () => {
    harness.supabase.auth.getSession.mockRejectedValue(new Error("network"));
    harness.store.set(USER_KEY, USER_A.id);
    useSession.setState({ isOnlineSession: true, isNewSignup: true });

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: USER_A.id, isOnlineSession: false, isNewSignup: false });
  });

  it("refuses an offline reopen in full when the workspace could not be reset", async () => {
    harness.supabase.auth.getSession.mockRejectedValue(new Error("network"));
    harness.store.set(USER_KEY, USER_A.id);
    harness.store.set(OWNER_KEY, USER_B.id);
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));
    useSession.setState({ isOnlineSession: true, isNewSignup: true, previousLoginAt: "2026-01-01T00:00:00.000Z" });

    await useSession.getState().bootstrap();

    expect(useSession.getState()).toMatchObject({ userId: null, ready: true, isOnlineSession: false, isNewSignup: false, previousLoginAt: null });
  });
});

describe("signing in and up with an account that has no e-mail on record", () => {
  it("keeps the address that was typed", async () => {
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: USER_A.id } }, error: null });

    await useSession.getState().signIn(USER_A.email, "pw");

    expect(harness.store.get(EMAIL_KEY)).toBe(USER_A.email);
    expect(useSession.getState().email).toBe(USER_A.email);
  });

  it("keeps the address that was typed at sign-up too", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: { user: { id: USER_A.id }, session: { user: { id: USER_A.id } } }, error: null });

    await useSession.getState().signUp(USER_A.email, STRONG);

    expect(harness.supabase.auth.signUp).toHaveBeenCalledWith({ email: USER_A.email, password: STRONG });
    expect(harness.store.get(EMAIL_KEY)).toBe(USER_A.email);
    expect(useSession.getState().email).toBe(USER_A.email);
  });
});

describe("signUp refusals", () => {
  it("says the project is not configured", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().signUp(USER_A.email, STRONG))
      .toEqual({ status: "error", message: tr.errors.supabaseNotConfigured });
  });

  it("says the account was not created when the provider returns no user", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    expect(await useSession.getState().signUp(USER_A.email, STRONG))
      .toEqual({ status: "error", message: tr.errors.signUpFailed });
  });

  it("signs a new account out locally when the previous account's rows cannot be erased", async () => {
    harness.supabase.auth.signUp.mockResolvedValue({ data: { user: USER_A, session: { user: USER_A } }, error: null });
    harness.store.set(OWNER_KEY, USER_B.id);
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    expect(await useSession.getState().signUp(USER_A.email, STRONG))
      .toEqual({ status: "error", message: tr.errors.workspaceResetFailed });
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(useSession.getState().userId).toBeNull();
  });
});

describe("requesting a reset link", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("says the project is not configured", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().requestPasswordReset(USER_A.email)).toBe(tr.errors.supabaseNotConfigured);
  });

  it("points a phone's link at the published web page", async () => {
    harness.platform.OS = "ios";
    vi.stubGlobal("location", { origin: "http://localhost:8081" });

    expect(await useSession.getState().requestPasswordReset(` ${USER_A.email} `)).toBeNull();

    expect(harness.supabase.auth.resetPasswordForEmail)
      .toHaveBeenCalledWith(USER_A.email, { redirectTo: "https://topraksv.github.io/helix/reset-password" });
  });

  it("points a browser's link back at the page it came from, under its base path", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:8081" });
    await useSession.getState().requestPasswordReset(USER_A.email);
    vi.stubEnv("EXPO_BASE_URL", "/helix");
    await useSession.getState().requestPasswordReset(USER_A.email);

    expect(harness.supabase.auth.resetPasswordForEmail.mock.calls.map(([, options]) => options)).toEqual([
      { redirectTo: "http://localhost:8081/reset-password" },
      { redirectTo: "http://localhost:8081/helix/reset-password" },
    ]);
  });
});

describe("opening a reset link", () => {
  const native = (query: string) => `helix://reset-password?${query}`;
  const session = (id: string) => ({ data: { session: { user: { id } } }, error: null });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses every link without a server", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().preparePasswordRecovery(native("token_hash=t&type=recovery"))).toBe("invalid");
  });

  it("reads a browser's link against the page's own address", async () => {
    vi.stubGlobal("location", { origin: "https://helix.example" });
    expect(await useSession.getState().preparePasswordRecovery("https://helix.example/reset-password?token_hash=t&type=recovery"))
      .toBe("ready");
    vi.stubEnv("EXPO_BASE_URL", "/helix");
    expect(await useSession.getState().preparePasswordRecovery("https://helix.example/helix/reset-password?token_hash=t&type=recovery"))
      .toBe("ready");
    expect(await useSession.getState().preparePasswordRecovery(native("token_hash=t&type=recovery"))).toBe("invalid");
  });

  it("reads a phone's link against the app's own scheme, even where a page address exists", async () => {
    harness.platform.OS = "ios";
    vi.stubGlobal("location", { origin: "https://helix.example" });
    expect(await useSession.getState().preparePasswordRecovery(native("token_hash=t&type=recovery"))).toBe("ready");
  });

  it("redeems an older code link for this account and binds the recovery to it", async () => {
    openAccount(useSession);
    harness.supabase.auth.exchangeCodeForSession.mockResolvedValue(session(USER_A.id));

    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("ready");

    expect(harness.supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("c");
    expect(harness.recovery.mark).toHaveBeenCalledWith(USER_A.id);
  });

  it("accepts any account's link when no account is open here", async () => {
    harness.supabase.auth.exchangeCodeForSession.mockResolvedValue(session(USER_B.id));
    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("ready");
    expect(harness.recovery.mark).toHaveBeenCalledWith(USER_B.id);
  });

  it("refuses another account's link and drops only that account's session", async () => {
    openAccount(useSession);
    harness.supabase.auth.exchangeCodeForSession.mockResolvedValue(session(USER_B.id));

    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("invalid");

    expect(harness.recovery.clear).toHaveBeenCalled();
    expect(harness.log).toContain(`stop:${USER_A.id}`);
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(harness.log).not.toContain("wipe");
    expect(useSession.getState()).toMatchObject({ userId: USER_A.id, isOnlineSession: false });
  });

  it("falls back to a recovery the page already observed when the code was spent", async () => {
    openAccount(useSession);
    harness.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: "used" } });
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });

    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("invalid");
    harness.recovery.detected.mockReturnValue(true);
    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("ready");
    expect(harness.recovery.detected).toHaveBeenCalledWith(USER_A.id);

    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await useSession.getState().preparePasswordRecovery(native("code=c"))).toBe("invalid");

    harness.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_B } } });
    expect(await useSession.getState().preparePasswordRecovery(native("code=c")), "another account's observed recovery")
      .toBe("invalid");
  });

  it("adopts a token pair only when it opens a session", async () => {
    openAccount(useSession);
    const link = "helix://reset-password#access_token=a&refresh_token=r&type=recovery";
    harness.supabase.auth.setSession.mockResolvedValue({ data: { session: null }, error: { message: "bad" } });
    expect(await useSession.getState().preparePasswordRecovery(link)).toBe("invalid");
    harness.supabase.auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await useSession.getState().preparePasswordRecovery(link)).toBe("invalid");
    harness.supabase.auth.setSession.mockResolvedValue(session(USER_A.id));
    expect(await useSession.getState().preparePasswordRecovery(link)).toBe("ready");
    expect(harness.supabase.auth.setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "r" });
  });

  it("accepts a link with nothing in it only when the page already saw a recovery", async () => {
    openAccount(useSession);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });
    expect(await useSession.getState().preparePasswordRecovery(native(""))).toBe("invalid");
    harness.recovery.detected.mockReturnValue(true);
    expect(await useSession.getState().preparePasswordRecovery(native(""))).toBe("ready");
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await useSession.getState().preparePasswordRecovery(native(""))).toBe("invalid");
    openAccount(useSession);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_B } } });
    expect(await useSession.getState().preparePasswordRecovery(native(""))).toBe("invalid");
  });

  it("refuses an older link in a standalone tab without redeeming it", async () => {
    expect(await useSession.getState().preparePasswordRecovery(native("code=c"), { standalone: true })).toBe("invalid");
    expect(harness.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("saving a new password from a recovery session", () => {
  beforeEach(() => {
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_A } } });
    harness.recovery.detected.mockReturnValue(true);
  });

  it("refuses without a server, or with a weak password, before asking anything", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBe(tr.errors.supabaseNotConfigured);
    harness.configured.value = true;
    expect(await useSession.getState().completePasswordRecovery("short")).toBe(tr.auth.errWeakPassword);
    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a session that is not a recovery", async () => {
    harness.recovery.detected.mockReturnValue(false);
    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBe(tr.auth.resetInvalidBody);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBe(tr.auth.resetInvalidBody);
    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("saves, forgets the recovery and signs this device out", async () => {
    openAccount(useSession);

    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBeNull();

    expect(harness.supabase.auth.updateUser).toHaveBeenCalledWith({ password: STRONG });
    expect(harness.recovery.clear).toHaveBeenCalled();
    expect(harness.log).toContain("wipe");
    expect(useSession.getState().userId).toBeNull();
  });

  it("passes on a refusal to save, and a sign-out the device refuses", async () => {
    openAccount(useSession);
    harness.supabase.auth.updateUser.mockResolvedValueOnce({ error: { message: "New password should be different from the old password." } });
    const refused = await useSession.getState().completePasswordRecovery(STRONG);
    expect(refused).toBeTruthy();
    expect(harness.recovery.clear).not.toHaveBeenCalled();

    harness.pendingOutbox.mockResolvedValue(2);
    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBe(SIGN_OUT_PENDING_CHANGES);
  });

  it("refuses another account's recovery and takes this device offline", async () => {
    openAccount(useSession);
    harness.supabase.auth.getSession.mockResolvedValue({ data: { session: { user: USER_B } } });

    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBe(tr.auth.resetInvalidBody);

    expect(harness.supabase.auth.updateUser).not.toHaveBeenCalled();
    expect(useSession.getState()).toMatchObject({ userId: USER_A.id, isOnlineSession: false });
  });

  it("only drops the recovery session when no account is open here", async () => {
    expect(await useSession.getState().completePasswordRecovery(STRONG)).toBeNull();
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(harness.log).not.toContain("wipe");
  });
});

describe("signOut, step by step", () => {
  it("sends what it can first, and signs out once nothing is left unsent", async () => {
    openAccount(useSession);
    harness.pendingOutbox.mockResolvedValue(1);
    harness.flushOutbox.mockImplementation(async () => {
      harness.pendingOutbox.mockResolvedValue(0);
    });

    expect(await useSession.getState().signOut()).toBeNull();
    expect(harness.flushOutbox).toHaveBeenCalledWith(USER_A.id);
  });

  it("tears the session down in order and forgets the device's markers", async () => {
    openAccount(useSession);

    expect(await useSession.getState().signOut()).toBeNull();

    expect(harness.log).toEqual([
      `stop:${USER_A.id}`, ...LEAVE_ACCOUNT, "attachments:erase",
      `kv:remove:${OWNER_KEY}`, `kv:remove:${USER_KEY}`, `kv:remove:${EMAIL_KEY}`,
    ]);
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(useSession.getState()).toMatchObject(SIGNED_OUT);
  });

  it("restores the session's background work when the device could not be erased", async () => {
    openAccount(useSession);
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    expect(await useSession.getState().signOut()).toBe(tr.errors.workspaceResetFailed);

    expect(harness.startSyncSession).toHaveBeenCalledWith(USER_A.id);
    expect(harness.log).toEqual(expect.arrayContaining(["markets:on", `fx:load:${USER_A.id}`, `notifications:plan:${USER_A.id}`]));
    expect(harness.log, "a session that stays keeps its documents").not.toContain("attachments:erase");
    expect(useSession.getState().userId).toBe(USER_A.id);
  });

  it("restarts nothing for a device with no account open", async () => {
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));
    expect(await useSession.getState().signOut()).toBe(tr.errors.workspaceResetFailed);
    expect(harness.startSyncSession).not.toHaveBeenCalled();
  });

  it("signs a local-only workspace out without a server", async () => {
    harness.configured.value = false;
    openAccount(useSession);
    expect(await useSession.getState().signOut()).toBeNull();
    expect(harness.supabase.auth.signOut).not.toHaveBeenCalled();
  });
});

describe("after an explicit sign-out", () => {
  for (const leave of ["signOut", "deleteAccount"] as const) {
    it(`still hears the server end the next account's session (${leave})`, async () => {
      const session = await freshSession();
      await session.getState().bootstrap();
      openAccount(session);
      expect(await session.getState()[leave]()).toBeNull();

      openAccount(session);
      harness.authListeners[0]!("SIGNED_OUT");
      await vi.waitFor(() => expect(session.getState().userId).toBeNull());
    });
  }
});

describe("deleteAccount, step by step", () => {
  it("does nothing without an open account", async () => {
    expect(await useSession.getState().deleteAccount()).toBeNull();
    expect(harness.supabase.rpc).not.toHaveBeenCalled();
    expect(harness.log).toEqual([]);
  });

  it("erases a local-only workspace without a server", async () => {
    harness.configured.value = false;
    openAccount(useSession);
    expect(await useSession.getState().deleteAccount()).toBeNull();
    expect(harness.log).toContain("wipe");
  });

  it("deletes the identity, revokes every device and erases this one", async () => {
    openAccount(useSession);

    expect(await useSession.getState().deleteAccount()).toBeNull();

    expect(harness.supabase.rpc).toHaveBeenCalledWith("delete_own_account");
    expect(harness.supabase.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(harness.log).toEqual([
      `stop:${USER_A.id}`, "attachments:purge", ...LEAVE_ACCOUNT, "attachments:erase",
      `kv:remove:${OWNER_KEY}`, `kv:remove:${USER_KEY}`, `kv:remove:${EMAIL_KEY}`,
    ]);
    expect(useSession.getState()).toMatchObject(SIGNED_OUT);
  });

  it("ends the session in full even when the device could not be erased", async () => {
    openAccount(useSession);
    useSession.setState({ isNewSignup: true, isFreezing: true });
    harness.resetLocalWorkspace.mockRejectedValue(new Error("disk"));

    expect(await useSession.getState().deleteAccount()).toBe(tr.errors.workspaceResetFailed);

    expect(useSession.getState()).toMatchObject(SIGNED_OUT);
    expect(harness.store.get(OWNER_KEY)).toBe("__helix_wipe_pending__");
    expect(harness.log).toContain("attachments:erase");
  });
});

describe("verifyPassword, step by step", () => {
  it("says the project is not configured", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().verifyPassword("pw")).toBe(tr.errors.supabaseNotConfigured);
  });

  it("stops asking the server after five wrong passwords", async () => {
    const session = await freshSession();
    openAccount(session);
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: "Invalid login credentials" } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await session.getState().verifyPassword("wrong")).toBe(tr.account.wrongPassword);
    }
    expect(await session.getState().verifyPassword("wrong")).toBe(tr.auth.errRateLimit);
    expect(harness.supabase.auth.signInWithPassword).toHaveBeenCalledTimes(5);
    expect(harness.supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: USER_A.email, password: "wrong" });
  });

  it("maps a refusal that is not about the password on its own terms", async () => {
    const session = await freshSession();
    openAccount(session);
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: "Request rate limit reached" } });

    const refused = await session.getState().verifyPassword("pw");
    expect(refused).toBeTruthy();
    expect(refused).not.toBe(tr.account.wrongPassword);
  });

  it("finds the address from the session, then the device, before giving up", async () => {
    const session = await freshSession();
    openAccount(session);
    session.setState({ email: null });
    harness.supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: USER_A.id } }, error: null });

    harness.supabase.auth.getUser.mockResolvedValueOnce({ data: { user: { email: "session@example.com" } } });
    expect(await session.getState().verifyPassword("pw")).toBeNull();
    expect(harness.supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: "session@example.com", password: "pw" });
    expect(session.getState().email).toBe("session@example.com");

    session.setState({ email: null });
    harness.supabase.auth.getUser.mockRejectedValueOnce(new Error("offline"));
    expect(await session.getState().verifyPassword("pw")).toBeNull();
    expect(harness.supabase.auth.signInWithPassword).toHaveBeenLastCalledWith({ email: USER_A.email, password: "pw" });

    harness.supabase.auth.getUser.mockClear();
    session.setState({ email: USER_A.email });
    expect(await session.getState().verifyPassword("pw")).toBeNull();
    expect(harness.supabase.auth.getUser, "a known address is not looked up").not.toHaveBeenCalled();

    session.setState({ email: null });
    harness.store.delete(EMAIL_KEY);
    harness.supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await session.getState().verifyPassword("pw")).toBe(tr.auth.errSessionExpired);
  });
});

describe("changing the e-mail or password", () => {
  it("says the project is not configured", async () => {
    harness.configured.value = false;
    expect(await useSession.getState().changeEmail("new@example.com")).toBe(tr.errors.supabaseNotConfigured);
    expect(await useSession.getState().changePassword("old", STRONG)).toBe(tr.errors.supabaseNotConfigured);
  });

  it("asks for the trimmed address and reports a refusal in the user's terms", async () => {
    expect(await useSession.getState().changeEmail("  new@example.com ")).toBeNull();
    expect(harness.supabase.auth.updateUser).toHaveBeenCalledWith({ email: "new@example.com" });

    harness.supabase.auth.updateUser.mockResolvedValueOnce({ error: { message: "Email rate limit exceeded" } });
    const refused = await useSession.getState().changeEmail("new@example.com");
    expect(refused).toBeTruthy();
    expect(refused).not.toBe("Email rate limit exceeded");
  });

  it("reports a refused password change in the user's terms", async () => {
    harness.supabase.auth.updateUser.mockResolvedValueOnce({ error: { message: "Password is known to be weak" } });
    const refused = await useSession.getState().changePassword("old", STRONG);
    expect(refused).toBeTruthy();
    expect(refused).not.toBe("Password is known to be weak");
  });
});
