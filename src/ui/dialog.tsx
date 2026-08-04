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
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { create } from "zustand";
import { Button, FadeIn } from "./components";
import { font, radius, spacing, themeShadow, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { INPUT_LIMITS } from "../domain/input";
import { useModalAccessibility } from "./accessibility";
import { advanceRequestQueue, emptyRequestQueue, enqueueRequest, type RequestQueue } from "./request-queue";
import { useReducedMotion } from "./motion";
import { modalAnimationType } from "./modal-motion";
import { examplePlaceholder } from "./input-placeholder";
import { OperationDialogHeader, type OperationFlowKind } from "./operation-flow";

interface DialogRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** null = single-button alert. */
  cancelLabel: string | null;
  danger: boolean;
  operation?: OperationFlowKind;
  resolve: (ok: boolean) => void;
}

// A single-slot store dropped the second of two overlapping dialogs (its
// promise never resolved, hanging the awaiting flow). Queue instead: show one
// at a time, advancing to the next when the current one closes.
const useDialogStore = create<RequestQueue<DialogRequest>>(() => emptyRequestQueue<DialogRequest>());

function enqueueDialog(request: DialogRequest) {
  useDialogStore.setState(enqueueRequest(useDialogStore.getState(), request));
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
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean; operation?: OperationFlowKind },
): Promise<boolean> {
  return new Promise((resolve) => {
    enqueueDialog({
      title,
      message,
      confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
      cancelLabel: opts?.cancelLabel ?? tr.common.cancel,
      danger: opts?.danger ?? false,
      operation: opts?.operation,
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
  operation?: OperationFlowKind;
  resolve: (value: string | null) => void;
}

// Same hazard the dialog queue above fixes, and the same answer: a single-slot
// store overwrote `current` when a second prompt opened, so the first request's
// `resolve` was dropped and its `await` never settled — a re-auth flow could
// hang forever. Both call sites are password re-auth (account-security.tsx,
// settings/index.tsx), which sit on different screens, so overlap is reachable.
const usePromptStore = create<RequestQueue<PromptRequest>>(() => emptyRequestQueue<PromptRequest>());

function enqueuePrompt(request: PromptRequest) {
  usePromptStore.setState(enqueueRequest(usePromptStore.getState(), request));
}

/** Themed input dialog. Resolves the entered value, or null on cancel/backdrop. */
export function appPrompt(
  title: string,
  message: string,
  opts?: { placeholder?: string; confirmLabel?: string; secure?: boolean; danger?: boolean; operation?: OperationFlowKind },
): Promise<string | null> {
  return new Promise((resolve) => {
    enqueuePrompt({
      title,
      message,
      placeholder: opts?.placeholder ?? "",
      confirmLabel: opts?.confirmLabel ?? tr.common.confirm,
      secure: opts?.secure ?? false,
      danger: opts?.danger ?? false,
      operation: opts?.operation,
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
  operation,
  children,
}: {
  title: string;
  message: string;
  messageGap: number;
  titleRef: React.RefObject<View | null>;
  onDismiss: () => void;
  operation?: OperationFlowKind;
  children: React.ReactNode;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onDismiss}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, justifyContent: "center" }}
        onPress={onDismiss}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.lg }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Pressable testID={operation ? "operation-dialog-surface" : undefined} accessible={false} tabIndex={-1} accessibilityViewIsModal onPress={() => {}} style={{ alignSelf: "center", width: "100%", maxWidth: operation ? 520 : 400 }}>
            <FadeIn
              style={[
                { backgroundColor: palette.surface, borderRadius: radius.lg, padding: operation ? spacing.xl : spacing.lg },
                themeShadow.card(palette),
              ]}
            >
              <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
                {operation ? <OperationDialogHeader kind={operation} title={title} message={message} testID="operation-dialog-header" /> : <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{title}</Text>}
              </View>
              {!operation ? (
                <Text style={[type.body, { color: palette.textSecondary, marginBottom: messageGap }]}>{message}</Text>
              ) : null}
              {children}
            </FadeIn>
          </Pressable>
        </ScrollView>
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
    usePromptStore.setState(advanceRequestQueue(usePromptStore.getState()));
    current.resolve(val);
  };

  return (
    <DialogShell
      title={current.title}
      message={current.message}
      messageGap={spacing.md}
      titleRef={titleRef}
      onDismiss={() => close(null)}
      operation={current.operation}
    >
      <TextInput
        value={value}
        maxLength={current.secure ? INPUT_LIMITS.password : INPUT_LIMITS.text}
        onChangeText={setValue}
        secureTextEntry={current.secure}
        accessibilityLabel={current.placeholder || current.title}
        accessibilityHint={current.message}
        placeholder={examplePlaceholder(current.placeholder)}
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
          // The field is the answer to the sentence above it, so it needs air
          // between them: with an operation header the two were flush, and the
          // gap underneath was doubled by the action block's own top margin.
          marginTop: spacing.lg,
          fontFamily: font.regular,
          fontSize: type.field.fontSize,
        }}
      />
      <View
        style={current.operation
          ? {
              // A stacked pair. No `flexWrap` — in a column Yoga wraps into a
              // second column, which is why iOS drew the two buttons side by
              // side and offset while the web build stacked them.
              gap: spacing.sm,
              marginTop: spacing.lg,
              paddingTop: spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.border,
            }
          : { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.lg }}
      >
        <View style={current.operation ? { width: "100%" } : undefined}>
          <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => close(null)} />
        </View>
        <View style={current.operation ? { width: "100%" } : undefined}>
          <Button
            label={current.confirmLabel}
            variant={current.danger ? "danger" : "primary"}
            size="sm"
            disabled={value.trim() === ""}
            onPress={() => close(value)}
          />
        </View>
      </View>
    </DialogShell>
  );
}

export function DialogHost() {
  const { palette } = useTheme();
  const current = useDialogStore((s) => s.current);
  const titleRef = useModalAccessibility(current != null, undefined, current?.title);
  if (!current) return null;

  const close = (ok: boolean) => {
    useDialogStore.setState(advanceRequestQueue(useDialogStore.getState()));
    current.resolve(ok);
  };

  return (
    <DialogShell
      title={current.title}
      message={current.message}
      messageGap={spacing.lg}
      titleRef={titleRef}
      onDismiss={() => close(current.cancelLabel == null)}
      operation={current.operation}
    >
      <View
        style={current.operation
          ? {
              // A stacked pair. No `flexWrap` — in a column Yoga wraps into a
              // second column, which is why iOS drew the two buttons side by
              // side and offset while the web build stacked them.
              gap: spacing.sm,
              marginTop: spacing.xl,
              paddingTop: spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.border,
            }
          : { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap" }}
      >
        {current.cancelLabel != null ? (
          <View style={current.operation ? { width: "100%" } : undefined}>
            <Button label={current.cancelLabel} variant="ghost" size="sm" onPress={() => close(false)} />
          </View>
        ) : null}
        <View style={current.operation ? { width: "100%" } : undefined}>
          <Button label={current.confirmLabel} variant={current.danger ? "danger" : "primary"} size="sm" onPress={() => close(true)} />
        </View>
      </View>
    </DialogShell>
  );
}
