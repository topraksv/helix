/** Undo snackbar (approved feature): shown after deletes, restores tombstoned rows. */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { create } from "zustand";
import { FadeIn } from "./components";
import { radius, spacing, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";

interface UndoState {
  message: string | null;
  onUndo: (() => void) | null;
  show: (message: string, onUndo: () => void) => void;
  clear: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useUndo = create<UndoState>((set) => ({
  message: null,
  onUndo: null,
  show: (message, onUndo) => {
    if (hideTimer) clearTimeout(hideTimer);
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
  if (!message) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: spacing.lg, right: spacing.lg, bottom: 96, alignItems: "center" }}
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
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <Text style={[type.body, { color: palette.background }]}>{message}</Text>
        {onUndo ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onUndo();
              clear();
            }}
            hitSlop={8}
          >
            <Text style={[type.label, { color: palette.primary, fontSize: 15 }]}>{tr.common.undo}</Text>
          </Pressable>
        ) : null}
      </View>
    </FadeIn></View>
  );
}
