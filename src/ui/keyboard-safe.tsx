/**
 * One keyboard contract for every form surface.
 *
 * Native uses Expo SDK 54's keyboard controller rather than a stack of
 * per-screen `KeyboardAvoidingView`s: it follows the keyboard frame and keeps
 * the focused input inside its own scroll view. Mobile web has no equivalent
 * native event, so its visual viewport re-centres the active DOM input after
 * the browser has made room for the software keyboard.
 */

import React, { useEffect } from "react";
import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import { isMobileViewportWidth } from "./responsive";

export interface KeyboardSafeScrollViewProps extends ScrollViewProps {
  /** Breathing room above the native keyboard, measured from the caret. */
  bottomOffset: number;
  /** Extra scrollable room for the tab bar or safe area below the form. */
  extraKeyboardSpace: number;
}

/**
 * This is the web/default implementation. The `.native` sibling owns the
 * controller import so Metro never pulls its Reanimated worklets into web's
 * entry bundle; mobile web instead centres the actual DOM input below.
 */
export const KeyboardSafeScrollView = React.forwardRef<ScrollView, KeyboardSafeScrollViewProps>(
  ({ bottomOffset: _bottomOffset, extraKeyboardSpace: _extraKeyboardSpace, ...props }, ref) => (
    <ScrollView ref={ref} {...props} />
  ),
);

KeyboardSafeScrollView.displayName = "KeyboardSafeScrollView";

/**
 * FlatList invokes `renderScrollComponent` itself, outside React's component
 * dispatcher. This must remain a lower-case render callback: React Compiler
 * treats capitalized functions as components and would otherwise add hook
 * bookkeeping that fails when VirtualizedList calls it directly.
 */
export function renderKeyboardSafeListScroll(props: ScrollViewProps) {
  return (
    <ScrollView
      {...props}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustContentInsets={false}
    />
  );
}

function editableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]') ? target : null;
}

function activeEditableElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return editableElement(document.activeElement);
}

function MobileWebKeyboardFocus() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    // A desktop keyboard never shrinks the visual viewport. Coarse pointers
    // include phones and tablets; the width fallback also covers mobile web
    // emulation where pointer capability is not faithfully exposed.
    const isMobileViewport = () => window.matchMedia("(pointer: coarse)").matches || isMobileViewportWidth(window.innerWidth);
    let frame: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let viewportTimer: ReturnType<typeof setTimeout> | null = null;
    const reveal = (focusedTarget: HTMLElement | null) => {
      frame = null;
      if (!isMobileViewport()) return;
      // RN Web may immediately return DOM focus to its responder root after a
      // native input's focus event. The event target is still the input the
      // person tapped, whereas querying `document.activeElement` one frame
      // later would be BODY and leave it under the keyboard.
      const target = focusedTarget?.isConnected ? focusedTarget : activeEditableElement();
      if (!target) return;
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    };
    const scheduleReveal = (event?: FocusEvent) => {
      const focusedTarget = editableElement(event?.target ?? null) ?? activeEditableElement();
      if (!focusedTarget) return;
      if (frame != null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => reveal(focusedTarget));
      if (settleTimer) clearTimeout(settleTimer);
      // Mobile browsers resize the visual viewport after focus. A second,
      // debounced pass lands the field in the readable middle rather than the
      // now-covered position it held one keyboard frame earlier.
      settleTimer = setTimeout(() => reveal(focusedTarget), 220);
    };
    const onViewportResize = () => {
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(scheduleReveal, 80);
    };
    // React Native Web delegates focus at the document bubble phase and may
    // stop it after updating its responder state. Capture sees the real input
    // first, so this stays reliable for every Field rather than only some forms.
    document.addEventListener("focusin", scheduleReveal, true);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      document.removeEventListener("focusin", scheduleReveal, true);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      if (frame != null) cancelAnimationFrame(frame);
      if (settleTimer) clearTimeout(settleTimer);
      if (viewportTimer) clearTimeout(viewportTimer);
    };
  }, []);
  return null;
}

/** Mount once above Router, dialogs and all form routes. */
export function KeyboardSafeRoot({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <>
      <MobileWebKeyboardFocus />
      {children}
    </>
  );
}
