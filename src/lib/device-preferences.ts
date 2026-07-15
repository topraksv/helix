/** Device-local privacy/permission choices. Never sync consent to another device. */

import { create } from "zustand";
import { kv } from "./kv";

const REMOTE_LOGOS_KEY = "helix.remote_logos";
const NOTIFICATIONS_KEY = "helix.notifications";

interface DevicePreferences {
  loaded: boolean;
  remoteLogos: boolean;
  notifications: boolean;
}

export const useDevicePreferences = create<DevicePreferences>(() => ({
  loaded: false,
  remoteLogos: false,
  notifications: false,
}));

let loadPromise: Promise<DevicePreferences> | null = null;

/** Load once per app process; both preferences intentionally default off. */
export function loadDevicePreferences(): Promise<DevicePreferences> {
  if (!loadPromise) {
    loadPromise = Promise.all([kv.get(REMOTE_LOGOS_KEY), kv.get(NOTIFICATIONS_KEY)])
      .then(([logos, notifications]) => ({
        loaded: true,
        remoteLogos: logos === "true",
        notifications: notifications === "true",
      }))
      .catch(() => ({ loaded: true, remoteLogos: false, notifications: false }))
      .then((next) => {
        useDevicePreferences.setState(next);
        return next;
      });
  }
  return loadPromise;
}

export async function setRemoteLogosEnabled(enabled: boolean): Promise<void> {
  await kv.set(REMOTE_LOGOS_KEY, String(enabled));
  useDevicePreferences.setState({ remoteLogos: enabled, loaded: true });
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await kv.set(NOTIFICATIONS_KEY, String(enabled));
  useDevicePreferences.setState({ notifications: enabled, loaded: true });
}

export async function notificationsEnabled(): Promise<boolean> {
  return (await loadDevicePreferences()).notifications;
}
