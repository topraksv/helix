/**
 * Root layout: DB migrations → session bootstrap → biometric lock →
 * route guards (auth / onboarding / tabs). Everything on this path works
 * fully offline; sync, FX and notifications run opportunistically.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Platform, Text, useColorScheme, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as LocalAuthentication from "expo-local-authentication";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../db/migrations/migrations";
import { getDb, warmupDb } from "../db/client";
import { useSession } from "../auth/session";
import { isOnboarded, runMaintenance } from "../data/repo";
import { refreshRates } from "../services/fx-fetch";
import { rescheduleAll } from "../services/notifications";
import { syncNow } from "../sync/engine";
import { kv } from "../lib/kv";
import { darkPalette, lightPalette, ThemeContext, type ThemePreference } from "../ui/theme";
import { Body, Button, Screen, Title } from "../ui/components";
import { UndoSnackbar } from "../ui/undo";
import { tr } from "../i18n/tr";

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Allows the settings screen to switch theme at runtime (device-local pref). */
const themePrefListeners = new Set<(p: ThemePreference) => void>();

export function setGlobalThemePreference(pref: ThemePreference) {
  void kv.set("helix.theme", pref);
  for (const listener of themePrefListeners) listener(pref);
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  // Web: the sqlite worker must be booted through the async API before the
  // first openDatabaseSync call (see warmupDb). Native opens synchronously.
  const [dbReady, setDbReady] = useState(Platform.OS !== "web");
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    if (dbReady) return;
    warmupDb()
      .then(() => setDbReady(true))
      .catch((e) => setDbError(String(e)));
  }, [dbReady]);

  const background = systemScheme === "dark" ? darkPalette.background : lightPalette.background;
  const foreground = systemScheme === "dark" ? darkPalette.text : lightPalette.text;

  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Helix</title>
        </Head>
      )}
      {dbReady ? (
        <RootLayoutInner />
      ) : (
        <View style={{ flex: 1, backgroundColor: background, justifyContent: "center", padding: 24 }}>
          {dbError ? (
            <Text style={{ color: foreground }}>
              {tr.errors.database}
              {"\n"}
              {dbError}
            </Text>
          ) : null}
        </View>
      )}
    </>
  );
}

function RootLayoutInner() {
  const { success: migrated, error: migrationError } = useMigrations(getDb(), migrations);
  const systemScheme = useColorScheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const { userId, ready, bootstrap } = useSession();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const segments = useSegments();
  const router = useRouter();

  const scheme: "light" | "dark" =
    themePref === "system" ? (systemScheme === "dark" ? "dark" : "light") : themePref;
  const theme = useMemo(
    () => ({ palette: scheme === "dark" ? darkPalette : lightPalette, scheme }),
    [scheme],
  );

  useEffect(() => {
    void kv.get("helix.theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setThemePref(v);
    });
    themePrefListeners.add(setThemePref);
    return () => void themePrefListeners.delete(setThemePref);
  }, []);

  useEffect(() => {
    if (migrated) void bootstrap();
  }, [migrated, bootstrap]);

  // Biometric gate (spec §2.3) — local check, works offline.
  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      setLocked(false);
      return;
    }
    void (async () => {
      const enabled = (await kv.get("helix.biometric")) === "true";
      setLocked(enabled && Platform.OS !== "web");
    })();
  }, [ready, userId]);

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: tr.lock.prompt });
    if (result.success) setLocked(false);
  }, []);

  useEffect(() => {
    if (locked === true) void unlock();
  }, [locked, unlock]);

  useEffect(() => {
    if (migrated && ready) SplashScreen.hideAsync().catch(() => {});
  }, [migrated, ready]);

  // Opportunistic background work on open + foreground (never blocks UI).
  useEffect(() => {
    if (!ready || !userId || locked !== false) return;
    setOnboarded(isOnboarded(userId));
    const kick = () => {
      void runMaintenance(userId)
        .then(() => rescheduleAll(userId))
        .catch((e) => console.warn("maintenance failed", e));
      void refreshRates(userId).catch(() => {});
      void syncNow(userId);
    };
    kick();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => sub.remove();
  }, [ready, userId, locked]);

  // Route guards.
  useEffect(() => {
    if (!migrated || !ready || locked !== false) return;
    if (userId && onboarded === null) return;
    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "(onboarding)";
    if (!userId && !inAuth) router.replace("/(auth)/sign-in");
    else if (userId && onboarded === false && !inOnboarding) router.replace("/(onboarding)/setup");
    else if (userId && onboarded === true && (inAuth || inOnboarding || (segments as string[]).length === 0)) {
      router.replace("/(tabs)");
    }
  }, [migrated, ready, locked, userId, onboarded, segments, router]);

  if (migrationError) {
    return (
      <ThemeContext.Provider value={theme}>
        <Screen scroll={false}>
          <Title>{tr.errors.database}</Title>
          <Body>{String(migrationError)}</Body>
        </Screen>
      </ThemeContext.Provider>
    );
  }

  if (!migrated || !ready || locked === null) {
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

  // The route-guard effect above is about to redirect; don't render the
  // current (protected) screen in the meantime — its hooks require a user.
  const inAuth = segments[0] === "(auth)";
  const inOnboarding = segments[0] === "(onboarding)";
  const redirecting =
    (!userId && !inAuth) || (!!userId && onboarded === false && !inOnboarding);
  if (redirecting) {
    return <View style={{ flex: 1, backgroundColor: theme.palette.background }} />;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.palette.surface },
            headerTintColor: theme.palette.text,
            headerTitleStyle: { color: theme.palette.text },
            contentStyle: { backgroundColor: theme.palette.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)/setup" options={{ headerShown: false }} />
          <Stack.Screen name="transaction" options={{ presentation: "modal", title: tr.tx.new }} />
          <Stack.Screen name="installment-new" options={{ presentation: "modal", title: tr.installments.newPlan }} />
          <Stack.Screen name="subscription-form" options={{ presentation: "modal", title: tr.subs.add }} />
          <Stack.Screen name="bulk-entry" options={{ presentation: "modal", title: tr.bulk.title }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title }} />
        </Stack>
        <UndoSnackbar />
      </View>
    </ThemeContext.Provider>
  );
}
