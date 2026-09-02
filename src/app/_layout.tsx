/**
 * Root layout: DB migrations → session bootstrap → biometric lock →
 * route guards (auth / onboarding / tabs). Everything on this path works
 * fully offline; sync, FX and notifications run opportunistically.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, useColorScheme, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import AppWindow from "lucide-react-native/icons/app-window";
import DatabaseZap from "lucide-react-native/icons/database-zap";
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
import { classifyBootFailure, classifyRootRoute, resolveRootGuard, type BootFailure } from "../domain/app-guard";
import { kv } from "../services/kv";
import {
  controlSize,
  darkPalette,
  font,
  radius,
  contentWidth,
  spacing,
  stateOpacity,
  resolvePaletteId,
  DEFAULT_PALETTE_ID,
  lightPalette,
  PALETTES,
  ThemeContext,
  type,
  type PaletteId,
  type ThemePreference,
} from "../ui/theme";
import { Button, EmptyState, Screen, Title, WaitingNotice } from "../ui/components";
import { useLifecycleIntent, type LifecycleIntent } from "../ui/lifecycle-intent";
import type { OperationFlowKind } from "../ui/operation-flow";

import { DialogHost, PromptHost } from "../ui/dialog";
import { ErrorBoundary } from "../ui/error-boundary";
import { FrozenGate } from "../ui/frozen-gate";
import { ThemeDissolve } from "../ui/motion-primitives";
import { applyThemeChange, syncThemeColorMeta } from "../ui/theme-transition";
import { UndoSnackbar, useUndo } from "../ui/undo";
import { tr } from "../i18n/tr";
import { loadDevicePreferences } from "../services/device-preferences";
import { DelayedLoadingIndicator } from "../ui/loading-indicator";
import { HeaderBackButton, TransactionBackButton } from "../ui/header-back";
import { cardScreenOptions, pageScreenOptions } from "../ui/header-bar";

import { devError, installCrashHandlers } from "../services/logger";
import { KeyboardSafeRoot } from "../ui/keyboard-safe";
import { PrivacyCover } from "../ui/privacy-cover";
import {
  useBiometricLock,
  useFirstPullGrace,
  useForegroundSync,
  useMarketLifecycle,
  useDatabaseHandoff,
  useNotificationTapRouting,
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

/**
 * The two endings the boot screen can reach, side by side.
 *
 * A table rather than four `bootFailure === "busy" ?` ternaries in the render:
 * the same question asked four times is four places for the answers to drift
 * apart, and here the whole difference between the two endings is four lines
 * that can be read against each other.
 */
const BOOT_ENDINGS = {
  // Another tab MIGHT have it — nothing has answered yet, so a reload is still
  // worth offering.
  busy: {
    icon: AppWindow,
    title: tr.errors.bootBusyTitle,
    hint: tr.errors.bootBusyHint,
    action: tr.errors.bootBusyAction,
    blocked: false,
  },
  // Another tab has ANSWERED. Reloading provably lands back on this screen, so
  // the control states which tab has the database instead of offering to do
  // something it cannot do — the behaviour the owner reported as "basınca
  // açılmıyor, yine aynı ekran geliyor". Nothing is lost by disabling it: the
  // page reloads itself within about two seconds of that tab closing.
  busyHeld: {
    icon: AppWindow,
    title: tr.errors.bootBusyTitle,
    hint: tr.errors.bootBusyHintHeld,
    action: tr.errors.bootBusyBlocked,
    blocked: true,
  },
  unknown: {
    icon: DatabaseZap,
    title: tr.errors.bootFailedTitle,
    hint: tr.errors.bootFailedHint,
    action: tr.common.retry,
    blocked: false,
  },
} as const;

/** Which of the three endings this failure is, once the other tabs have had
 *  their say. Out here rather than inline so the render stays a lookup. */
function bootEndingFor(failure: BootFailure | null, heldElsewhere: boolean) {
  if (failure !== "busy") return BOOT_ENDINGS.unknown;
  return heldElsewhere ? BOOT_ENDINGS.busyHeld : BOOT_ENDINGS.busy;
}

SplashScreen.preventAutoHideAsync().catch(() => {});

// At module scope, and as early as this file runs: a crash during the first
// render or the first migration is exactly the one worth recording, and a
// handler installed inside an effect would not be there yet to catch it.
installCrashHandlers();

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
  const bootFailure = dbError == null ? null : classifyBootFailure(dbError);
  // A second tab is a wait, not a failure: it ends by itself when the tab
  // holding the database goes away.
  const { heldElsewhere } = useDatabaseHandoff(dbReady, bootFailure === "busy");
  const bootEnding = bootEndingFor(bootFailure, heldElsewhere);
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
  /**
   * The theme for the screens that exist BEFORE preferences are readable.
   *
   * The database has not opened yet, so the saved palette is unknown; the
   * system scheme is the one thing that is. It is the default palette in the
   * right scheme rather than a guess at the user's chosen one, which is enough
   * for the two controls this path draws and stops them being the only
   * surfaces in the app outside the design system.
   */
  const bootTheme = useMemo(
    () => ({
      palette: systemScheme === "dark" ? darkPalette : lightPalette,
      scheme: (systemScheme === "dark" ? "dark" : "light") as "light" | "dark",
      paletteId: DEFAULT_PALETTE_ID,
    }),
    [systemScheme],
  );
  const fontsReady = fontsLoaded || fontsError != null || fontGrace;

  return (
    <KeyboardSafeRoot>
      <>
      {Platform.OS === "web" && (
        <Head>
          {/* Not "Helix" alone. This string is the browser tab, the search
              result, and the headline of every shared link — the one line
              somebody who has never used the app reads first, where a bare
              product name says nothing about what it is for. */}
          <title>{tr.meta.title}</title>
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
        <ThemeContext.Provider value={bootTheme}>
        <View style={{ flex: 1, backgroundColor: background, alignItems: "center", justifyContent: "center" }}>
          {dbError ? (
            /* The one screen a person reaches when the app could not start.
               It used to be a bare centred `Text` carrying only a colour — no
               type style at all, so it rendered at the platform's default size
               in the app's own font-controlled product — with a `Button`
               floating under it and nothing holding the two together. And it
               said "Veritabanı hatası", which names the layer that failed
               rather than what happened or what to do about it.

               `EmptyState` is what every other "nothing here, here is why, here
               is the way out" surface in this app already uses, and it works
               here for the same reason the retry button does: the boot theme
               mounts the same context. The role is moved to the wrapper because
               `EmptyState`'s title is a heading, and this needs to be announced
               as an alert. */
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              // `contentWidth.form` is the same bound every other screen puts on
              // a line of prose. Without it this sentence runs the full width
              // of a desktop window, which is the one place a boot failure is
              // most likely to be read.
              //
              // No `alignSelf: "stretch"`: it overrides the parent's
              // `alignItems: "center"`, and a stretched box with a maxWidth
              // resolves to the START of the axis rather than the middle — the
              // block sat against the left edge of a desktop window while
              // everything inside it was centred within that block.
              style={{ flex: 1, width: "100%", maxWidth: contentWidth.form }}
            >
              <EmptyState
                icon={bootEnding.icon}
                title={bootEnding.title}
                hint={bootEnding.hint}
                action={
                  <Button
                    disabled={bootEnding.blocked}
                    label={bootEnding.action}
                    onPress={() => {
                      // On web the usual cause is another tab holding the
                      // exclusive OPFS access handle, which leaves wa-sqlite's
                      // VFS permanently "Invalid VFS state" FOR THIS DOCUMENT:
                      // re-running the migration in the same page fails
                      // identically forever, while a reload (new realm, new
                      // worker) succeeds the moment the other tab is gone.
                      // Retrying in place made the button look like it did
                      // something and never recovered. `useDatabaseHandoff`
                      // now does this without being asked when the other tab
                      // closes; this stays for the closures it cannot hear —
                      // a crash, a force-quit. Native has no such realm-scoped
                      // VFS: its failures are a locked or corrupt file, which
                      // re-opening genuinely retries.
                      if (Platform.OS === "web" && typeof window !== "undefined") {
                        window.location.reload();
                        return;
                      }
                      setDbReady(false);
                      setAttempt((a) => a + 1);
                    }}
                  />
                }
              />
            </View>
          ) : (
            <DelayedLoadingIndicator />
          )}
        </View>
        </ThemeContext.Provider>
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
  // The shell declares one `theme-color` per scheme so the browser chrome is
  // right before any of this mounts. This is what an explicit in-app theme
  // choice changes; it overwrites those tags rather than adding another,
  // because only the first matching one is ever read.
  useEffect(() => syncThemeColorMeta(theme.palette.background), [theme.palette.background]);


  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = scheme;
    // The keyboard focus ring is drawn by a real `:focus-visible` rule in
    // `+html.tsx` rather than from a Pressable's `focused` flag, because only
    // the browser knows whether focus arrived from a key or from a click — and
    // a ring on every mouse press is worse than no ring at all. The rule needs
    // the live palette, which only this side knows, so the colour crosses over
    // as a custom property.
    document.documentElement.style.setProperty("--helix-focus", theme.palette.focus);
    return () => {
      document.documentElement.style.removeProperty("color-scheme");
      document.documentElement.style.removeProperty("--helix-focus");
    };
  }, [scheme, theme.palette.focus]);

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
  // A tapped reminder opens the record it named. Pushed, not replaced: the
  // screen underneath stays the app the user was already in, so Back and the
  // edge swipe return there rather than closing the app.
  useNotificationTapRouting(ready, userId, locked === false, (route) =>
    router.push(route as Parameters<typeof router.push>[0]));

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
            /* The boot screen's sibling: the database opened, and then the two
               queries that decide which screen to show would not answer. It
               said "Veritabanı hatası" and drew a title over a loose button,
               which is the same shape of message and the same missing design as
               the failure before it — so it is now the same `EmptyState`, with
               copy that says what a person can do rather than which layer
               broke. */
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={{ flex: 1, alignSelf: "stretch", maxWidth: contentWidth.form, width: "100%" }}
            >
              <EmptyState
                icon={DatabaseZap}
                title={tr.errors.bootFailedTitle}
                hint={tr.errors.bootFailedHint}
                action={
                  <Button
                    label={tr.common.retry}
                    onPress={() => {
                      onboardedState.retry();
                      frozenState.retry();
                    }}
                  />
                }
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

      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: theme.palette.background }}>
        <ErrorBoundary>
        <Stack
          screenOptions={{
            ...pageScreenOptions(theme.palette),
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/reset-password" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)/setup" options={{ headerShown: false }} />
          <Stack.Screen name="transaction" options={{ ...cardScreenOptions(theme.palette), title: tr.tx.new, headerLeft: () => <TransactionBackButton /> }} />
          <Stack.Screen name="installment-new" options={{ ...cardScreenOptions(theme.palette), title: tr.installments.newPlan, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow/installments" /> }} />
          <Stack.Screen name="subscription-form" options={{ ...cardScreenOptions(theme.palette), title: tr.subs.add, headerLeft: () => <HeaderBackButton fallback="/(tabs)/subscriptions" /> }} />
          <Stack.Screen name="bulk-entry" options={{ ...cardScreenOptions(theme.palette), title: tr.bulk.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="cell-editor" options={{ ...cardScreenOptions(theme.palette), title: tr.cell.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="import-wizard" options={{ ...cardScreenOptions(theme.palette), title: tr.importer.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="workspace-template" options={{ ...cardScreenOptions(theme.palette), title: tr.template.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings/categories" /> }} />
          <Stack.Screen name="opening-balance" options={{ ...cardScreenOptions(theme.palette), title: tr.settings.opening, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="account-security" options={{ ...cardScreenOptions(theme.palette), title: tr.account.security, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="data-reset" options={{ ...cardScreenOptions(theme.palette), title: tr.dataReset.title, headerLeft: () => <HeaderBackButton fallback="/account-security" /> }} />
          {/* Keep the shared column editor in a normal stack card. An iOS sheet
              owns the same vertical pan used by the reorder grip, even when
              swipe-to-dismiss is disabled; the Settings entry point works
              because it has no sheet recognizer. */}
          <Stack.Screen name="columns-editor" options={{ ...cardScreenOptions(theme.palette), title: tr.cashflow.editColumns, headerLeft: () => <HeaderBackButton fallback="/(tabs)/cash-flow" /> }} />
          <Stack.Screen name="statement-import" options={{ title: tr.statement.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="feedback" options={{ title: tr.feedback.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          {/* Outside the protected group on purpose: the notice has to be
              readable before an account exists, because the screen that asks
              for an e-mail address links to it. */}
          <Stack.Screen name="privacy" options={{ title: tr.legal.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="sync-issues" options={{ title: tr.settings.syncQuarantineTitle, headerLeft: () => <HeaderBackButton fallback="/(tabs)/settings" /> }} />
          <Stack.Screen name="attention" options={{ title: tr.attention.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="reconciliation" options={{ title: tr.catchup.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="upcoming" options={{ title: tr.upcoming.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="analytics" options={{ title: tr.analysis.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
          <Stack.Screen name="market-detail" options={{ ...cardScreenOptions(theme.palette), title: tr.markets.title, headerLeft: () => <HeaderBackButton fallback="/(tabs)" /> }} />
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
