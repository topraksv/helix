/**
 * Root layout: DB migrations → session bootstrap → biometric lock →
 * route guards (auth / onboarding / tabs). Everything on this path works
 * fully offline; sync, FX and notifications run opportunistically.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, useColorScheme, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { migrateDb } from "../db/migrate";
import {
  acknowledgeDatabaseRecoveryNotice,
  readDatabaseRecoveryNotice,
  type DatabaseRecoveryNotice,
} from "../db/client";
import { useSession } from "../auth/session";
import { useSyncStatus } from "../sync/status";
import { useAccountFrozenState, useOnboardedState } from "../data/hooks";
import { classifyRootRoute, resolveRootGuard } from "../domain/app-guard";
import { kv } from "../services/kv";
import {
  controlSize,
  darkPalette,
  font,
  radius,
  spacing,
  stateOpacity,
  resolvePaletteId,
  lightPalette,
  PALETTES,
  ThemeContext,
  type,
  type PaletteId,
  type ThemePreference,
} from "../ui/theme";
import { Button, Screen, Title, WaitingNotice } from "../ui/components";
import { useLifecycleIntent, type LifecycleIntent } from "../ui/lifecycle-intent";
import type { OperationFlowKind } from "../ui/operation-flow";

import { DialogHost, PromptHost } from "../ui/dialog";
import { ErrorBoundary } from "../ui/error-boundary";
import { FrozenGate } from "../ui/frozen-gate";
import { ThemeDissolve } from "../ui/motion-primitives";
import { applyThemeChange } from "../ui/theme-transition";
import { UndoSnackbar, useUndo } from "../ui/undo";
import { tr } from "../i18n/tr";
import { loadDevicePreferences } from "../services/device-preferences";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { HeaderBackButton, TransactionBackButton } from "../ui/header-back";
import { cardScreenOptions, primaryScreenOptions, sheetScreenOptions } from "../ui/header-bar";

import { devError } from "../services/logger";
import { KeyboardSafeRoot } from "../ui/keyboard-safe";
import { PrivacyCover } from "../ui/privacy-cover";
import {
  useBiometricLock,
  useFirstPullGrace,
  useForegroundSync,
  useMarketLifecycle,
  useWorkspaceMaintenance,
} from "../ui/root-lifecycle";

// Subset from the upstream Google Fonts packages by `scripts/subset-fonts.mjs`
// — the same TTF on every platform, so mobile web, desktop web, desktop-mode
// mobile web and the installed app all measure and render identically. The
// upstream faces carry 2_849 codepoints each for a Turkish product; see the
// script for what is kept and `tests/font-coverage.test.ts` for what may not
// be dropped.
const Inter_400Regular = require("../../assets/fonts/Inter_400Regular.ttf");
const Inter_500Medium = require("../../assets/fonts/Inter_500Medium.ttf");
const Inter_600SemiBold = require("../../assets/fonts/Inter_600SemiBold.ttf");
const Inter_700Bold = require("../../assets/fonts/Inter_700Bold.ttf");
const IBMPlexSerif_600SemiBold = require("../../assets/fonts/IBMPlexSerif_600SemiBold.ttf");

/** What the guard's waiting view should say, given what the user just did. */
function waitingState(
  intent: LifecycleIntent | null,
  newSignup: boolean,
): { kind: OperationFlowKind; title: string; message: string } {
  switch (intent) {
    case "sign-out":
      return { kind: "sign-out", title: tr.operation.signingOutTitle, message: tr.operation.signingOut };
    case "local-sign-out":
      return { kind: "local-sign-out", title: tr.operation.localSigningOutTitle, message: tr.operation.localSigningOut };
    case "delete":
      return { kind: "delete", title: tr.operation.deletingAccountTitle, message: tr.operation.deletingAccount };
    case "freeze":
      return { kind: "freeze", title: tr.operation.freezingTitle, message: tr.operation.freezePhase.syncing };
    case "reactivate":
      return { kind: "reactivate", title: tr.operation.reactivateTitle, message: tr.auth.restoringData };
    default:
      // No lifecycle operation: this is the first pull after a sign-in, and a
      // brand-new account has nothing to pull.
      return newSignup
        ? { kind: "initialize", title: tr.operation.initializeTitle, message: tr.auth.restoringDataFresh }
        : { kind: "restore", title: tr.operation.restoreTitle, message: tr.auth.restoringData };
  }
}

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Allows the settings screen to switch theme at runtime (device-local pref). */
const themePrefListeners = new Set<(p: ThemePreference) => void>();
const palettePrefListeners = new Set<(p: PaletteId) => void>();

export function setGlobalThemePreference(pref: ThemePreference, fromBackground?: string) {
  void kv.set("helix.theme", pref);
  applyThemeChange(() => {
    for (const listener of themePrefListeners) listener(pref);
  }, fromBackground);
}

export function setGlobalPalettePreference(pref: PaletteId, fromBackground?: string) {
  void kv.set("helix.palette", pref);
  applyThemeChange(() => {
    for (const listener of palettePrefListeners) listener(pref);
  }, fromBackground);
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  // Open + migrate the database (async API on every platform) before the app.
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [databaseRecovery, setDatabaseRecovery] = useState<DatabaseRecoveryNotice | null>(null);
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
    IBMPlexSerif_600SemiBold,
  });

  useEffect(() => {
    let cancelled = false;
    setDbError(null);
    migrateDb().then(
      async () => {
        const recovery = await readDatabaseRecoveryNotice();
        if (!cancelled) {
          setDatabaseRecovery(recovery);
          setDbReady(true);
        }
      },
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
  const primaryForeground = systemScheme === "dark" ? darkPalette.primaryText : lightPalette.primaryText;
  const fontsReady = fontsLoaded || fontsError != null || fontGrace;

  return (
    <KeyboardSafeRoot>
      <>
      {Platform.OS === "web" && (
        <Head>
          <title>{tr.app.name}</title>
        </Head>
      )}
      {dbReady && fontsReady ? (
        databaseRecovery ? (
          <View
            style={{ flex: 1, backgroundColor: background, justifyContent: "center", alignItems: "center", padding: spacing.xl }}
          >
            <View style={{ width: "100%", maxWidth: 520, gap: spacing.md }}>
              <Text accessibilityRole="header" style={[type.title, { color: foreground, fontFamily: font.bold }]}>
                {tr.databaseRecovery.title}
              </Text>
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[type.body, { color: foreground }]}>
                {databaseRecovery.preservedFileName
                  ? tr.databaseRecovery.preserved(databaseRecovery.preservedFileName)
                  : tr.databaseRecovery.recreated}
              </Text>
              <Text style={[type.body, { color: foreground }]}>{tr.databaseRecovery.next}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  acknowledgeDatabaseRecoveryNotice();
                  setDatabaseRecovery(null);
                }}
                style={({ pressed }) => ({
                  minHeight: controlSize.minimumTarget,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.md,
                  backgroundColor: systemScheme === "dark" ? darkPalette.primary : lightPalette.primary,
                  opacity: pressed ? stateOpacity.pressed : 1,
                  paddingHorizontal: spacing.lg,
                })}
              >
                <Text style={[type.label, { color: primaryForeground, fontFamily: font.semibold }]}>{tr.databaseRecovery.continue}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <RootLayoutInner />
        )
      ) : (
        <View
          style={{ flex: 1, backgroundColor: background, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}
        >
          {dbError ? (
            <>
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: foreground, textAlign: "center" }}>{tr.errors.database}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  // On web the usual cause is another tab holding the exclusive
                  // OPFS access handle, which leaves wa-sqlite's VFS permanently
                  // "Invalid VFS state" FOR THIS DOCUMENT: re-running the
                  // migration in the same page fails identically forever, while
                  // a reload (new realm, new worker) succeeds the moment the
                  // other tab is gone. Retrying in place made the button look
                  // like it did something and never recovered, so the user had
                  // to guess that refreshing was the real remedy. Native has no
                  // such realm-scoped VFS — its failures are a locked or corrupt
                  // file, which re-opening genuinely retries.
                  if (Platform.OS === "web" && typeof window !== "undefined") {
                    window.location.reload();
                    return;
                  }
                  setDbReady(false);
                  setAttempt((a) => a + 1);
                }}
                style={({ pressed }) => ({
                  minHeight: controlSize.minimumTarget,
                  paddingHorizontal: spacing.lg,
                  justifyContent: "center",
                  opacity: pressed ? stateOpacity.pressed : 1,
                })}
              >
                <Text style={{ color: primaryForeground, fontWeight: "600" }}>{tr.common.retry}</Text>
              </Pressable>
            </>
          ) : (
            <DelayedLoadingIndicator />
          )}
        </View>
      )}
      </>
    </KeyboardSafeRoot>
  );
}

function RootLayoutInner() {
  const systemScheme = useColorScheme();
  const [themePref, setThemePref] = useState<ThemePreference>("system");
  const [palettePref, setPalettePref] = useState<PaletteId>("clay");
  const { userId, ready, bootstrap, isOnlineSession, isNewSignup, isFreezing } = useSession();
  const lifecycle = useLifecycleIntent();
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
  const paletteId = palettePref;
  const theme = useMemo(
    () => ({
      palette: PALETTES[paletteId][scheme],
      scheme,
      paletteId,
    }),
    [paletteId, scheme],
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
    return () => {
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [scheme]);

  useEffect(() => {
    void loadDevicePreferences();
    void Promise.all([kv.get("helix.theme"), kv.get("helix.palette")]).then(([themeValue, paletteValue]) => {
      if (themeValue === "light" || themeValue === "dark" || themeValue === "system") setThemePref(themeValue);
      setPalettePref(resolvePaletteId(paletteValue));
    });
    themePrefListeners.add(setThemePref);
    palettePrefListeners.add(setPalettePref);
    return () => {
      themePrefListeners.delete(setThemePref);
      palettePrefListeners.delete(setPalettePref);
    };
  }, []);

  useEffect(() => {
    void bootstrap(); // DB is migrated before this component mounts
  }, [bootstrap]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // The undo bar belongs to the session that raised it. Its message quotes a
  // real row ("Netflix · Silindi") and its action is a closure holding the
  // previous account's user id and row snapshot, both of which survive the
  // screen unmounting because the store is module-level. Signing out inside its
  // six-second life therefore carried one account's row name — and a restore
  // that would write that row into the next account's freshly wiped
  // workspace — across the boundary. Every teardown path (sign-out, freeze,
  // deletion, remote invalidation, account switch) changes `userId`, so this is
  // the one place that sees all of them.
  useEffect(() => {
    useUndo.getState().clear();
  }, [userId]);

  // A pull replaced rows this device already showed, so the numbers on screen
  // just changed under the user. Report it once, quietly, in the bar that
  // already carries outcome messages: no modal, nothing to dismiss, no record
  // name, no version and no conflict vocabulary. Self-originated writes are
  // excluded upstream (`remoteSupersededLocal`), so this only ever means
  // another session.
  const remoteChangeAt = useSyncStatus((state) => state.remoteChangeAt);
  useEffect(() => {
    if (remoteChangeAt) useUndo.getState().show(tr.sync.remoteChangeNotice);
  }, [remoteChangeAt]);

  useWorkspaceMaintenance(ready, userId, locked === false);
  useForegroundSync(ready, userId, locked === false);
  useMarketLifecycle(ready, userId, locked === false);

  const guard = resolveRootGuard({
    ready,
    locked,
    userId,
    onboarded,
    frozen,
    awaitingFirstPull,
    route: routeArea,
  });
  useEffect(() => {
    if (guard.redirect) router.replace(guard.redirect);
  }, [guard.redirect, router]);

  // A bare background here is indistinguishable from the app having died, and
  // that is exactly how a stuck lock read was reported: "the screen vanishes".
  // The indicator is delayed, so a normal boot still shows nothing at all.
  if (!ready || locked === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.palette.background, alignItems: "center", justifyContent: "center" }}>
        <DelayedLoadingIndicator />
      </View>
    );
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
  // Signing out, freezing and deleting all land here, because all three end the
  // session. Saying "Hesabın eşitleniyor" through a deletion is the app telling
  // the user the opposite of what it is doing, so the waiting view names the
  // operation the user confirmed — and `OperationFlow` already gives each kind
  // its own icon, tone and motion.
  const wait = waitingState(lifecycle, isNewSignup);
  if (guard.view === "wait" || guardQueryFailed) {
    // This branch renders before the navigator's provider. Keep its retry and
    // first-pull surfaces inside the same palette, otherwise a dark background
    // falls back to the light default theme and produces a white card.
    return (
      <ThemeContext.Provider value={theme}>
        <View
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
          ) : awaitingFirstPull ? (
            // A silent spinner after a correct password reads as a stall. This
            // hold is the account's first pull, and a brand-new account has
            // nothing to pull — so the two say different things.
            <WaitingNotice kind={wait.kind} title={wait.title} message={wait.message} />
          ) : !guard.redirect ? (
            <DelayedLoadingIndicator />
          ) : null}
        </View>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
      {Platform.OS === "web" ? (
        <Head>
          <meta name="theme-color" content={theme.palette.background} />
        </Head>
      ) : null}
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <ErrorBoundary>
        <Stack
          screenOptions={{
            ...primaryScreenOptions(theme.palette),
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)/setup" options={{ headerShown: false }} />
          <Stack.Screen name="transaction" options={{ ...sheetScreenOptions(theme.palette), title: tr.tx.new, headerLeft: () => <TransactionBackButton /> }} />
          <Stack.Screen name="installment-new" options={{ ...sheetScreenOptions(theme.palette), title: tr.installments.newPlan, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow/installments" /> }} />
          <Stack.Screen name="subscription-form" options={{ ...sheetScreenOptions(theme.palette), title: tr.subs.add, headerLeft: () => <HeaderBackButton fallback="/(tabs)/subscriptions" /> }} />
          <Stack.Screen name="bulk-entry" options={{ ...sheetScreenOptions(theme.palette), title: tr.bulk.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="cell-editor" options={{ ...sheetScreenOptions(theme.palette), title: tr.cell.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="import-wizard" options={{ ...cardScreenOptions(theme.palette), title: tr.importer.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="workspace-template" options={{ ...cardScreenOptions(theme.palette), title: tr.template.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings/categories" /> }} />
          <Stack.Screen name="opening-balance" options={{ ...sheetScreenOptions(theme.palette), title: tr.settings.opening, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="account-security" options={{ ...cardScreenOptions(theme.palette), title: tr.account.security, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          {/* Keep the shared column editor in a normal stack card. An iOS sheet
              owns the same vertical pan used by the reorder grip, even when
              swipe-to-dismiss is disabled; the Settings entry point works
              because it has no sheet recognizer. */}
          <Stack.Screen name="columns-editor" options={{ ...cardScreenOptions(theme.palette), title: tr.cashflow.editColumns, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="upcoming" options={{ title: tr.upcoming.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="analytics" options={{ title: tr.analysis.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="payment-sources" options={{ title: tr.settings.sources, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="incomes" options={{ title: tr.settings.incomeRules, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="budgets" options={{ title: tr.budgets.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
        </Stack>
        </ErrorBoundary>
        <UndoSnackbar />
        <DialogHost />
        <PromptHost />
        <PrivacyCover enabled={Boolean(userId)} />
        {/* Last child, so the palette being left covers everything under it
            while it fades. */}
        <ThemeDissolve />
      </View>
    </ThemeContext.Provider>
  );
}
