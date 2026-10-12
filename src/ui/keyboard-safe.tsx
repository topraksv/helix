/**
 * One keyboard contract for every form surface. Native follows the keyboard with keyboard-controller (the `.native` sibling, which keeps its
 * worklets out of the web bundle); a mobile browser has no such event, so the focused input is re-centred here.
 */

import React, { useEffect } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { isReducedMotion } from "./motion";
import { isMobileViewportWidth } from "./responsive";

export interface KeyboardSafeScrollViewProps extends ScrollViewProps {
  ref?: React.Ref<ScrollView>;
  /** Breathing room above the native keyboard, measured from the caret. */
  bottomOffset: number;
  /** Extra scrollable room for the tab bar or safe area below the form. */
  extraKeyboardSpace: number;
}

export function KeyboardSafeScrollView({ bottomOffset: _bottomOffset, extraKeyboardSpace: _extraKeyboardSpace, ...props }: KeyboardSafeScrollViewProps) {
  return <ScrollView {...props} />;
}

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
      keyboardDismissMode="on-drag"
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
    if (typeof window === "undefined") return;
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
        behavior: isReducedMotion() ? "auto" : "smooth",
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
  return (
    <>
      <MobileWebKeyboardFocus />
      {children}
    </>
  );
}
