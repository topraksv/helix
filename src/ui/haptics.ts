/**
 * Haptic feedback helpers (iOS only — Android/web are no-ops). Thin wrappers
 * over expo-haptics so every call site picks the right feel from one place:
 *
 * - `lightTap`     a button / cell / key press (Light impact).
 * - `selectionTap` moving between discrete choices — tabs, chips, a reorder
 *   crossing a slot (selection feedback, the Apple-recommended pattern).
 * - `mediumTap`    picking something up (drag start), a heavier confirmation.
 *
 * Guidance: https://docs.expo.dev/versions/v54.0.0/sdk/haptics/
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export function lightTap(): void {
  if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function selectionTap(): void {
  if (Platform.OS === "ios") void Haptics.selectionAsync();
}

export function mediumTap(): void {
  if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}
