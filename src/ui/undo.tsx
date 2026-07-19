/** Undo snackbar (approved feature): shown after deletes, restores tombstoned rows. */

import React from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { FadeIn } from "./components";
import { font, overlayShadow, radius, spacing, tabBarHeight, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { haptic, selectionTap, type HapticKind } from "./haptics";

type UndoTone = Extract<HapticKind, "success" | "warning">;

interface UndoState {
  message: string | null;
  onUndo: (() => void) | null;
  show: (message: string, onUndo: () => void, tone?: UndoTone) => void;
  clear: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useUndo = create<UndoState>((set) => ({
  message: null,
  onUndo: null,
  show: (message, onUndo, tone = "success") => {
    if (hideTimer) clearTimeout(hideTimer);
    haptic(tone);
    set({ message, onUndo });
    hideTimer = setTimeout(() => set({ message: null, onUndo: null }), 6000);
  },
  clear: () => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message: null, onUndo: null });
  },
}));

export function UndoSnackbar() {
  const { palette } = useTheme();
  const { message, onUndo, clear } = useUndo();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  // Clear the real tab bar (shared TAB_BAR metrics), not a hardcoded offset
  // that silently drifts when the bar changes.
  const bottom = tabBarHeight(insets.bottom, Platform.OS === "web") + spacing.lg;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom, alignItems: "center" }}
    ><FadeIn>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.lg,
          backgroundColor: palette.text,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          ...overlayShadow,
        }}
      >
        <Text style={[type.body, { color: palette.background }]}>{message}</Text>
        {onUndo ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              selectionTap();
              onUndo();
              clear();
            }}
            hitSlop={8}
          >
            {/* Inverted surface: the action shares the message's ink (an accent
                role would land near-invisible on `palette.text`) and is set
                apart by weight instead of colour. */}
            <Text style={[type.label, { color: palette.background, fontFamily: font.bold, fontSize: 15 }]}>
              {tr.common.undo}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </FadeIn></View>
  );
}
