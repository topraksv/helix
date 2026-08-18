/** Focused root hooks for lock, first-pull grace and background work. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as LocalAuthentication from "expo-local-authentication";
import { kv } from "../services/kv";
import { liveAttachmentNames, runMaintenance } from "../data/repo";
import { loadRateCache, refreshRates } from "../services/fx-fetch";
import { connectMarkets, disconnectMarkets, suspendMarkets } from "../services/markets";
import { rescheduleAll } from "../services/notifications";
import { pruneOrphanAttachmentFiles } from "../services/attachment-store";
import { notificationTapRoute } from "../domain/notifications";
import { devWarning } from "../services/logger";
import { runSyncSessionTask, syncNow } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { tr } from "../i18n/tr";

export function useBiometricLock(ready: boolean, userId: string | null) {
  const [locked, setLocked] = useState<boolean | null>(null);
  /** One prompt at a time: iOS queues a second and asks the owner twice. */
  const authenticating = useRef(false);

  /**
   * Resolve the lock preference, and NEVER leave it unresolved.
   *
   * The root renders a bare background while `locked` is null, so a read that
   * neither resolves nor rejects visibly is the whole app going blank. This
   * read can genuinely fail: iOS seals app storage under
   * `NSFileProtectionComplete`, so a SecureStore get issued around a resume can
   * reject. It used to run in an async IIFE with no `catch`, and because the
   * effect's deps do not change afterwards nothing ever retried — the app
   * stayed blank on every screen until it was force-quit.
   *
   * On failure it keeps a value it already had, and locks if it had none.
   * **That default is only safe because `unlock` keeps the device passcode as a
   * fallback.** Locking on an unreadable preference plus a biometrics-only
   * prompt is how the owner got shut out of their own app: Face ID was the only
   * key, and nothing was left to try when it did not open. Do not tighten one
   * of these without re-reading the other.
   */
  const resolveLock = useCallback(async () => {
    if (!userId) {
      setLocked(false);
      return;
    }
    try {
      const enabled = (await kv.get("helix.biometric")) === "true";
      setLocked(enabled && Platform.OS !== "web");
    } catch (error) {
      devWarning("lock.read", String(error));
      setLocked((current) => current ?? Platform.OS !== "web");
    }
  }, [userId]);

  useEffect(() => {
    if (!ready) return;
    void resolveLock();
  }, [ready, resolveLock]);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    try {
      // Plain iOS behaviour: the face first, the device passcode when the face
      // does not open it, and it keeps asking until one of them does.
      //
      // This was briefly biometrics-only, to stop a passcode appearing under a
      // button that says "Face ID ile Aç". That reasoning was right about the
      // label and catastrophic about the lock — it removed the only way back in
      // when the face fails, and the owner was shut out of the app. A lock on
      // one's own data must always have a second key.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: tr.lock.prompt,
      });
      if (result.success) setLocked(false);
    } catch (error) {
      devWarning("lock.auth", String(error));
    } finally {
      authenticating.current = false;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || !userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // A resume is also the moment the earlier read is most likely to have
        // failed, so this doubles as the retry that the deps cannot provide.
        if (locked === null) void resolveLock();
        return;
      }
      if (state !== "background") return;
      // The auth prompt itself backgrounds the app, so re-locking here answered
      // a successful unlock by immediately asking again — the second prompt the
      // owner kept seeing after entering the right passcode.
      if (authenticating.current) return;
      void kv.get("helix.biometric")
        .then((value) => {
          if (value === "true") setLocked(true);
        })
        .catch((error) => devWarning("lock.read", String(error)));
    });
    return () => subscription.remove();
  }, [userId, locked, resolveLock]);

  useEffect(() => {
    if (locked === true) void unlock();
  }, [locked, unlock]);

  return { locked, unlock };
}

export function useFirstPullGrace(input: {
  userId: string | null;
  online: boolean;
  newSignup: boolean;
  onboarded: boolean | null;
  /** Completion time of the live `onboarded` query feeding the route guard. */
  onboardedUpdatedAt: Date | undefined;
  /** Forces that query to re-run immediately (bypasses its debounce). */
  refreshOnboarded: () => void;
}): boolean {
  const [grace, setGrace] = useState(false);
  const lastSyncAt = useSyncStatus((state) => state.lastSyncAt);

  useEffect(() => {
    if (input.userId && input.online && !input.newSignup) {
      setGrace(true);
      const timer = setTimeout(() => setGrace(false), 8_000);
      return () => clearTimeout(timer);
    }
    setGrace(false);
    return undefined;
  }, [input.userId, input.online, input.newSignup]);

  // The first pull can finish before the live `onboarded` query re-reads what
  // it wrote. Dropping the grace on `lastSyncAt` alone let the guard route on
  // that pre-sync `false` snapshot — the logout→login "Quick Start flash". So
  // the grace lifts only after the query has completed AT/AFTER the sync; a
  // forced refresh keeps that deterministic instead of waiting for the 8 s cap.
  const syncedAtMs = lastSyncAt ? Date.parse(lastSyncAt) : null;
  const queryAtMs = input.onboardedUpdatedAt?.getTime() ?? null;
  const querySettled = syncedAtMs != null && queryAtMs != null && queryAtMs >= syncedAtMs;
  const { refreshOnboarded } = input;
  useEffect(() => {
    if (grace && syncedAtMs != null && !querySettled) refreshOnboarded();
  }, [grace, syncedAtMs, querySettled, refreshOnboarded]);
  useEffect(() => {
    if (querySettled) setGrace(false);
  }, [querySettled]);

  return grace && input.onboarded === false;
}

export function useWorkspaceMaintenance(ready: boolean, userId: string | null, unlocked: boolean): void {
  const lastKickAt = useRef(0);
  const lastKickUser = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !userId || !unlocked) return;
    const kick = () => {
      if (lastKickUser.current === userId && Date.now() - lastKickAt.current < 60_000) return;
      lastKickUser.current = userId;
      lastKickAt.current = Date.now();
      void runSyncSessionTask(userId, async (signal) => {
        await runMaintenance(userId);
        if (signal.aborted) return;
        await rescheduleAll(userId);
        if (signal.aborted) return;
        // Attachment files can outlive their rows: an add interrupted after the
        // copy, a delete the owner did not undo, a restore that brought rows
        // from a device whose files never travelled. Nothing else removes
        // those, so they would occupy the device for ever. It runs here rather
        // than in `runMaintenance` because the filesystem is a native service
        // and the data layer stays loadable without one.
        await pruneOrphanAttachmentFiles(await liveAttachmentNames(userId));
      })
        .catch((error) => devWarning("maintenance", String(error)))
        .finally(() => void syncNow(userId));
      void runSyncSessionTask(userId, async (signal) => {
        await loadRateCache(userId);
        if (!signal.aborted) await refreshRates(userId, signal);
      }).catch((error) => devWarning("fx-refresh", String(error)));
    };
    kick();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => subscription.remove();
  }, [ready, userId, unlocked]);
}

/** Pull changes made on another active device without requiring a button tap. */
export function useForegroundSync(ready: boolean, userId: string | null, unlocked: boolean): void {
  useEffect(() => {
    if (!ready || !userId || !unlocked) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      void syncNow(userId);
      timer = setInterval(() => void syncNow(userId), 30_000);
    };
    const update = (state: string) => state === "active" ? start() : stop();
    update(AppState.currentState);
    const subscription = AppState.addEventListener("change", update);
    return () => {
      stop();
      subscription.remove();
    };
  }, [ready, userId, unlocked]);
}

export function useMarketLifecycle(ready: boolean, userId: string | null, unlocked: boolean): void {
  useEffect(() => {
    if (!ready || !userId || !unlocked) {
      disconnectMarkets();
      return;
    }
    const update = (state: string) => {
      if (state === "active") connectMarkets();
      else suspendMarkets();
    };
    update(AppState.currentState);
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      suspendMarkets();
    };
  }, [ready, userId, unlocked]);
}

/**
 * Open what a tapped reminder was about.
 *
 * A local notification used to carry only words: tapping one resumed the app
 * wherever it had been left, so the payment it named still had to be hunted
 * for. Each scheduled notification now carries an identity payload and this
 * routes it (`domain/notifications.ts` decides where; the pathname never comes
 * from the payload itself).
 *
 * Both entry points are covered because they are genuinely different events:
 * `getLastNotificationResponse` is the tap that LAUNCHED a cold app and has
 * already happened before any listener could exist, while the subscription
 * catches taps that arrive while the app is running. Expo's docs pair them for
 * exactly this reason.
 *
 * Gated on an unlocked, signed-in session, so a tap can never route around the
 * biometric lock. A cold-start tap that arrives locked is still honoured once
 * `unlocked` turns true — the OS keeps the last response, and this effect
 * re-runs.
 *
 * A handled launch response is then CLEARED. The payload deliberately carries
 * no user id (it would be an account identifier sitting in OS storage), so a
 * response the OS keeps replaying is one this hook cannot attribute; clearing
 * it is what stops a reminder raised under one account from being re-read
 * after a switch to another. The target screens are user-scoped and redirect
 * to their list when an id names no live row, so the worst remaining case is a
 * list screen rather than another account's record.
 */
export function useNotificationTapRouting(
  ready: boolean,
  userId: string | null,
  unlocked: boolean,
  navigate: (route: { pathname: string; params?: Record<string, string> }) => void,
): void {
  // The route is read from a ref so a new navigator identity on every render
  // cannot re-subscribe (and re-deliver) the listener.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  /** One route per response, however many times the effect re-runs. */
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || !ready || !userId || !unlocked) return;
    const open = (response: Notifications.NotificationResponse | null, key: string) => {
      if (!response || handled.current === key) return;
      // A tap on a custom action button is not a request to open the record.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const route = notificationTapRoute(response.notification.request.content.data);
      if (!route) return;
      handled.current = key;
      // Consume it: an unconsumed launch response is replayed on every later
      // read, including after an account switch.
      try {
        Notifications.clearLastNotificationResponse();
      } catch (error) {
        devWarning("notification.clear", String(error));
      }
      navigateRef.current(route);
    };

    try {
      const launch = Notifications.getLastNotificationResponse();
      if (launch) open(launch, launch.notification.request.identifier);
    } catch (error) {
      devWarning("notification.launch", String(error));
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response, response.notification.request.identifier);
    });
    return () => subscription.remove();
  }, [ready, userId, unlocked]);
}
