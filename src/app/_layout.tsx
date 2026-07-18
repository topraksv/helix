/**
 * Root layout: DB migrations → session bootstrap → biometric lock →
 * route guards (auth / onboarding / tabs). Everything on this path works
 * fully offline; sync, FX and notifications run opportunistically.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, useColorScheme, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces/500Medium";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces/600SemiBold";
import { Fraunces_700Bold } from "@expo-google-fonts/fraunces/700Bold";
import { migrateDb } from "../db/migrate";
import { useSession } from "../auth/session";
import { useAccountFrozenState, useOnboardedState } from "../data/hooks";
import { classifyRootRoute, resolveRootGuard } from "../domain/app-guard";
import { kv } from "../lib/kv";
import { darkPalette, lightPalette, ThemeContext, type ThemePreference } from "../ui/theme";
import { Button, Screen, Title } from "../ui/components";
import { DialogHost, PromptHost } from "../ui/dialog";
import { ErrorBoundary } from "../ui/error-boundary";
import { FrozenGate } from "../ui/frozen-gate";
import { UndoSnackbar } from "../ui/undo";
import { tr } from "../i18n/tr";
import { loadDevicePreferences } from "../lib/device-preferences";
import { HeaderBackButton } from "../ui/header-back";
import { stackScreenOptions } from "../ui/navigation";
import { devError } from "../services/logger";
import { PrivacyCover } from "../ui/privacy-cover";
import {
  useBiometricLock,
  useFirstPullGrace,
  useForegroundSync,
  useMarketLifecycle,
  useWorkspaceMaintenance,
} from "../ui/root-lifecycle";

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
      (error) => {
        devError("database-migration", error);
        if (!cancelled) setDbError(String(error));
      },
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
  const primaryForeground = systemScheme === "dark" ? darkPalette.primaryText : lightPalette.primaryText;
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
        <View
          accessible={!dbError}
          accessibilityLiveRegion="polite"
          accessibilityLabel={dbError ? undefined : tr.dataState.loading}
          style={{ flex: 1, backgroundColor: background, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}
        >
          {dbError ? (
            <>
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: foreground, textAlign: "center" }}>{tr.errors.database}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDbReady(false);
                  setAttempt((a) => a + 1);
                }}
                style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: "center" }}
              >
                <Text style={{ color: primaryForeground, fontWeight: "600" }}>{tr.common.retry}</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator accessibilityLabel={tr.dataState.loading} color={primary} />
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
  const { locked, unlock } = useBiometricLock(ready, userId);
  const onboardedState = useOnboardedState(userId);
  const frozenState = useAccountFrozenState(userId);
  const onboarded = onboardedState.data;
  const frozen = frozenState.data;
  const segments = useSegments();
  const router = useRouter();
  const routeArea = classifyRootRoute(segments as string[]);
  const inRecovery = routeArea === "recovery";

  // On a fresh device an already-onboarded account's `onboarded` flag arrives
  // only with the first sync pull; until then the local query returns false and
  // the guard would flash the onboarding screen. Give an online (non-signup)
  // session a bounded grace, lifted only once the live query has re-read the
  // flag AFTER that pull completed (not merely when the pull finished — the
  // query lag is exactly what flashed "Quick Start" on logout→login). A
  // brand-new signup skips the grace (isNewSignup) and reaches onboarding
  // immediately.
  const awaitingFirstPull = useFirstPullGrace({
    userId,
    online: isOnlineSession,
    newSignup: isNewSignup,
    onboarded,
    onboardedUpdatedAt: onboardedState.updatedAt,
    refreshOnboarded: onboardedState.retry,
  });

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

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  useWorkspaceMaintenance(ready, userId, locked === false);
  useForegroundSync(ready, userId, locked === false);
  useMarketLifecycle(ready, userId, locked === false);

  const guard = resolveRootGuard({
    ready,
    locked,
    userId,
    onboarded,
    awaitingFirstPull,
    route: routeArea,
  });
  useEffect(() => {
    if (guard.redirect) router.replace(guard.redirect);
  }, [guard.redirect, router]);

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

  const guardQueryFailed = Boolean(
    userId &&
    ((onboardedState.status === "error" && !onboardedState.updatedAt) ||
      (frozenState.status === "error" && !frozenState.updatedAt)),
  );
  if (guard.view === "wait" || guardQueryFailed) {
    // While an existing account's first pull is still landing, show a spinner
    // rather than a bare background so the hold never reads as a white screen.
    return (
      <View
        accessible={!guardQueryFailed}
        accessibilityLiveRegion="polite"
        accessibilityLabel={guardQueryFailed ? undefined : tr.dataState.loading}
        style={{ flex: 1, backgroundColor: theme.palette.background, justifyContent: "center", alignItems: "center" }}
      >
        {guardQueryFailed ? (
          <View style={{ width: "100%", maxWidth: 420, padding: 24, gap: 16 }}>
            <Title>{tr.errors.database}</Title>
            <Button
              label={tr.common.retry}
              onPress={() => {
                onboardedState.retry();
                frozenState.retry();
              }}
            />
          </View>
        ) : awaitingFirstPull || !guard.redirect ? (
          <ActivityIndicator accessibilityLabel={tr.dataState.loading} color={theme.palette.primary} />
        ) : null}
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
            ...stackScreenOptions(theme.palette),
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)/setup" options={{ headerShown: false }} />
          <Stack.Screen name="transaction" options={{ presentation: "card", title: tr.tx.new, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="installment-new" options={{ presentation: "card", title: tr.installments.newPlan, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow/installments" /> }} />
          <Stack.Screen name="subscription-form" options={{ presentation: "card", title: tr.subs.add, headerLeft: () => <HeaderBackButton fallback="/(tabs)/subscriptions" /> }} />
          <Stack.Screen name="bulk-entry" options={{ presentation: "card", title: tr.bulk.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="cell-editor" options={{ presentation: "card", title: tr.cell.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="import-wizard" options={{ presentation: "card", title: tr.importer.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="workspace-template" options={{ presentation: "card", title: tr.template.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings/categories" /> }} />
          <Stack.Screen name="opening-balance" options={{ presentation: "card", title: tr.settings.opening, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="account-security" options={{ presentation: "card", title: tr.account.security, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          {/* Keep the shared column editor in a normal stack card. An iOS sheet
              owns the same vertical pan used by the reorder grip, even when
              swipe-to-dismiss is disabled; the Settings entry point works
              because it has no sheet recognizer. */}
          <Stack.Screen name="columns-editor" options={{ presentation: "card", title: tr.cashflow.editColumns, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="upcoming" options={{ title: tr.upcoming.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
        </Stack>
        </ErrorBoundary>
        <UndoSnackbar />
        <DialogHost />
        <PromptHost />
        <PrivacyCover enabled={Boolean(userId)} />
      </View>
    </ThemeContext.Provider>
  );
}
