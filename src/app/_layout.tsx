/**
 * Root layout: DB migrations → session bootstrap → biometric lock →
 * route guards (auth / onboarding / tabs). Everything on this path works
 * fully offline; sync, FX and notifications run opportunistically.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Platform, Text, useColorScheme, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as LocalAuthentication from "expo-local-authentication";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Fraunces_500Medium, Fraunces_600SemiBold, Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import { migrateDb } from "../db/migrate";
import { useSession } from "../auth/session";
import { useAccountFrozen, useOnboarded } from "../data/hooks";
import { runMaintenance } from "../data/repo";
import { loadRateCache, refreshRates } from "../services/fx-fetch";
import { rescheduleAll } from "../services/notifications";
import { connectMarkets, disconnectMarkets } from "../services/markets";
import { runSyncSessionTask, syncNow } from "../sync/engine";
import { useSyncStatus } from "../sync/status";
import { kv } from "../lib/kv";
import { darkPalette, lightPalette, ThemeContext, type ThemePreference } from "../ui/theme";
import { Button, Screen, Title } from "../ui/components";
import { DialogHost, PromptHost } from "../ui/dialog";
import { ErrorBoundary } from "../ui/error-boundary";
import { devWarning } from "../services/logger";
import { FrozenGate } from "../ui/frozen-gate";
import { UndoSnackbar } from "../ui/undo";
import { tr } from "../i18n/tr";
import { loadDevicePreferences } from "../lib/device-preferences";
import { HeaderBackButton } from "../ui/header-back";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Allows the settings screen to switch theme at runtime (device-local pref). */
const themePrefListeners = new Set<(p: ThemePreference) => void>();

export function setGlobalThemePreference(pref: ThemePreference) {
  void kv.set("helix.theme", pref);
  for (const listener of themePrefListeners) listener(pref);
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  // Open + migrate the database (async API on every platform) before the app.
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Fonts are cosmetic: never let a slow/flaky web font fetch hold the whole
  // app on a blank screen — after a short grace we render with the system
  // fallback (this was the mobile-web "white screen" culprit).
  const [fontGrace, setFontGrace] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  useEffect(() => {
    let cancelled = false;
    setDbError(null);
    migrateDb().then(
      () => !cancelled && setDbReady(true),
      (e) => !cancelled && setDbError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const t = setTimeout(() => setFontGrace(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const background = systemScheme === "dark" ? darkPalette.background : lightPalette.background;
  const foreground = systemScheme === "dark" ? darkPalette.text : lightPalette.text;
  const primary = systemScheme === "dark" ? darkPalette.primary : lightPalette.primary;
  const fontsReady = fontsLoaded || fontsError != null || fontGrace;

  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Helix</title>
        </Head>
      )}
      {dbReady && fontsReady ? (
        <RootLayoutInner />
      ) : (
        <View style={{ flex: 1, backgroundColor: background, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
          {dbError ? (
            <>
              <Text style={{ color: foreground, textAlign: "center" }}>{tr.errors.database}</Text>
              <Text
                accessibilityRole="button"
                onPress={() => {
                  setDbReady(false);
                  setAttempt((a) => a + 1);
                }}
                style={{ color: primary, fontWeight: "600" }}
              >
                {tr.common.retry}
              </Text>
            </>
          ) : (
            <ActivityIndicator color={primary} />
          )}
        </View>
      )}
    </>
  );
}

function RootLayoutInner() {
  const systemScheme = useColorScheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const { userId, ready, bootstrap, isOnlineSession, isNewSignup, isFreezing } = useSession();
  const [locked, setLocked] = useState<boolean | null>(null);
  const onboarded = useOnboarded(userId);
  const frozen = useAccountFrozen(userId);
  const segments = useSegments();
  const router = useRouter();
  const inRecovery = segments[0] === "(auth)" && (segments as string[])[1] === "reset-password";

  // On a fresh device an already-onboarded account's `onboarded` flag arrives
  // only with the first sync pull; until then the local query returns false and
  // the guard would flash the onboarding screen. Give an online (non-signup)
  // session a bounded grace to let that first pull land before allowing the
  // onboarding redirect. This is a plain timer (no external-store subscription),
  // so it can't drive a re-render loop. A brand-new signup skips the grace
  // (isNewSignup) and reaches onboarding immediately.
  const [pullGrace, setPullGrace] = useState(false);
  const lastSyncAt = useSyncStatus((st) => st.lastSyncAt);
  useEffect(() => {
    if (userId && isOnlineSession && !isNewSignup) {
      setPullGrace(true);
      // 8 s is only a fallback cap for an offline / erroring first sync; the
      // effect below lifts the hold the instant the pull actually lands.
      const t = setTimeout(() => setPullGrace(false), 8000);
      return () => clearTimeout(t);
    }
    setPullGrace(false);
    return undefined;
  }, [userId, isOnlineSession, isNewSignup]);
  // Lift the grace the moment the first sync pass completes (the onboarded flag
  // and any cloud data have landed) instead of blindly waiting the full 8 s.
  // For an account with no cloud data this ends the post-login hold in a few
  // hundred ms rather than seconds. lastSyncAt is reset to null on sign-out, so
  // it is always null again by the next sign-in.
  useEffect(() => {
    if (lastSyncAt) setPullGrace(false);
  }, [lastSyncAt]);
  const awaitingFirstPull = pullGrace && onboarded === false;

  const scheme: "light" | "dark" =
    themePref === "system" ? (systemScheme === "dark" ? "dark" : "light") : themePref;
  const theme = useMemo(
    () => ({ palette: scheme === "dark" ? darkPalette : lightPalette, scheme }),
    [scheme],
  );

  useEffect(() => {
    void loadDevicePreferences();
    void kv.get("helix.theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setThemePref(v);
    });
    themePrefListeners.add(setThemePref);
    return () => void themePrefListeners.delete(setThemePref);
  }, []);

  useEffect(() => {
    void bootstrap(); // DB is migrated before this component mounts
  }, [bootstrap]);

  // Biometric gate (spec §2.3) — local check, works offline.
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

  // Re-arm the biometric gate whenever the app is backgrounded, so Face ID
  // protects the data on every return — not only on a cold start. We listen for
  // "background" (a real app switch) rather than "inactive" (which also fires
  // for the Face ID overlay itself, which would loop the prompt).
  useEffect(() => {
    if (Platform.OS === "web" || !userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      void kv.get("helix.biometric").then((v) => {
        if (v === "true") setLocked(true);
      });
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    // Auto-prompt Face ID when the gate closes; setState happens only after
    // the async authentication resolves, not synchronously in the effect.
    if (locked === true) void unlock();
  }, [locked, unlock]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Opportunistic background work on open + foreground (never blocks UI).
  // Throttled: on web, "active" fires on every tab focus — rapid tab switches
  // must not re-run the full maintenance + FX + sync pass each time. The
  // throttle is per-user so an account switch always gets its initial pass.
  const lastKickAt = React.useRef(0);
  const lastKickUser = React.useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !userId || locked !== false) return;
    const kick = () => {
      if (lastKickUser.current === userId && Date.now() - lastKickAt.current < 60_000) return;
      lastKickUser.current = userId;
      lastKickAt.current = Date.now();
      // Run maintenance BEFORE sync (not concurrently): maintenance writes land
      // in the outbox first, so the initial pull/push runs once instead of being
      // re-triggered mid-flight by those writes. All DB transactions are
      // serialized (see db/client withTransaction), but sequencing here also
      // avoids a rerun storm right after sign-in.
      void runSyncSessionTask(userId, async (signal) => {
        await runMaintenance(userId);
        if (signal.aborted) return;
        await rescheduleAll(userId);
      })
        .catch((e) => devWarning("maintenance", String(e)))
        .finally(() => void syncNow(userId));
      void runSyncSessionTask(userId, async (signal) => {
        await loadRateCache(userId);
        if (!signal.aborted) await refreshRates(userId, signal);
      }).catch(() => {});
    };
    kick();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => sub.remove();
  }, [ready, userId, locked]);

  // Keep the live market stream only while an authenticated workspace is
  // actively visible. Backgrounding closes the socket immediately; foreground
  // opens one idempotent connection. This avoids stale prices, radio/battery
  // use and orphan reconnect loops after account changes.
  useEffect(() => {
    if (!ready || !userId || locked !== false) {
      disconnectMarkets();
      return;
    }
    const update = (state: string) => {
      if (state === "active") connectMarkets();
      else disconnectMarkets();
    };
    update(AppState.currentState);
    const sub = AppState.addEventListener("change", update);
    return () => {
      sub.remove();
      disconnectMarkets();
    };
  }, [ready, userId, locked]);

  // Route guards.
  useEffect(() => {
    if (!ready || locked !== false) return;
    if (userId && onboarded === null) return;
    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "(onboarding)";
    // Setup can seed the workspace then push an importer (Excel / bulk history)
    // BEFORE marking onboarded, so those routes are allowed while onboarded is
    // still false; closing them returns to the onboarding screen.
    const inSetupHelper = segments[0] === "import-wizard" || segments[0] === "bulk-entry";
    if (!userId && !inAuth) router.replace("/(auth)/sign-in");
    else if (userId && onboarded === false && !awaitingFirstPull && !inRecovery && !inOnboarding && !inSetupHelper) router.replace("/(onboarding)/setup");
    else if (userId && onboarded === true && !inRecovery && (inAuth || inOnboarding || (segments as string[]).length === 0)) {
      router.replace("/(tabs)");
    }
  }, [ready, locked, userId, onboarded, awaitingFirstPull, inRecovery, segments, router]);

  if (!ready || locked === null) {
    return <View style={{ flex: 1, backgroundColor: theme.palette.background }} />;
  }

  if (locked) {
    return (
      <ThemeContext.Provider value={theme}>
        <Screen scroll={false}>
          <View style={{ flex: 1, justifyContent: "center", gap: 16 }}>
            <Title>{tr.lock.title}</Title>
            <Button label={tr.lock.button} onPress={() => void unlock()} />
          </View>
        </Screen>
      </ThemeContext.Provider>
    );
  }

  // Frozen account: block everything behind the reactivation gate. Only applies
  // to a signed-in, onboarded user (frozen is null when signed out); suppressed
  // on the device that is mid-freeze (it's about to sign out to the login page).
  if (userId && onboarded === true && frozen === true && !isFreezing && !inRecovery) {
    return (
      <ThemeContext.Provider value={theme}>
        <FrozenGate />
        <DialogHost />
      </ThemeContext.Provider>
    );
  }

  // Don't render protected screens until the user is signed in AND onboarded:
  // their hooks require a user, and mounting the dashboard's query burst
  // against a freshly created database (mid sign-up, pre-seed) has proven
  // fragile on the web sqlite worker.
  const inAuth = segments[0] === "(auth)";
  const inOnboarding = segments[0] === "(onboarding)";
  // Importers launched from onboarding (workspace seeded, not yet finalized)
  // must render even though onboarded is still false.
  const inSetupHelper = segments[0] === "import-wizard" || segments[0] === "bulk-entry";
  const blocked = inRecovery
    ? false
    : inAuth
    ? !!userId && (onboarded === true || awaitingFirstPull)
    : inOnboarding || inSetupHelper
      ? !userId
      : !userId || onboarded !== true;
  if (blocked) {
    // While an existing account's first pull is still landing, show a spinner
    // rather than a bare background so the hold never reads as a white screen.
    return (
      <View style={{ flex: 1, backgroundColor: theme.palette.background, justifyContent: "center", alignItems: "center" }}>
        {awaitingFirstPull ? <ActivityIndicator color={theme.palette.primary} /> : null}
      </View>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <ErrorBoundary>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.palette.surface },
            headerTintColor: theme.palette.text,
            headerTitleStyle: { color: theme.palette.text, fontFamily: "Inter_600SemiBold" },
            headerBackTitle: tr.common.back,
            headerBackTitleStyle: { fontFamily: "Inter_500Medium" },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.palette.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)/setup" options={{ headerShown: false }} />
          <Stack.Screen name="transaction" options={{ presentation: "modal", title: tr.tx.new, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="installment-new" options={{ presentation: "modal", title: tr.installments.newPlan, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow/installments" /> }} />
          <Stack.Screen name="subscription-form" options={{ presentation: "modal", title: tr.subs.add, headerLeft: () => <HeaderBackButton fallback="/(tabs)/subscriptions" /> }} />
          <Stack.Screen name="bulk-entry" options={{ presentation: "modal", title: tr.bulk.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="cell-editor" options={{ presentation: "modal", title: tr.cell.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="import-wizard" options={{ presentation: "modal", title: tr.importer.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="workspace-template" options={{ presentation: "modal", title: tr.template.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings/categories" /> }} />
          <Stack.Screen name="opening-balance" options={{ presentation: "modal", title: tr.settings.opening, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="account-security" options={{ presentation: "modal", title: tr.account.security, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          {/* Keep the shared column editor in a normal stack card. An iOS sheet
              owns the same vertical pan used by the reorder grip, even when
              swipe-to-dismiss is disabled; the Settings entry point works
              because it has no sheet recognizer. */}
          <Stack.Screen name="columns-editor" options={{ presentation: "card", title: tr.cashflow.editColumns, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
        </Stack>
        </ErrorBoundary>
        <UndoSnackbar />
        <DialogHost />
        <PromptHost />
      </View>
    </ThemeContext.Provider>
  );
}
