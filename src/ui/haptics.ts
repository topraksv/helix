/** iOS-only haptics; Android and web are no-ops. Notification feedback is for an outcome, never for the press that started it. */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export type HapticKind = "none" | "light" | "selection" | "medium" | "success" | "warning" | "error";

// Native feedback is an enhancement: unsupported hardware must not turn a valid action into an unhandled rejection.
function feel(play: () => Promise<void>): void {
  if (Platform.OS !== "ios") return;
  void Promise.resolve().then(play).catch(() => {});
}

const PLAY: Record<Exclude<HapticKind, "none">, () => Promise<void>> = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  selection: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function haptic(kind: HapticKind): void {
  if (kind !== "none") feel(PLAY[kind]);
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

export function errorNotice(): void {
  haptic("error");
}
