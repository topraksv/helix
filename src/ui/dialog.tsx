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

import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { create } from "zustand";
import { Button, FadeIn } from "./components";
import { cardShadow, radius, scrim, spacing, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { INPUT_LIMITS } from "../domain/input";
import { useModalAccessibility } from "./accessibility";

interface DialogRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** null = single-button alert. */
  cancelLabel: string | null;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

// A single-slot store dropped the second of two overlapping dialogs (its
// promise never resolved, hanging the awaiting flow). Queue instead: show one
// at a time, advancing to the next when the current one closes.
const useDialogStore = create<{ current: DialogRequest | null; queue: DialogRequest[] }>(() => ({ current: null, queue: [] }));

function enqueueDialog(request: DialogRequest) {
  const { current, queue } = useDialogStore.getState();
  if (current) useDialogStore.setState({ queue: [...queue, request] });
  else useDialogStore.setState({ current: request });
}

/** One-button themed alert. Resolves when dismissed. */
export function appAlert(message: string, title: string = tr.app.name): Promise<void> {
  return new Promise((resolve) => {
    enqueueDialog({ title, message, confirmLabel: tr.common.done, cancelLabel: null, danger: false, resolve: () => resolve() });
  });
}

/** Two-button themed confirm. Resolves true on confirm, false on cancel/backdrop. */
export function appConfirm(
  title: string,
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    enqueueDialog({
      title,
      message,
      confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
      cancelLabel: opts?.cancelLabel ?? tr.common.cancel,
      danger: opts?.danger ?? false,
      resolve,
    });
  });
}

// ---------------------------------------------------------------------------
// Prompt: a single themed text/password input dialog (re-auth, rename, …).
// ---------------------------------------------------------------------------

interface PromptRequest {
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
  secure: boolean;
  danger: boolean;
  resolve: (value: string | null) => void;
}

const usePromptStore = create<{ current: PromptRequest | null }>(() => ({ current: null }));

/** Themed input dialog. Resolves the entered value, or null on cancel/backdrop. */
export function appPrompt(
  title: string,
  message: string,
  opts?: { placeholder?: string; confirmLabel?: string; secure?: boolean; danger?: boolean },
): Promise<string | null> {
  return new Promise((resolve) => {
    usePromptStore.setState({
      current: {
        title,
        message,
        placeholder: opts?.placeholder ?? "",
        confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
        secure: opts?.secure ?? false,
        danger: opts?.danger ?? false,
        resolve,
      },
    });
  });
}

export function PromptHost() {
  const { palette, scheme } = useTheme();
  const current = usePromptStore((s) => s.current);
  const [value, setValue] = useState("");
  const titleRef = useModalAccessibility(current != null, undefined, current?.title, false);
  // Reset the field each time a new prompt opens.
  React.useEffect(() => {
    if (current) setValue("");
  }, [current]);
  if (!current) return null;

  const close = (val: string | null) => {
    usePromptStore.setState({ current: null });
    current.resolve(val);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(null)}>
      <Pressable
        accessible={false}
        style={{ flex: 1, backgroundColor: scrim, justifyContent: "center", padding: spacing.lg }}
        onPress={() => close(null)}
      >
        <Pressable accessible={false} accessibilityViewIsModal onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 400 }}>
          <FadeIn
            style={[
              { backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg },
              scheme === "light" && cardShadow,
            ]}
          >
            <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
              <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{current.title}</Text>
            </View>
            <Text style={[type.body, { color: palette.textSecondary, marginBottom: spacing.md }]}>{current.message}</Text>
            <TextInput
              value={value}
              maxLength={current.secure ? INPUT_LIMITS.password : INPUT_LIMITS.text}
              onChangeText={setValue}
              secureTextEntry={current.secure}
              accessibilityLabel={current.placeholder || current.title}
              accessibilityHint={current.message}
              placeholder={current.placeholder}
              placeholderTextColor={palette.textSecondary}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => value.trim() !== "" && close(value)}
              style={{
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: palette.border,
                borderRadius: radius.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 2,
                color: palette.text,
                backgroundColor: palette.surfaceAlt,
                marginBottom: spacing.lg,
                fontFamily: "Inter_400Regular",
                fontSize: 16,
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" }}>
              <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => close(null)} />
              <Button
                label={current.confirmLabel}
                variant={current.danger ? "danger" : "primary"}
                size="sm"
                disabled={value.trim() === ""}
                onPress={() => close(value)}
              />
            </View>
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function DialogHost() {
  const { palette, scheme } = useTheme();
  const current = useDialogStore((s) => s.current);
  const titleRef = useModalAccessibility(current != null, undefined, current?.title);
  if (!current) return null;

  const close = (ok: boolean) => {
    const { queue } = useDialogStore.getState();
    const [next, ...rest] = queue;
    useDialogStore.setState({ current: next ?? null, queue: rest });
    current.resolve(ok);
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => close(current.cancelLabel == null)}>
      <Pressable
        accessible={false}
        style={{ flex: 1, backgroundColor: scrim, justifyContent: "center", padding: spacing.lg }}
        onPress={() => close(current.cancelLabel == null)}
      >
        <Pressable accessible={false} accessibilityViewIsModal onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 400 }}>
          <FadeIn
            style={[
              { backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg },
              scheme === "light" && cardShadow,
            ]}
          >
            <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
              <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{current.title}</Text>
            </View>
            <Text style={[type.body, { color: palette.textSecondary, marginBottom: spacing.lg }]}>{current.message}</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" }}>
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
