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

import React, { useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ViewInstance,
} from "react-native";
import { create } from "zustand";
import { Button, FadeIn } from "./components";
import { circle, font, radius, spacing, themeShadow, type, useTheme } from "./theme";
import { tr } from "../i18n/tr";
import { errorNotice } from "./haptics";
import { INPUT_LIMITS } from "../domain/input";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { shouldPresentOptionsAsSheet } from "./responsive";
import { useModalAccessibility } from "./accessibility";
import { advanceRequestQueue, emptyRequestQueue, enqueueRequest, type RequestQueue } from "./request-queue";
import { useReducedMotion } from "./motion";
import { modalAnimationType } from "./modal-motion";
import { examplePlaceholder } from "./input-placeholder";
import { OperationDialogHeader, type DialogOperation } from "./operation-flow";
import { KeyboardSafeScrollView } from "./keyboard-safe";

/** A centred modal card with a focusable heading, shared by the sheets that edit one record. */
export function ModalCard({ title, testID, cardWidth, onClose, children }: { title: string; testID: string; cardWidth: number; onClose: () => void; children: ReactNode }) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const titleRef = useModalAccessibility(true);
  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onClose}>
      <Pressable accessible={false} tabIndex={-1} style={{ flex: 1, backgroundColor: palette.scrim, alignItems: "center", justifyContent: "center", padding: spacing.lg }} onPress={onClose}>
        <Pressable accessible={false} tabIndex={-1} accessibilityViewIsModal aria-label={title} onPress={() => {}} style={{ width: "100%", maxWidth: cardWidth, maxHeight: "90%" }}>
          <KeyboardSafeScrollView bottomOffset={spacing.lg} extraKeyboardSpace={spacing.xl} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg }}>
            <FadeIn testID={testID} style={{ backgroundColor: palette.surface, borderRadius: radius.lg, padding: spacing.lg, ...themeShadow.card(palette) }}>
              <View ref={titleRef} accessible accessibilityRole="header" tabIndex={-1}>
                <Text style={[type.heading, { color: palette.text }]}>{title}</Text>
              </View>
              {children}
            </FadeIn>
          </KeyboardSafeScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface DialogRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** null = single-button alert. */
  cancelLabel: string | null;
  danger: boolean;
  /** Whether this dialog REPORTS a failure, as opposed to asking about one. */
  tone?: "error" | "neutral";
  operation?: DialogOperation;
  id: number;
  resolve: (ok: boolean) => void;
}

// Queued, one at a time: a single slot dropped the second of two overlapping dialogs and its promise never resolved.
const useDialogStore = create<RequestQueue<DialogRequest>>(() => emptyRequestQueue<DialogRequest>());

// An id per request: two queued dialogs may share a title, and the title is no
// identity for the focus key or the remount.
let requestId = 0;

function enqueueDialog(request: Omit<DialogRequest, "id">) {
  // Failure feedback lives here, once, where every dialog passes. A destructive CONFIRM stays silent: it is a question, and the outcome has not happened yet.
  if (request.tone === "error") errorNotice();
  useDialogStore.setState(enqueueRequest(useDialogStore.getState(), { ...request, id: ++requestId }));
}

/**
 * One-button themed alert. Resolves when dismissed.
 *
 * The tone decides whether the device says so as well as the screen. It is
 * inferred from the title, because `tr.errors.title` is already how this app
 * marks a failure, and passed explicitly by the handful of failures that carry
 * a friendlier title.
 */
export function appAlert(
  message: string,
  title: string = tr.app.name,
  opts?: { tone?: "error" | "neutral" },
): Promise<void> {
  const tone = opts?.tone ?? (title === tr.errors.title ? "error" : "neutral");
  return new Promise((resolve) => {
    enqueueDialog({ title, message, confirmLabel: tr.common.done, cancelLabel: null, danger: false, tone, resolve: () => resolve() });
  });
}

/** Two-button themed confirm. Resolves true on confirm, false on cancel/backdrop. */
export function appConfirm(
  title: string,
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean; operation?: DialogOperation },
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
  operation?: DialogOperation;
  id: number;
  resolve: (value: string | null) => void;
}

// Queued for the same reason as the dialogs: a single slot dropped the first prompt's `resolve`, and a re-auth flow could hang forever.
const usePromptStore = create<RequestQueue<PromptRequest>>(() => emptyRequestQueue<PromptRequest>());

function enqueuePrompt(request: Omit<PromptRequest, "id">) {
  usePromptStore.setState(enqueueRequest(usePromptStore.getState(), { ...request, id: ++requestId }));
}

/** Themed input dialog. Resolves the entered value, or null on cancel/backdrop. */
export function appPrompt(
  title: string,
  message: string,
  opts?: { placeholder?: string; confirmLabel?: string; secure?: boolean; danger?: boolean; operation?: DialogOperation },
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
 * Ask for the account password and check it, for an irreversible step that follows.
 * Resolves true only when the password was entered and `verify` returned no error; a refusal is alerted here.
 */
export async function confirmWithPassword(
  verify: (password: string) => Promise<string | null>,
  opts: { body: string; confirmLabel: string; operation: DialogOperation },
): Promise<boolean> {
  const password = await appPrompt(tr.account.confirmPasswordTitle, opts.body, {
    secure: true,
    placeholder: tr.auth.password,
    confirmLabel: opts.confirmLabel,
    danger: true,
    operation: opts.operation,
  });
  if (password == null) return false;
  const verifyError = await verify(password);
  if (verifyError) {
    void appAlert(verifyError, tr.errors.title);
    return false;
  }
  return true;
}

/**
 * The overlay both hosts render, so an accessibility fix cannot skip one. It owns what must not drift: the scrim dismiss target,
 * container Pressables marked `accessible={false}` (otherwise they swallow their children), the modal boundary, and the focused header.
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
  titleRef: React.RefObject<ViewInstance | null>;
  onDismiss: () => void;
  operation?: DialogOperation;
  children: React.ReactNode;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // A phone gets a sheet (a centred "Sil" sits where a thumb reaches least); the option picker asks the same question, so they agree.
  const asSheet = shouldPresentOptionsAsSheet(width);
  return (
    <Modal transparent animationType={modalAnimationType(reducedMotion)} visible onRequestClose={onDismiss} aria-label={title}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, justifyContent: asSheet ? "flex-end" : "center" }}
        onPress={onDismiss}
      >
        <KeyboardSafeScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: asSheet ? "flex-end" : "center",
            padding: asSheet ? 0 : spacing.lg,
          }}
          bottomOffset={Math.min(140, Math.round(height * 0.22))}
          extraKeyboardSpace={spacing.lg}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Native names the dialog here; on the web the Modal's own aria-label does. */}
          <Pressable
            testID={operation ? "operation-dialog-surface" : undefined}
            accessible={false}
            tabIndex={-1}
            accessibilityViewIsModal
            aria-label={title}
            onPress={() => {}}
            style={{ alignSelf: "center", width: "100%", maxWidth: asSheet ? undefined : operation ? 520 : 400 }}
          >
            <FadeIn
              style={[
                {
                  backgroundColor: palette.surface,
                  padding: operation ? spacing.xl : spacing.lg,
                  // A sheet is attached to the bottom edge, so only its top
                  // corners are round and its own padding carries the home
                  // indicator rather than leaving the buttons on top of it.
                  ...(asSheet
                    ? {
                        borderTopLeftRadius: radius.xl,
                        borderTopRightRadius: radius.xl,
                        paddingBottom: (operation ? spacing.xl : spacing.lg) + insets.bottom,
                      }
                    : { borderRadius: radius.lg }),
                  borderCurve: "continuous" as const,
                },
                themeShadow.card(palette),
              ]}
            >
              {asSheet ? (
                // The grab handle every bottom sheet on both platforms wears.
                // Decoration: the scrim behind it is the dismiss target and it
                // is already reachable.
                <View
                  accessible={false}
                  style={{
                    alignSelf: "center",
                    width: 36,
                    height: 4,
                    borderRadius: circle(4),
                    backgroundColor: palette.surfaceStrong,
                    marginBottom: spacing.md,
                  }}
                />
              ) : null}
              <View ref={titleRef} accessible accessibilityRole="header" aria-level={2} tabIndex={-1}>
                {operation ? <OperationDialogHeader kind={operation} title={title} message={message} testID="operation-dialog-header" /> : <Text style={[type.heading, { color: palette.text, marginBottom: spacing.sm }]}>{title}</Text>}
              </View>
              {!operation ? (
                <Text style={[type.body, { color: palette.textSecondary, marginBottom: messageGap }]}>{message}</Text>
              ) : null}
              {children}
            </FadeIn>
          </Pressable>
        </KeyboardSafeScrollView>
      </Pressable>
    </Modal>
  );
}

function Actions({
  operation,
  operationTop,
  plainTop,
  cancel,
  confirm,
}: {
  operation: boolean;
  operationTop: number;
  plainTop?: number;
  cancel: React.ReactNode;
  confirm: React.ReactNode;
}) {
  const { palette } = useTheme();
  const wrapper = operation ? { width: "100%" as const } : undefined;
  return (
    <View
      style={operation
        ? {
            // A stacked pair. No `flexWrap` — in a column Yoga wraps into a
            // second column, which is why iOS drew the two buttons side by
            // side and offset while the web build stacked them.
            gap: spacing.sm,
            marginTop: operationTop,
            paddingTop: spacing.md,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: palette.border,
          }
        : { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap", marginTop: plainTop }}
    >
      {cancel ? <View style={wrapper}>{cancel}</View> : null}
      <View style={wrapper}>{confirm}</View>
    </View>
  );
}

export function PromptHost() {
  const current = usePromptStore((s) => s.current);
  // Keyed by request: a second prompt remounts, so it starts with an empty field.
  return current ? <PromptBody key={current.id} current={current} /> : null;
}

function PromptBody({ current }: { current: PromptRequest }) {
  const { palette } = useTheme();
  const [value, setValue] = useState("");
  const titleRef = useModalAccessibility(true, undefined, current.id, false);

  const close = (val: string | null) => {
    // A stale closure (the host has not re-rendered yet) must not advance twice.
    if (usePromptStore.getState().current !== current) return;
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
          // Air between the sentence and its field; flush with an operation header otherwise.
          marginTop: spacing.lg,
          fontFamily: font.regular,
          fontSize: type.field.fontSize,
        }}
      />
      <Actions
        operation={!!current.operation}
        operationTop={spacing.lg}
        plainTop={spacing.lg}
        cancel={<Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => close(null)} />}
        confirm={
          <Button
            label={current.confirmLabel}
            variant={current.danger ? "danger" : "primary"}
            size="sm"
            disabled={value.trim() === ""}
            onPress={() => close(value)}
          />
        }
      />
    </DialogShell>
  );
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  return current ? <DialogBody key={current.id} current={current} /> : null;
}

function DialogBody({ current }: { current: DialogRequest }) {
  const titleRef = useModalAccessibility(true, undefined, current.id);

  const close = (ok: boolean) => {
    if (useDialogStore.getState().current !== current) return;
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
      <Actions
        operation={!!current.operation}
        operationTop={spacing.xl}
        cancel={current.cancelLabel != null ? <Button label={current.cancelLabel} variant="ghost" size="sm" onPress={() => close(false)} /> : null}
        confirm={<Button label={current.confirmLabel} variant={current.danger ? "danger" : "primary"} size="sm" onPress={() => close(true)} />}
      />
    </DialogShell>
  );
}
