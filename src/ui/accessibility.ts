/** Shared focus behavior for modal surfaces and scroll regions. */

import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform, type ScrollView, type View } from "react-native";
import { devWarning } from "../services/logger";
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
    // One owner suppresses the global Enter-to-submit while any modal is open, or Enter would save the form hidden beneath a dirty-exit dialog.
    const releaseOverlay = pushOverlay();
    const web = Platform.OS === "web" && typeof document !== "undefined";
    const webPrevious = web ? document.activeElement as HTMLElement | null : null;
    const webModal = web
      ? (titleRef.current as unknown as HTMLElement | null)?.closest<HTMLElement>('[aria-modal="true"]') ?? null
      : null;
    const returnTarget = returnFocusRef?.current;
    // The web modal exists by now; a delayed focus would let the browser's autofocus win, then steal focus back from a quick Tab.
    if (focusHeading && Platform.OS === "web") moveAccessibilityFocus(titleRef.current);
    const timer = focusHeading && Platform.OS !== "web"
      ? setTimeout(() => moveAccessibilityFocus(titleRef.current), 40)
      : undefined;
    const trapFocus = web
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
        // Do not steal focus from a user action that already moved elsewhere in this tick, or Enter right after a selection reopens the select.
        const active = web ? document.activeElement as HTMLElement | null : null;
        const focusMoved = web
          && active != null
          && active !== document.body
          && active !== document.documentElement
          && !webModal?.contains(active);
        if (focusMoved) return;
        if (returnTarget) moveAccessibilityFocus(returnTarget);
        else webPrevious?.focus?.();
      }, 0);
    };
  }, [open, returnFocusRef, focusKey, focusHeading]);

  return titleRef;
}

/**
 * The DOM element that actually scrolls, behind a react-native ScrollView ref.
 *
 * `getScrollableNode` is react-native-web's own accessor and is what the
 * library guarantees; `findNodeHandle` is the fallback for a ref that has been
 * forwarded through a wrapper which does not re-expose it.
 */
function scrollableNode(instance: ScrollView | null): HTMLElement | null {
  if (Platform.OS !== "web" || instance == null || typeof document === "undefined") return null;
  const candidate = instance as unknown as { getScrollableNode?: () => unknown };
  const node = typeof candidate.getScrollableNode === "function"
    ? candidate.getScrollableNode()
    : findNodeHandle(instance as never);
  return node instanceof HTMLElement ? node : null;
}

/** Our own mark, so a tab stop this hook added is the only one it removes. */
const SCROLL_FOCUS_MARK = "data-helix-scroll-focus";

/** Makes a text-only scroll region keyboard-reachable on web; set by readable screens only, and only while it overflows with nothing focusable inside. */
export function useKeyboardReachableScroller(ref: RefObject<ScrollView | null>, enabled: boolean): void {
  useEffect(() => {
    // Checked before touching the DOM: most screens are not `readable` and must pay nothing. The cleanup below undoes a stop when `enabled` goes false.
    if (!enabled || Platform.OS !== "web") return;

    const node = scrollableNode(ref.current);
    if (!node) {
      // `readable` promised a scroll region and there is none. Development only: devWarning persists, and per-mount writes would evict real crash breadcrumbs.
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        devWarning("ui.readableScreen", "a readable Screen has no scroll region to make keyboard-reachable");
      }
      return;
    }

    const unmark = () => {
      if (!node.hasAttribute(SCROLL_FOCUS_MARK)) return;
      node.removeAttribute(SCROLL_FOCUS_MARK);
      node.removeAttribute("tabindex");
    };

    const sync = () => {
      const overflows = node.scrollHeight > node.clientHeight + 1;
      if (overflows && focusableElements(node).length === 0) {
        if (!node.hasAttribute(SCROLL_FOCUS_MARK)) {
          node.setAttribute(SCROLL_FOCUS_MARK, "true");
          node.tabIndex = 0;
        }
      } else {
        unmark();
      }
    };

    sync();
    // Content arrives after the first paint on every screen that loads data,
    // and a one-shot check would answer for the empty frame.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    if (observer) {
      observer.observe(node);
      for (const child of Array.from(node.children)) observer.observe(child);
    }
    // Cleanup on every path, observer or not. Scoped to the scroller found at mount: swapping it later would need a callback ref.
    return () => {
      observer?.disconnect();
      unmark();
    };
  }, [ref, enabled]);
}
