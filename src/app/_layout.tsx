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
import { useOnboarded } from "../data/hooks";
import { runMaintenance } from "../data/repo";
import { loadRateCache, refreshRates } from "../services/fx-fetch";
import { rescheduleAll } from "../services/notifications";
import { syncNow } from "../sync/engine";
import { kv } from "../lib/kv";
import { darkPalette, lightPalette, ThemeContext, type ThemePreference } from "../ui/theme";
import { Button, Screen, Title } from "../ui/components";
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
  const { userId, ready, bootstrap } = useSession();
  const [locked, setLocked] = useState<boolean | null>(null);
  const onboarded = useOnboarded(userId);
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

  useEffect(() => {
    // Auto-prompt Face ID when the gate closes; setState happens only after
    // the async authentication resolves, not synchronously in the effect.
    if (locked === true) void unlock();
  }, [locked, unlock]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Opportunistic background work on open + foreground (never blocks UI).
  useEffect(() => {
    if (!ready || !userId || locked !== false) return;
    const kick = () => {
      void runMaintenance(userId)
        .then(() => rescheduleAll(userId))
        .catch((e) => console.warn("maintenance failed", e));
      void loadRateCache(userId).catch(() => {});
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
    if (!ready || locked !== false) return;
    if (userId && onboarded === null) return;
    const inAuth = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "(onboarding)";
    if (!userId && !inAuth) router.replace("/(auth)/sign-in");
    else if (userId && onboarded === false && !inOnboarding) router.replace("/(onboarding)/setup");
    else if (userId && onboarded === true && (inAuth || inOnboarding || (segments as string[]).length === 0)) {
      router.replace("/(tabs)");
    }
  }, [ready, locked, userId, onboarded, segments, router]);

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

  // Don't render protected screens until the user is signed in AND onboarded:
  // their hooks require a user, and mounting the dashboard's query burst
  // against a freshly created database (mid sign-up, pre-seed) has proven
  // fragile on the web sqlite worker.
  const inAuth = segments[0] === "(auth)";
  const inOnboarding = segments[0] === "(onboarding)";
  const blocked = inAuth ? !!userId && onboarded === true : inOnboarding ? !userId : !userId || onboarded !== true;
  if (blocked) {
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
            headerTitleStyle: { color: theme.palette.text, fontFamily: "Inter_600SemiBold" },
            headerBackTitle: tr.common.back,
            headerBackTitleStyle: { fontFamily: "Inter_500Medium" },
            headerShadowVisible: false,
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
          <Stack.Screen name="cell-editor" options={{ presentation: "modal", title: tr.cell.title }} />
          <Stack.Screen name="import-wizard" options={{ presentation: "modal", title: tr.importer.title }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title }} />
        </Stack>
        <UndoSnackbar />
      </View>
    </ThemeContext.Provider>
  );
}
