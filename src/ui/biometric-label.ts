import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { tr } from "../i18n/tr";
import { biometricName } from "./biometric-name";

/**
 * The device's own name for its biometric lock, asked of the hardware.
 *
 * The neutral name covers the frame before the query returns, so the row never
 * renders empty and never claims a sensor before the device has answered.
 */
export function useBiometricLabel(): string {
  const [label, setLabel] = useState<string>(tr.settings.biometric);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let alive = true;
    void LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (!alive) return;
        setLabel(
          biometricName({
            ios: Platform.OS === "ios",
            facial: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
            fingerprint: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
          }),
        );
      })
      .catch(() => {
        // An unreadable sensor list is not worth surfacing; the neutral name is
        // already correct.
      });
    return () => {
      alive = false;
    };
  }, []);
  return label;
}
