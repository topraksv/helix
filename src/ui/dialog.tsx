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

// Same hazard the dialog queue above fixes, and the same answer: a single-slot
// store overwrote `current` when a second prompt opened, so the first request's
// `resolve` was dropped and its `await` never settled — a re-auth flow could
// hang forever. Both call sites are password re-auth (account-security.tsx,
// settings/index.tsx), which sit on different screens, so overlap is reachable.
const usePromptStore = create<{ current: PromptRequest | null; queue: PromptRequest[] }>(() => ({
  current: null,
  queue: [],
}));

function enqueuePrompt(request: PromptRequest) {
  const { current, queue } = usePromptStore.getState();
  if (current) usePromptStore.setState({ queue: [...queue, request] });
  else usePromptStore.setState({ current: request });
}

/** Themed input dialog. Resolves the entered value, or null on cancel/backdrop. */
export function appPrompt(
  title: string,
  message: string,
  opts?: { placeholder?: string; confirmLabel?: string; secure?: boolean; danger?: boolean },
): Promise<string | null> {
  return new Promise((resolve) => {
    enqueuePrompt({
      title,
      message,
      placeholder: opts?.placeholder ?? "",
      confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
      secure: opts?.secure ?? false,
      danger: opts?.danger ?? false,
      resolve,
    });
  });
}

/**
 * The overlay both hosts render. It exists because the two were byte-identical
 * for 22 lines, so an accessibility fix applied to one silently skipped the
 * other. It owns the contract that must not drift: the scrim dismiss target,
 * container Pressables marked `accessible={false}` (otherwise they swallow
 * their children), the modal boundary, and the header that receives focus.
 * `messageGap` is the one genuine difference — a prompt's message sits above
 * an input, a dialog's above its buttons.
 */
function DialogShell({
  title,
  message,
  messageGap,
  titleRef,
  onDismiss,
  children,
}: {
  title: string;
  message: string;
  messageGap: number;
  titleRef: React.RefObject<View | null>;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const { palette, scheme } = useTheme();
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <Pressable
        accessible={false}
        style={{ flex: 1, backgroundColor: scrim, justifyContent: "center", padding: spacing.lg }}
        onPress={onDismiss}
      >
        <Pressable accessible={false} accessibilityViewIsModal onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: 400 }}>
          <FadeIn
            style={[
              { backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg },
              scheme === "light" && cardShadow,
            ]}
          >
            <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
              <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{title}</Text>
            </View>
            <Text style={[type.body, { color: palette.textSecondary, marginBottom: messageGap }]}>{message}</Text>
            {children}
          </FadeIn>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function PromptHost() {
  const { palette } = useTheme();
  const current = usePromptStore((s) => s.current);
  const [value, setValue] = useState("");
  const titleRef = useModalAccessibility(current != null, undefined, current?.title, false);
  // Reset the field each time a new prompt opens.
  React.useEffect(() => {
    if (current) setValue("");
  }, [current]);
  if (!current) return null;

  const close = (val: string | null) => {
    // Advance to the next queued prompt, exactly as DialogHost.close does, so
    // no request is dropped and every promise settles.
    const { queue } = usePromptStore.getState();
    usePromptStore.setState({ current: queue[0] ?? null, queue: queue.slice(1) });
    current.resolve(val);
  };

  return (
    <DialogShell
      title={current.title}
      message={current.message}
      messageGap={spacing.md}
      titleRef={titleRef}
      onDismiss={() => close(null)}
    >
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
    </DialogShell>
  );
}

export function DialogHost() {
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
    <DialogShell
      title={current.title}
      message={current.message}
      messageGap={spacing.lg}
      titleRef={titleRef}
      onDismiss={() => close(current.cancelLabel == null)}
    >
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" }}>
        {current.cancelLabel != null ? (
          <Button label={current.cancelLabel} variant="ghost" size="sm" onPress={() => close(false)} />
        ) : null}
        <Button label={current.confirmLabel} variant={current.danger ? "danger" : "primary"} size="sm" onPress={() => close(true)} />
      </View>
    </DialogShell>
  );
}
