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
/**
 * Choices made in this process. A storage read that was already on its way when
 * one was made is older than it, so the read fills in only what nobody chose.
 */
const chosen: Partial<Omit<DevicePreferences, "loaded">> = {};

function commitPreferences(patch: Partial<Omit<DevicePreferences, "loaded">>): void {
  Object.assign(chosen, patch);
  const current = useDevicePreferences.getState();
  const next = { ...current, ...patch };
  useDevicePreferences.setState(next);
  // Before the first read the choice NOT made here is still unknown, so the
  // store is not marked loaded: doing that stamped it with its default, and
  // turning notification details off switched notifications off with them.
  if (current.loaded) loadPromise = Promise.resolve(next);
}

/** Load once per app process; notification consent intentionally defaults off. */
export function loadDevicePreferences(): Promise<DevicePreferences> {
  if (!loadPromise) {
    loadPromise = Promise.all([kv.get(NOTIFICATIONS_KEY), kv.get(NOTIFICATION_DETAILS_KEY)])
      .then(([notifications, notificationDetails]) => ({
        loaded: true,
        notifications: notifications === "true",
        notificationDetails: notificationDetails === "true",
      }))
      .catch(() => ({ loaded: true, notifications: false, notificationDetails: false }))
      .then((stored) => {
        const next = { ...stored, ...chosen };
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
