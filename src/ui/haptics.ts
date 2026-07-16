/**
 * Haptic feedback helpers (iOS only — Android/web are no-ops). Thin wrappers
 * over expo-haptics so every call site picks the right feel from one place:
 *
 * - `lightTap`     a button / cell / key press (Light impact).
 * - `selectionTap` moving between discrete choices — tabs, chips, a reorder
 *   crossing a slot (selection feedback, the Apple-recommended pattern).
 * - `mediumTap`    picking something up (drag start), a heavier confirmation.
 * - notification feedback is reserved for a completed success, warning, or
 *   error outcome rather than the press that started an async operation.
 *
 * Guidance: https://docs.expo.dev/versions/v54.0.0/sdk/haptics/
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticKind = "none" | "light" | "selection" | "medium" | "success" | "warning" | "error";

/** Native feedback is an enhancement: unsupported/disabled hardware must never
 * turn a valid user action into an unhandled rejection. */
export function haptic(kind: HapticKind): void {
  if (Platform.OS !== "ios" || kind === "none") return;
  try {
    const request =
      kind === "light"
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : kind === "medium"
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          : kind === "selection"
            ? Haptics.selectionAsync()
            : Haptics.notificationAsync(
                kind === "success"
                  ? Haptics.NotificationFeedbackType.Success
                  : kind === "warning"
                    ? Haptics.NotificationFeedbackType.Warning
                    : Haptics.NotificationFeedbackType.Error,
              );
    void request.catch(() => {});
  } catch {
    // Haptics never block the underlying interaction.
  }
}

export function lightTap(): void {
  haptic("light");
}

export function selectionTap(): void {
  haptic("selection");
}

export function mediumTap(): void {
  haptic("medium");
}

export function selectionTapIfChanged(previous: string | null | undefined, next: string): void {
  if (previous !== next) selectionTap();
}

export function successNotice(): void {
  haptic("success");
}

export function errorNotice(): void {
  haptic("error");
}
