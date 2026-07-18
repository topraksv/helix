/** Device-local privacy/permission choices. Never sync consent to another device. */

import { create } from "zustand";
import { kv } from "./kv";

const NOTIFICATIONS_KEY = "helix.notifications";
const NOTIFICATION_DETAILS_KEY = "helix.notification-details";

interface DevicePreferences {
  loaded: boolean;
  notifications: boolean;
  notificationDetails: boolean;
}

export const useDevicePreferences = create<DevicePreferences>(() => ({
  loaded: false,
  notifications: false,
  notificationDetails: false,
}));

let loadPromise: Promise<DevicePreferences> | null = null;
let preferenceVersion = 0;

function commitPreferences(patch: Partial<Omit<DevicePreferences, "loaded">>): DevicePreferences {
  preferenceVersion += 1;
  const next = { ...useDevicePreferences.getState(), ...patch, loaded: true };
  useDevicePreferences.setState(next);
  // A preference changed after the initial read: future service calls must not
  // receive the now-stale resolved load promise.
  loadPromise = Promise.resolve(next);
  return next;
}

/** Load once per app process; notification consent intentionally defaults off. */
export function loadDevicePreferences(): Promise<DevicePreferences> {
  if (!loadPromise) {
    const loadVersion = preferenceVersion;
    loadPromise = Promise.all([kv.get(NOTIFICATIONS_KEY), kv.get(NOTIFICATION_DETAILS_KEY)])
      .then(([notifications, notificationDetails]) => ({
        loaded: true,
        notifications: notifications === "true",
        notificationDetails: notificationDetails === "true",
      }))
      .catch(() => ({ loaded: true, notifications: false, notificationDetails: false }))
      .then((next) => {
        // A user action may complete while the first storage read is still in
        // flight. That newer choice wins over the stale snapshot.
        if (loadVersion !== preferenceVersion) return useDevicePreferences.getState();
        useDevicePreferences.setState(next);
        return next;
      });
  }
  return loadPromise;
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await kv.set(NOTIFICATIONS_KEY, String(enabled));
  commitPreferences({ notifications: enabled });
}

export async function notificationsEnabled(): Promise<boolean> {
  const current = useDevicePreferences.getState();
  return current.loaded ? current.notifications : (await loadDevicePreferences()).notifications;
}

export async function setNotificationDetailsEnabled(enabled: boolean): Promise<void> {
  await kv.set(NOTIFICATION_DETAILS_KEY, String(enabled));
  commitPreferences({ notificationDetails: enabled });
}
