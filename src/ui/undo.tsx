/** Undo snackbar (approved feature): shown after deletes, restores tombstoned rows. */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Check, RotateCcw, TriangleAlert } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { SlideUp, SuccessPop } from "./motion-primitives";
import { controlSize, font, navigationInset, radius, spacing, stateOpacity, themeShadow, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { haptic, selectionTap, type HapticKind } from "./haptics";
import { runUndo } from "../domain/undo-outcome";
import { devError } from "../services/logger";
import { appAlert } from "./dialog";

type UndoTone = Extract<HapticKind, "success" | "warning">;

interface UndoState {
  message: string | null;
  onUndo: (() => Promise<unknown> | unknown) | null;
  tone: UndoTone;
  /** `onUndo` is optional: the same bar also confirms an action that has
   *  nothing to take back, and then renders without the action label. */
  show: (message: string, onUndo?: (() => Promise<unknown> | unknown) | null, tone?: UndoTone) => void;
  clear: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useUndo = create<UndoState>((set) => ({
  message: null,
  onUndo: null,
  tone: "success",
  show: (message, onUndo = null, tone = "success") => {
    if (hideTimer) clearTimeout(hideTimer);
    haptic(tone);
    set({ message, onUndo: onUndo ?? null, tone });
    // Pure confirmations leave quickly; an undo action or warning stays long
    // enough to be read and acted on without becoming permanent chrome.
    const duration = onUndo || tone === "warning" ? 6000 : 3600;
    hideTimer = setTimeout(() => set({ message: null, onUndo: null, tone: "success" }), duration);
  },
  clear: () => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message: null, onUndo: null, tone: "success" });
  },
}));

export function UndoSnackbar() {
  const { palette } = useTheme();
  const { message, onUndo, tone, clear } = useUndo();
  const insets = useSafeAreaInsets();
  const [undoing, setUndoing] = React.useState(false);
  if (!message) return null;
  // Clear the real navigation surface (shared tokens), not a hardcoded offset
  // that silently drifts when the bar changes. It floats, so the space it
  // occupies is its clearance, not just its size.
  const nav = navigationInset({ bottomInset: insets.bottom, isWeb: Platform.OS === "web" });
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: nav.left + spacing.lg, right: spacing.lg, bottom: nav.bottom + spacing.md, alignItems: "center" }}
    ><SlideUp>
      {/* The bar is the only confirmation some actions get, so it is announced
          rather than left as silent decoration. Polite: it reports an outcome
          the user just caused and must not interrupt what they type next. */}
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          backgroundColor: palette.text,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          ...themeShadow.overlay(palette),
        }}
      >
        <View
          accessible={false}
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.background + "70",
            backgroundColor: palette.background + "18",
          }}
        >
          {/* The mark lands rather than appears. For most deletes this bar is
              the only confirmation the action happened at all. */}
          <SuccessPop>
            {tone === "warning" ? (
              <TriangleAlert size={14} color={palette.background} />
            ) : (
              <Check size={15} color={palette.background} strokeWidth={2.5} />
            )}
          </SuccessPop>
        </View>
        <Text style={[type.body, { color: palette.background, flexShrink: 1 }]}>{message}</Text>
        {onUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: undoing, disabled: undoing }}
            disabled={undoing}
            onPress={async () => {
              if (undoing) return;
              selectionTap();
              setUndoing(true);
              const outcome = await runUndo(async () => onUndo());
              setUndoing(false);
              if (outcome.ok) {
                clear();
                return;
              }
              devError("undo", outcome.error);
              // Keep the action available for a deterministic retry and reset
              // its timeout; a failed restore must never look successful.
              useUndo.getState().show(message, onUndo, "warning");
              void appAlert(tr.errors.undoFailed, tr.errors.title);
            }}
            style={({ pressed }) => ({
              minHeight: controlSize.minimumTarget,
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
              marginHorizontal: -spacing.sm,
              borderRadius: radius.sm,
              opacity: pressed ? stateOpacity.pressed : 1,
            })}
          >
            {/* Inverted surface: the action shares the message's ink (an accent
                role would land near-invisible on `palette.text`) and is set
                apart by weight instead of colour. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <RotateCcw accessible={false} size={14} color={palette.background} />
              <Text style={[type.label, { color: palette.background, fontFamily: font.bold, fontSize: type.body.fontSize }]}>
                {tr.common.undo}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </SlideUp></View>
  );
}
