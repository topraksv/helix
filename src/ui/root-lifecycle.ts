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

/**
 * The lock, and the two ways the app used to get stuck behind it.
 *
 * Backgrounding the app flips the lock on, and the effect watching that flag
 * called the system prompt IMMEDIATELY — from a process with no foreground
 * window. iOS cannot present its sheet there and the promise it hands back may
 * never settle, so the "one prompt at a time" guard stayed armed for the life
 * of the process: the lock screen's own button returned at its first line, on
 * every tap, until the app was force-quit. And nothing ever asked again by
 * itself, because `locked` does not change across the background transition, so
 * no effect depending on it re-runs.
 *
 * So: a prompt is only ever asked of a foregrounded app, the resume is what
 * asks, and the guard is an identity rather than a flag — one that can be
 * abandoned without a promise settling.
 */
export function useBiometricLock(ready: boolean, userId: string | null) {
  const [locked, setLocked] = useState<boolean | null>(null);
  /**
   * The lock state the lifecycle listener reads.
   *
   * The listener is registered once per session, so one that closed over
   * `locked` would answer a resume with whatever the value was when the app
   * left — and leaving is exactly when it changes. Written with the state,
   * never behind it in an effect.
   */
  const lockedRef = useRef<boolean | null>(null);
  /**
   * Which prompt is awaiting an answer, or null when none is.
   *
   * An identity rather than a flag, so a prompt this hook has given up on
   * cannot answer for the one that replaced it — and, more to the point, so
   * giving up is possible at all. The flag this replaced could only be cleared
   * by a promise settling, which is precisely what a prompt the system never
   * presented does not do.
   */
  const prompt = useRef<number | null>(null);
  const promptSeq = useRef(0);
  /**
   * The last preference this session actually managed to read.
   *
   * iOS seals app storage under `NSFileProtectionComplete`, so the SecureStore
   * read issued as the app leaves — the worst possible moment for it — can
   * reject. Without this the failure left the app OPEN behind an owner who had
   * asked for it to be locked.
   */
  const preference = useRef<boolean | null>(null);

  const applyLocked = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);

  /**
   * Resolve the lock preference, and NEVER leave it unresolved.
   *
   * The root renders a bare background while `locked` is null, so a read that
   * neither resolves nor rejects visibly is the whole app going blank. It used
   * to run in an async IIFE with no `catch`, and because the effect's deps do
   * not change afterwards nothing ever retried — the app stayed blank on every
   * screen until it was force-quit.
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
      applyLocked(false);
      return;
    }
    try {
      const enabled = (await kv.get("helix.biometric")) === "true";
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
      void kv.get("helix.biometric")
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

/**
 * The second tab, and how it stops being a dead end.
 *
 * Web keeps the SQLite file in OPFS behind an exclusive sync access handle, so
 * only one document can hold it. A second tab therefore boots into
 * `classifyBootFailure` returning "busy", and — because wa-sqlite's VFS stays
 * broken for that document once it has failed — nothing but a reload can
 * recover it. The person was left to work that out and press refresh.
 *
 * So the waiting tab asks, on a slow interval, who has the database; the tab
 * that has it answers; and silence means it is gone, so this one reloads
 * itself. Close the other tab and this one opens on its own.
 *
 * Two designs were tried first and both were wrong, which is worth keeping.
 *
 * The holder announcing its own departure on `pagehide` looks obviously right.
 * It fires on ordinary same-tab navigation too, so the owning tab following a
 * link handed the database to a blocked tab, which took the OPFS handle before
 * the owner's next document could — leaving the tab the person was actually
 * using on the failure screen. The browser suite caught exactly that.
 *
 * Asking only on `focus` and `visibilitychange` avoids polling and is the
 * behaviour a person would describe. Neither event is dependable: a background
 * page can keep `visibilityState: "visible"`, and bringing a tab forward when
 * it is already the only one raises no focus. The recovery then never happened,
 * and the browser suite caught that too.
 *
 * So: an interval, and a hard ceiling on how many times it may reload. The
 * ceiling is what makes the interval safe — a holder that has been FROZEN by
 * the browser cannot answer, and without a bound this would reload for ever in
 * front of someone whose app already would not start.
 */
const DATABASE_HOLDER_CHANNEL = "helix.database.holder";
/** Long enough for a live holder in another tab to answer, short enough that a
 *  person who closed it does not sit looking at a screen that is already stale. */
const HOLDER_REPLY_GRACE_MS = 500;
/** Slow enough to be invisible next to a person reaching for the other tab. */
const HOLDER_PROBE_MS = 2000;
/**
 * A hard ceiling on reloading ourselves, per tab.
 *
 * The reasoning above says a loop cannot form, because a reload produces no
 * focus or visibility event of its own. That is an argument, and this is the
 * screen where being wrong about it means a tab reloading for ever in front of
 * someone whose app already would not start. The counter costs five lines and
 * makes the argument unnecessary.
 */
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
  // Whether another tab answered the last time this one asked. It is what the
  // screen needs in order to stop offering an action that cannot work: while
  // somebody else holds the database, reloading lands on this same screen, and
  // a button that does that is the button this whole mechanism replaced.
  const [heldElsewhere, setHeldElsewhere] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof BroadcastChannel === "undefined") return;
    if (!dbReady && !blocked) return;
    const channel = new BroadcastChannel(DATABASE_HOLDER_CHANNEL);

    if (dbReady) {
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
        setHeldElsewhere(false);
        spendAutoReload();
        window.location.reload();
      }, HOLDER_REPLY_GRACE_MS);
    };
    // The first ask only wants an answer, and deliberately arms no reload. Its
    // job is to tell the screen straight away that another tab has the
    // database, so the control stops offering to reload. Letting it reload
    // would mean a holder that is merely slow to answer — a background tab
    // under throttling — costs a page load before anything is even on screen.
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
