/** Focused root hooks for lock, first-pull grace and background work. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { kv } from "../lib/kv";
import { runMaintenance } from "../data/repo";
import { loadRateCache, refreshRates } from "../services/fx-fetch";
import { connectMarkets, disconnectMarkets, suspendMarkets } from "../services/markets";
import { rescheduleAll } from "../services/notifications";
import { devWarning } from "../services/logger";
import { runSyncSessionTask, syncNow } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { tr } from "../i18n/tr";

export function useBiometricLock(ready: boolean, userId: string | null) {
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      if (!userId) {
        setLocked(false);
        return;
      }
      const enabled = (await kv.get("helix.biometric")) === "true";
      setLocked(enabled && Platform.OS !== "web");
    })();
  }, [ready, userId]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: tr.lock.prompt });
    if (result.success) setLocked(false);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || !userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      void kv.get("helix.biometric").then((value) => {
        if (value === "true") setLocked(true);
      });
    });
    return () => subscription.remove();
  }, [userId]);

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

  useEffect(() => {
    if (lastSyncAt) setGrace(false);
  }, [lastSyncAt]);

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
