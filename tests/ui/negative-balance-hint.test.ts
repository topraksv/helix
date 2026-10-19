// A restored backup is someone's existing record (SPEC 2.17): its restore settles the
// hint for the device, and a restore that wrote its rows is never reported as failed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ values: new Map<string, string>(), setFails: false }));

vi.mock("expo-router", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("../../src/data/hooks", () => ({}));
vi.mock("../../src/data/live-state", () => ({}));
vi.mock("../../src/ui/dialog", () => ({ appConfirm: async () => false }));
vi.mock("../../src/services/kv", () => ({
  kv: {
    get: async (key: string) => store.values.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (store.setFails) throw new Error("keychain refused");
      store.values.set(key, value);
    },
  },
}));

const { restoreWithoutNegativeBalanceHint } = await import("../../src/ui/negative-balance-hint");
const FLAG = "helix.negative-balance-hint.done";

beforeEach(() => {
  store.values.clear();
  store.setFails = false;
});

describe("a restore", () => {
  it("settles the hint once its rows are written", async () => {
    await expect(restoreWithoutNegativeBalanceHint(async () => "restored")).resolves.toBe("restored");
    expect(store.values.get(FLAG)).toBe("true");
  });

  it("settles nothing when it fails, and fails as itself", async () => {
    await expect(restoreWithoutNegativeBalanceHint(async () => {
      throw new Error("invalid backup");
    })).rejects.toThrow("invalid backup");
    expect(store.values.has(FLAG)).toBe(false);
  });

  it("still succeeds when the device refuses the flag", async () => {
    store.setFails = true;
    await expect(restoreWithoutNegativeBalanceHint(async () => 3)).resolves.toBe(3);
  });
});
