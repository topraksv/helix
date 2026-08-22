/** Prevents financial UI from appearing in native app-switcher snapshots. */

import { useEffect, useState } from "react";
import { AppState, Modal, Platform, Text, View } from "react-native";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import { tr } from "../i18n/tr";
import { Button } from "./components";
import { useModalAccessibility } from "./accessibility";
import { radius, spacing, type, useTheme } from "./theme";
import { shouldCoverSensitiveUi } from "../domain/privacy";

function framedOnWeb(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * The key this component holds on the screen-capture lock.
 *
 * `expo-screen-capture` refcounts by key, so naming ours keeps a future second
 * caller from releasing a lock it did not take.
 */
const CAPTURE_LOCK = "helix-financial-ui";

/**
 * Android cannot be covered by drawing, so it is covered by the window flag.
 *
 * The cover below is a React render, and on Android there is no moment to
 * render it in: React Native's own `AppState` documents `inactive` as
 * `@platform ios`, so Android reports `background` only once the app is
 * already gone and the system has taken its recents thumbnail. iOS gives us
 * `inactive` first, which is why the same cover works there.
 *
 * `preventScreenCaptureAsync` sets `FLAG_SECURE`, and the platform then blanks
 * the recents preview itself — no render, no race. It is not free: the same
 * flag blocks screenshots and screen recording while it is held, and Android
 * offers no way to have one without the other (`enableAppSwitcherProtection`,
 * which does separate them, is iOS-only). So it is held only while an account
 * is signed in, which is exactly when synced financial data is on screen;
 * account-less use keeps screenshots working.
 */
function useAndroidCaptureBlock(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    // Failure here must not take the screen down with it: the JS cover below
    // still runs, and a device that refuses the flag is a device that keeps
    // working rather than one that crashes on sign-in.
    if (enabled) void preventScreenCaptureAsync(CAPTURE_LOCK).catch(() => {});
    else void allowScreenCaptureAsync(CAPTURE_LOCK).catch(() => {});
  }, [enabled]);
}

export function PrivacyCover({ enabled }: { enabled: boolean }) {
  useAndroidCaptureBlock(enabled);
  const { palette } = useTheme();
  const [covered, setCovered] = useState(() =>
    shouldCoverSensitiveUi(Platform.OS, AppState.currentState, framedOnWeb(), enabled),
  );
  const titleRef = useModalAccessibility(covered);

  useEffect(() => {
    if (Platform.OS === "web") {
      setCovered(framedOnWeb());
      return;
    }
    setCovered(shouldCoverSensitiveUi(Platform.OS, AppState.currentState, false, enabled));
    const subscription = AppState.addEventListener("change", (state) =>
      setCovered(shouldCoverSensitiveUi(Platform.OS, state, false, enabled)),
    );
    return () => subscription.remove();
  }, [enabled]);

  if (!covered) return null;
  const framed = Platform.OS === "web";
  return (
    <Modal visible animationType="none" onRequestClose={() => {}}>
      <View
        accessibilityViewIsModal
        importantForAccessibility="yes"
        style={{
          flex: 1,
          backgroundColor: palette.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
        }}
      >
        <View style={{ width: "100%", maxWidth: 380, alignItems: "center" }}>
          <View style={{ width: 64, height: 64, borderRadius: radius.xl, backgroundColor: palette.primarySoft, alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck accessible={false} size={30} color={palette.primaryText} />
          </View>
          <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
            <Text style={[type.heading, { color: palette.text, textAlign: "center", marginTop: spacing.lg }]}>
              {tr.privacy.coverTitle}
            </Text>
          </View>
          <Text style={[type.body, { color: palette.textSecondary, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 }]}>
            {framed ? tr.privacy.framedBody : tr.privacy.coverBody}
          </Text>
          {framed ? (
            <View style={{ alignSelf: "stretch", marginTop: spacing.lg }}>
              <Button
                label={tr.privacy.openDirectly}
                onPress={() => {
                  if (typeof window !== "undefined") window.open(window.location.href, "_top", "noopener");
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
