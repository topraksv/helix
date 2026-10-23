/** Focused root hooks for lock, first-pull grace and background work. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { useNavigationContainerRef } from "expo-router";
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
import { BIOMETRIC_KEY } from "./biometric-name";

/**
 * How long a resumed app settles before the authentication sheet is presented.
 *
 * The app-switcher cover is a real modal view controller and it is dismissed on
 * the same resume; presenting into that dismissal is how a prompt goes missing
 * while its promise stays pending. Short enough that the lock screen does not
 * read as stalled.
 */
const PROMPT_SETTLE_MS = 400;

/**
 * How long an unanswered prompt is given after a resume before it is written
 * off.
 *
 * Deliberately generous, because the two mistakes are not symmetric. Too long
 * only delays a retry the owner never asked for; too short interrupts a prompt
 * that WAS answered and asks a second time — the "it asked me twice" report
 * this hook has already been fixed for once. The device-passcode fallback
 * settles its promise as its screen dismisses, which is the same moment the
 * resume arrives, so the margin has to cover that overlap.
 */
const PROMPT_RECOVERY_MS = 2_500;

/**
 * Whether the OS has a window to present a system prompt into.
 *
 * `inactive` is also what iOS reports while its own sheet is up, so refusing
 * there doubles as a guard against stacking one prompt on another. Everything
 * else passes, deliberately including `unknown` — what Android reports before
 * its first lifecycle event, a cold start included, where refusing would leave
 * the lock screen showing a button that does nothing.
 */
function canPresentPrompt(): boolean {
  const state = AppState.currentState;
  return state !== "background" && state !== "inactive";
}

/** Prompt only from the foreground: a backgrounded iOS prompt may never settle, and an identity (not a flag) lets an abandoned prompt be replaced. */
export function useBiometricLock(ready: boolean, userId: string | null) {
  const [locked, setLocked] = useState<boolean | null>(null);
  /** Read by the once-registered AppState listener, so written with the state, not in an effect. */
  const lockedRef = useRef<boolean | null>(null);
  const prompt = useRef<number | null>(null);
  const promptSeq = useRef(0);
  /** Last preference read: the SecureStore read on leaving can reject under iOS file protection. */
  const preference = useRef<boolean | null>(null);

  const applyLocked = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);

  /**
   * Always resolves: a null `locked` is a blank app. On failure keep the last
   * value, else lock — safe ONLY because `unlock` keeps the passcode fallback.
   * Change one of these and re-read the other.
   */
  const resolveLock = useCallback(async () => {
    if (!userId) {
      applyLocked(false);
      return;
    }
    try {
      const enabled = (await kv.get(BIOMETRIC_KEY)) === "true";
      preference.current = enabled;
      applyLocked(enabled && Platform.OS !== "web");
    } catch (error) {
      devWarning("lock.read", String(error));
      applyLocked(lockedRef.current ?? Platform.OS !== "web");
    }
  }, [userId, applyLocked]);

  useEffect(() => {
    if (!ready) return;
    void resolveLock();
  }, [ready, resolveLock]);

  const unlock = useCallback(async () => {
    if (prompt.current !== null) return;
    // A prompt asked of a backgrounded app is the wedge itself: iOS has no
    // window to present it into and the promise may never settle. The resume
    // handler below asks instead, once there is a screen to ask on.
    if (!canPresentPrompt()) return;
    const id = (promptSeq.current += 1);
    prompt.current = id;
    try {
      // Face first, passcode as fallback. Never biometrics-only: a lock on one's own data needs a second key.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: tr.lock.prompt,
      });
      // An abandoned prompt does not get to speak. A late answer from one is a
      // race against the prompt now on screen, and "success" from it would open
      // the app underneath a sheet the owner is still looking at.
      if (prompt.current !== id) return;
      if (result.success) applyLocked(false);
    } catch (error) {
      devWarning("lock.auth", String(error));
    } finally {
      if (prompt.current === id) prompt.current = null;
    }
  }, [applyLocked]);

  useEffect(() => {
    if (Platform.OS === "web" || !userId) return;
    let resume: ReturnType<typeof setTimeout> | null = null;
    const cancelResume = () => {
      if (resume !== null) clearTimeout(resume);
      resume = null;
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        // A resume is also the moment the earlier read is most likely to have
        // failed, so this doubles as the retry that the deps cannot provide.
        if (lockedRef.current === null) {
          void resolveLock();
          return;
        }
        if (lockedRef.current === false) return;
        cancelResume();
        // A prompt still unanswered here was never presented, and needs the
        // longer margin so an answer already on its way is not cut off.
        const delay = prompt.current === null ? PROMPT_SETTLE_MS : PROMPT_RECOVERY_MS;
        resume = setTimeout(() => {
          resume = null;
          // Re-read at the last moment: the answer may have arrived, or the app
          // may have left again, in the time this waited.
          if (!canPresentPrompt() || lockedRef.current !== true) return;
          // Anything still unanswered in a foregrounded app was never presented
          // — the system holds the app inactive while its sheet is up. Drop it,
          // so the guard cannot outlive the prompt it was guarding.
          prompt.current = null;
          void unlock();
        }, delay);
        return;
      }
      if (state !== "background") return;
      cancelResume();
      const prompting = prompt.current !== null;
      void kv.get(BIOMETRIC_KEY)
        .then((value) => {
          preference.current = value === "true";
        })
        .catch((error) => devWarning("lock.read", String(error)))
        .finally(() => {
          // `prompting` is the exception that has to stay: the authentication
          // sheet backgrounds the app itself (iOS passcode fallback, Android
          // device credentials), so locking on that event answered a successful
          // unlock by immediately asking again.
          if (preference.current === true && !prompting) applyLocked(true);
        });
    });
    return () => {
      cancelResume();
      subscription.remove();
    };
  }, [userId, resolveLock, unlock, applyLocked]);

  useEffect(() => {
    if (locked === true) void unlock();
  }, [locked, unlock]);

  return { locked, unlock };
}

/**
 * Restore the stack after unlock: the lock screen replaces the navigator
 * (native sheets would sit above a drawn cover), and a remount forgets the
 * stack. Call BEFORE `useNotificationTapRouting` so a tapped reminder lands on
 * top of the restored stack.
 */
export function useNavigationAcrossLock(locked: boolean | null, navigatorShown: boolean, userId: string | null): void {
  const navigation = useNavigationContainerRef();
  type RootState = NonNullable<ReturnType<typeof navigation.getRootState>>;
  const last = useRef<RootState | null>(null);
  const parked = useRef<RootState | null>(null);

  useEffect(
    () =>
      navigation.addListener("state", (event) => {
        // From SDK 58 the unmount reports a reseeded state, not none; parking
        // happens in the commit that unmounts, before that state arrives.
        if (event.data.state) last.current = event.data.state as RootState;
      }),
    [navigation],
  );

  useEffect(() => {
    last.current = null;
    parked.current = null;
  }, [userId]);

  useEffect(() => {
    if (locked === true && last.current) parked.current = last.current;
  }, [locked]);

  useEffect(() => {
    if (locked !== false || !navigatorShown || !parked.current || !navigation.isReady()) return;
    const root = navigation.getRootState();
    const state = parked.current;
    parked.current = null;
    // SDK 58's container ref has no `resetRoot`; a reset keyed to the root navigator replaces its whole tree.
    if (root) navigation.reset({ ...state, key: root.key });
  }, [locked, navigatorShown, navigation]);
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
    const update = (state: string | null | undefined) => state === "active" ? start() : stop();
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
    const update = (state: string | null | undefined) => {
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

/**
 * A second web tab cannot open the OPFS database and only a reload recovers
 * it, so the waiting tab polls who holds it and reloads when nobody answers.
 * Not `pagehide` (it fires on same-tab navigation and steals the handle) and
 * not focus/visibility (unreliable). The reload ceiling makes the poll safe
 * against a frozen holder.
 */
const DATABASE_HOLDER_CHANNEL = "helix.database.holder";
/** Long enough for a live holder in another tab to answer, short enough that a
 *  person who closed it does not sit looking at a screen that is already stale. */
const HOLDER_REPLY_GRACE_MS = 500;
/** Slow enough to be invisible next to a person reaching for the other tab. */
const HOLDER_PROBE_MS = 2000;
const MAX_AUTO_RELOADS = 2;
const AUTO_RELOAD_KEY = "helix.database.autoreload";

function autoReloadsSpent(): number {
  try {
    return Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0) || 0;
  } catch {
    // A browser refusing session storage gets the button, not a loop.
    return MAX_AUTO_RELOADS;
  }
}

function spendAutoReload(): void {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(autoReloadsSpent() + 1));
  } catch {
    // Nothing to do: the read above already refuses when this would fail.
  }
}

export function useDatabaseHandoff(dbReady: boolean, blocked: boolean): { heldElsewhere: boolean } {
  // While another tab answers, reloading cannot help, so the screen stops offering it.
  const [heldElsewhere, setHeldElsewhere] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof BroadcastChannel === "undefined") return;
    if (!dbReady && !blocked) return;
    const channel = new BroadcastChannel(DATABASE_HOLDER_CHANNEL);

    if (dbReady) {
      // Opened, so the ceiling is for the next wait, not spent by this one.
      try {
        sessionStorage.removeItem(AUTO_RELOAD_KEY);
      } catch {
        // Nothing was spent where nothing could be stored.
      }
      channel.onmessage = (event) => {
        if (event.data === "who-has-it") channel.postMessage("i-do");
      };
      return () => channel.close();
    }

    let grace: ReturnType<typeof setTimeout> | null = null;
    const stopWaiting = () => {
      if (grace) clearTimeout(grace);
      grace = null;
    };
    // Somebody still holds it, so this tab has nothing to reload into.
    channel.onmessage = (event) => {
      if (event.data !== "i-do") return;
      stopWaiting();
      setHeldElsewhere(true);
    };
    const askWhoHasIt = (mayReload: boolean) => {
      if (grace) return;
      channel.postMessage("who-has-it");
      // The ceiling stops the RELOAD, never the question. Asking is what tells
      // the screen another tab has the database, and that is most worth saying
      // precisely when reloading has already been tried and given up on.
      if (!mayReload || autoReloadsSpent() >= MAX_AUTO_RELOADS) return;
      grace = setTimeout(() => {
        grace = null;
        // Nobody answered, so the holder is gone and a reload will now work.
        spendAutoReload();
        window.location.reload();
      }, HOLDER_REPLY_GRACE_MS);
    };
    // The first ask only updates the screen; arming a reload here would cost a page load to a slow, throttled holder.
    askWhoHasIt(false);
    const probe = setInterval(() => askWhoHasIt(true), HOLDER_PROBE_MS);
    return () => {
      stopWaiting();
      clearInterval(probe);
      channel.close();
    };
  }, [dbReady, blocked]);

  return { heldElsewhere };
}
