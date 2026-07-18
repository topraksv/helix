/** Prevents financial UI from appearing in native app-switcher snapshots. */

import { useEffect, useState } from "react";
import { AppState, Modal, Platform, Text, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
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

export function PrivacyCover() {
  const { palette } = useTheme();
  const [covered, setCovered] = useState(() => shouldCoverSensitiveUi(Platform.OS, AppState.currentState, framedOnWeb()));
  const titleRef = useModalAccessibility(covered);

  useEffect(() => {
    if (Platform.OS === "web") {
      setCovered(framedOnWeb());
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => setCovered(shouldCoverSensitiveUi(Platform.OS, state, false)));
    return () => subscription.remove();
  }, []);

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
          <Text style={[type.body, { color: palette.textMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: 22 }]}>
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
