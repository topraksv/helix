import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  get: vi.fn<(key: string) => Promise<string | null>>(),
}));
vi.mock("../../src/services/kv", () => ({
  kv: {
    get: mocks.get,
    set: vi.fn(async (key: string, value: string) => void mocks.storage.set(key, value)),
    remove: vi.fn(async (key: string) => void mocks.storage.delete(key)),
  },
}));

import {
  loadDevicePreferences,
  notificationsEnabled,
  setNotificationDetailsEnabled,
  setNotificationsEnabled,
} from "../../src/services/device-preferences";

describe("device-local notification preferences", () => {
  it("keeps a newer consent when the first storage read resolves late", async () => {
    const pendingReads: Array<(value: string | null) => void> = [];
    mocks.get.mockImplementation(() => new Promise((resolve) => pendingReads.push(resolve)));
    const initialLoad = loadDevicePreferences();

    await setNotificationsEnabled(true);
    await setNotificationDetailsEnabled(true);
    for (const resolve of pendingReads) resolve(null);

    expect(await initialLoad).toMatchObject({ notifications: true, notificationDetails: true });
    expect(await notificationsEnabled()).toBe(true);
    expect(await loadDevicePreferences()).toMatchObject({ notifications: true, notificationDetails: true });
  });

  it("does not settle the other choice at its default when one is changed before the first read", async () => {
    vi.resetModules();
    mocks.storage.clear();
    mocks.storage.set("helix.notifications", "true");
    mocks.get.mockImplementation(async (key) => mocks.storage.get(key) ?? null);
    const preferences = await import("../../src/services/device-preferences");

    await preferences.setNotificationDetailsEnabled(false);

    expect(await preferences.notificationsEnabled()).toBe(true);
    expect(await preferences.loadDevicePreferences()).toMatchObject({ notifications: true, notificationDetails: false });
  });
});
