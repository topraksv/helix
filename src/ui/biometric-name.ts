import { tr } from "../i18n/tr";

export const BIOMETRIC_KEY = "helix.biometric";

/**
 * The name of the device's own biometric lock.
 *
 * The label is asked of the hardware.
 *
 * Pure on purpose: the sensor query and the React state live in
 * the settings screen, and this rule is what a test can hold.
 */
export function biometricName({
  ios,
  facial,
  fingerprint,
}: {
  ios: boolean;
  facial: boolean;
  fingerprint: boolean;
}): string {
  if (ios) {
    if (facial) return tr.settings.biometricFaceId;
    if (fingerprint) return tr.settings.biometricTouchId;
    return tr.settings.biometric;
  }
  if (facial && !fingerprint) return tr.settings.biometricFace;
  if (fingerprint) return tr.settings.biometricFingerprint;
  // Neither enrolled, or a sensor this app has no word for: the neutral name is
  // already correct for every device.
  return tr.settings.biometric;
}
