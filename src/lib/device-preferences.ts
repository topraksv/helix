/** Device-local privacy/permission choices. Never sync consent to another device. */

import { create } from "zustand";
import { kv } from "./kv";

const NOTIFICATIONS_KEY = "helix.notifications";

interface DevicePreferences {
  loaded: boolean;
  notifications: boolean;
}

export const useDevicePreferences = create<DevicePreferences>(() => ({
  loaded: false,
  notifications: false,
}));

let loadPromise: Promise<DevicePreferences> | null = null;

/** Load once per app process; notification consent intentionally defaults off. */
export function loadDevicePreferences(): Promise<DevicePreferences> {
  if (!loadPromise) {
    loadPromise = kv.get(NOTIFICATIONS_KEY)
      .then((notifications) => ({
        loaded: true,
        notifications: notifications === "true",
      }))
      .catch(() => ({ loaded: true, notifications: false }))
      .then((next) => {
        useDevicePreferences.setState(next);
        return next;
      });
  }
  return loadPromise;
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await kv.set(NOTIFICATIONS_KEY, String(enabled));
  useDevicePreferences.setState({ notifications: enabled, loaded: true });
}

export async function notificationsEnabled(): Promise<boolean> {
  return (await loadDevicePreferences()).notifications;
}
