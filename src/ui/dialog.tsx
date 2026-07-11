/**
 * Themed alert/confirm dialogs — the single replacement for `window.alert` /
 * `window.confirm` (blocking, unthemed on web) and native `Alert.alert`
 * (inconsistent with the design language). Promise-based so call sites read
 * like the blocking APIs they replace:
 *
 *   await appAlert(message);
 *   if (await appConfirm(title, message, { danger: true })) { … }
 *
 * `DialogHost` renders once in the root layout (next to UndoSnackbar); RN's
 * Modal overlays every screen, including router modals.
 */

import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { create } from "zustand";
import { Button, FadeIn } from "./components";
import { cardShadow, radius, spacing, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";

interface DialogRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** null = single-button alert. */
  cancelLabel: string | null;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const useDialogStore = create<{ current: DialogRequest | null }>(() => ({ current: null }));

/** One-button themed alert. Resolves when dismissed. */
export function appAlert(message: string, title: string = tr.app.name): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.setState({
      current: { title, message, confirmLabel: tr.common.done, cancelLabel: null, danger: false, resolve: () => resolve() },
    });
  });
}

/** Two-button themed confirm. Resolves true on confirm, false on cancel/backdrop. */
export function appConfirm(
  title: string,
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.setState({
      current: {
        title,
        message,
        confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
        cancelLabel: opts?.cancelLabel ?? tr.common.cancel,
        danger: opts?.danger ?? false,
        resolve,
      },
    });
  });
}

export function DialogHost() {
  const { palette, scheme } = useTheme();
  const current = useDialogStore((s) => s.current);
  if (!current) return null;

  const close = (ok: boolean) => {
    useDialogStore.setState({ current: null });
    current.resolve(ok);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(current.cancelLabel == null)}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(8,10,18,0.55)", justifyContent: "center", padding: spacing.lg }}
        onPress={() => close(current.cancelLabel == null)}
      >
        <Pressable onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 400 }}>
          <FadeIn
            style={[
              { backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg },
              scheme === "light" && cardShadow,
            ]}
          >
            <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{current.title}</Text>
            <Text style={[type.body, { color: palette.textMuted, marginBottom: spacing.lg }]}>{current.message}</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm }}>
              {current.cancelLabel != null ? (
                <Button label={current.cancelLabel} variant="ghost" size="sm" onPress={() => close(false)} />
              ) : null}
              <Button label={current.confirmLabel} variant={current.danger ? "danger" : "primary"} size="sm" onPress={() => close(true)} />
            </View>
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
