/** Shared focus behavior for modal surfaces. */

import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, type View } from "react-native";
import { pushOverlay } from "./keyboard";

type FocusTarget = View;

function moveAccessibilityFocus(target: FocusTarget | null): void {
  if (!target) return;
  if (Platform.OS === "web") {
    (target as unknown as { focus?: () => void }).focus?.();
    return;
  }
  const handle = findNodeHandle(target);
  if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="checkbox"], [role="option"], [role="radio"], [role="slider"], [role="spinbutton"], [role="switch"], [role="tab"]',
  )).filter((element) =>
    element.tabIndex >= 0 &&
    !element.hasAttribute("disabled") &&
    element.getAttribute("aria-disabled") !== "true" &&
    element.getClientRects().length > 0
  );
}

/** Focuses a modal's heading and returns focus to its trigger on close. */
export function useModalAccessibility(
  open: boolean,
  returnFocusRef?: RefObject<FocusTarget | null>,
  focusKey?: unknown,
  focusHeading = true,
): RefObject<View | null> {
  const titleRef = useRef<View>(null);

  useEffect(() => {
    if (!open) return;
    // Every modal surface suppresses the global web Enter-to-submit handler.
    // Without one shared owner, a dirty-exit dialog could sit visibly above a
    // valid form while Enter saved and navigated the hidden form underneath.
    const releaseOverlay = pushOverlay();
    const webPrevious = Platform.OS === "web" && typeof document !== "undefined"
      ? document.activeElement as HTMLElement | null
      : null;
    const returnTarget = returnFocusRef?.current;
    const timer = focusHeading ? setTimeout(() => moveAccessibilityFocus(titleRef.current), 40) : undefined;
    const trapFocus = Platform.OS === "web" && typeof document !== "undefined"
      ? (event: KeyboardEvent) => {
          if (event.key !== "Tab") return;
          const title = titleRef.current as unknown as HTMLElement | null;
          const modal = title?.closest<HTMLElement>('[aria-modal="true"]');
          if (!modal) return;
          const openModals = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
          if (openModals.at(-1) !== modal) return;

          const focusable = focusableElements(modal);
          const active = document.activeElement as HTMLElement | null;
          const currentIndex = active ? focusable.indexOf(active) : -1;
          const leavingForward = currentIndex === focusable.length - 1;
          const leavingBackward = currentIndex === 0 && event.shiftKey;
          const focusOutside = !active || !modal.contains(active);
          const focusOnHeading = active === title;
          if (!focusOutside && !focusOnHeading && !leavingForward && !leavingBackward) return;

          event.preventDefault();
          const target = event.shiftKey ? focusable.at(-1) : focusable[0];
          (target ?? title)?.focus?.();
        }
      : null;
    if (trapFocus) document.addEventListener("keydown", trapFocus, true);
    return () => {
      if (timer != null) clearTimeout(timer);
      if (trapFocus) document.removeEventListener("keydown", trapFocus, true);
      releaseOverlay();
      setTimeout(() => {
        if (returnTarget) moveAccessibilityFocus(returnTarget);
        else webPrevious?.focus?.();
      }, 0);
    };
  }, [open, returnFocusRef, focusKey, focusHeading]);

  return titleRef;
}
