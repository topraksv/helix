/**
 * What the device-local store promises, on both platforms.
 *
 * `src/services/kv.ts` is best-effort on web BY CONTRACT — `src/auth/session.ts`
 * relies on that when it writes a preference after an account is already
 * authenticated, and relies on the contract's other half (a resolved write is
 * not proof of a stored value) when it reads the workspace owner back. Both
 * halves are asserted here, along with the platform split that decides which
 * store is even in play.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = {
  getItemAsync: vi.fn(async (_key: string): Promise<string | null> => null),
  setItemAsync: vi.fn(async (_key: string, _value: string): Promise<void> => {}),
  deleteItemAsync: vi.fn(async (_key: string): Promise<void> => {}),
};

/** Re-import the module under a chosen platform; `Platform.OS` is read at call
 * time, but the mock has to be installed before the import either way. */
async function loadKv(os: "web" | "ios") {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: { OS: os } }));
  vi.doMock("expo-secure-store", () => secure);
  return (await import("../src/services/kv")).kv;
}

/**
 * A browser told to block site data does not hand back a null `localStorage` —
 * reading the property itself throws `SecurityError`. `?.` guards a nullish
 * value and not a throwing getter, so every method has to survive the access,
 * not just the call.
 */
function installLocalStorage(mode: "working" | "blocked" | "absent"): Map<string, string> {
  const backing = new Map<string, string>();
  if (mode === "absent") {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
    return backing;
  }
  if (mode === "blocked") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    return backing;
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    },
  });
  return backing;
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
  secure.getItemAsync.mockClear();
  secure.setItemAsync.mockClear();
  secure.deleteItemAsync.mockClear();
  secure.getItemAsync.mockResolvedValue(null);
});

describe("kv on web", () => {
  it("round-trips a value through the browser store", async () => {
    const backing = installLocalStorage("working");
    const kv = await loadKv("web");

    await kv.set("helix.theme", "dark");
    expect(backing.get("helix.theme")).toBe("dark");
    expect(await kv.get("helix.theme")).toBe("dark");

    await kv.remove("helix.theme");
    expect(backing.has("helix.theme")).toBe(false);
    expect(await kv.get("helix.theme")).toBeNull();
    // The browser store is the ONLY one consulted here; a device keychain the
    // web build cannot reach must never be reached for.
    expect(secure.getItemAsync).not.toHaveBeenCalled();
    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });

  it("reads a missing key as absent rather than undefined", async () => {
    installLocalStorage("working");
    const kv = await loadKv("web");
    expect(await kv.get("helix.never.written")).toBeNull();
  });

  it("treats a store the runtime does not provide as empty", async () => {
    installLocalStorage("absent");
    const kv = await loadKv("web");

    expect(await kv.get("helix.theme")).toBeNull();
    await expect(kv.set("helix.theme", "dark")).resolves.toBeUndefined();
    await expect(kv.remove("helix.theme")).resolves.toBeUndefined();
  });

  it("reads as absent rather than throwing when site data is blocked", async () => {
    installLocalStorage("blocked");
    const kv = await loadKv("web");

    await expect(kv.get("helix.theme")).resolves.toBeNull();
    // Absent because the web branch ANSWERED, not because it fell through: a
    // web build reaching expo-secure-store would be asking a module the
    // platform does not provide, and a keychain that happens to answer null
    // makes that indistinguishable from a real read.
    expect(secure.getItemAsync).not.toHaveBeenCalled();
  });

  /**
   * The write matters more than the read. `signIn` awaits `kv.set` AFTER
   * Supabase has already authenticated the account, and the sign-in screen
   * turns any rejection into the generic "istek basarisiz". A throwing write
   * therefore refused a user who had in fact signed in, named the wrong cause,
   * and failed identically on every retry.
   */
  it("drops a write instead of failing the operation that made it", async () => {
    installLocalStorage("blocked");
    const kv = await loadKv("web");
    await expect(kv.set("helix.last_user_id", "user-1")).resolves.toBeUndefined();
  });

  it("drops a removal instead of failing the sign-out that made it", async () => {
    installLocalStorage("blocked");
    const kv = await loadKv("web");
    await expect(kv.remove("helix.last_user_id")).resolves.toBeUndefined();
  });

  /**
   * The other half of the contract, and the reason `ensureWorkspaceFor` reads
   * the owner marker back: a dropped write resolves exactly like a stored one.
   */
  it("resolves a dropped write indistinguishably from a stored one", async () => {
    installLocalStorage("blocked");
    const kv = await loadKv("web");

    await expect(kv.set("helix.local_owner", "user-1")).resolves.toBeUndefined();
    expect(await kv.get("helix.local_owner")).toBeNull();
  });
});

describe("kv on a device", () => {
  it("uses the keychain rather than the browser store", async () => {
    const backing = installLocalStorage("working");
    const kv = await loadKv("ios");

    await kv.set("helix.theme", "dark");
    expect(secure.setItemAsync).toHaveBeenCalledWith("helix.theme", "dark");
    expect(backing.has("helix.theme")).toBe(false);

    secure.getItemAsync.mockResolvedValue("dark");
    expect(await kv.get("helix.theme")).toBe("dark");
    expect(secure.getItemAsync).toHaveBeenCalledWith("helix.theme");

    await kv.remove("helix.theme");
    expect(secure.deleteItemAsync).toHaveBeenCalledWith("helix.theme");
  });

  /**
   * Native keeps the rejection. The keychain is where session-adjacent state
   * lives, and a caller that must not fail on it says so at the call site —
   * `session.ts` does exactly that — rather than the store deciding for
   * everyone that a failed write is fine.
   */
  it("surfaces a keychain failure to the caller", async () => {
    const kv = await loadKv("ios");
    secure.setItemAsync.mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(kv.set("helix.theme", "dark")).rejects.toThrow("keychain unavailable");

    secure.getItemAsync.mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(kv.get("helix.theme")).rejects.toThrow("keychain unavailable");
  });
});
